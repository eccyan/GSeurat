#include "gseurat/engine/gs_renderer/pbd/gs_pbd_system.hpp"

#include "gseurat/engine/debug.hpp"
#include "gseurat/engine/gs_renderer/gs_resources.hpp"
#include "gseurat/engine/pipeline.hpp"

#include <glm/glm.hpp>

#include <algorithm>
#include <cassert>
#include <cstring>
#include <stdexcept>
#include <string>

namespace gseurat {

GsPbdSystem::~GsPbdSystem() {
    shutdown();
}

void GsPbdSystem::init(VkDevice device, VmaAllocator allocator,
                       VkPipelineCache pipeline_cache, VkDescriptorPool pool,
                       GsResourceManager* resources) {
    assert(device != VK_NULL_HANDLE);
    assert(pool != VK_NULL_HANDLE);
    assert(resources != nullptr);
    device_    = device;
    allocator_ = allocator;
    resources_ = resources;

    // ── Descriptor set layout ─────────────────────────────────────────
    // pbd_states(rw/0), pbd_params(ro/1), pbd_constraints(ro/2), pbd_uniforms(ubo/3)
    {
        const VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,  1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType        = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 4;
        ci.pBindings    = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &pbd_set_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsPbdSystem: failed pbd descriptor set layout");
        }
    }

    // ── Pipeline (pbd_solver.comp) ────────────────────────────────────
    {
        auto module = load_shader_module(device_, "shaders/pbd_solver.comp.spv");

        VkPushConstantRange pc{};
        pc.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        pc.size       = sizeof(uint32_t);

        VkPipelineLayoutCreateInfo pl_ci{};
        pl_ci.sType                  = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        pl_ci.setLayoutCount         = 1;
        pl_ci.pSetLayouts            = &pbd_set_layout_;
        pl_ci.pushConstantRangeCount = 1;
        pl_ci.pPushConstantRanges    = &pc;
        if (vkCreatePipelineLayout(device_, &pl_ci, nullptr, &pbd_pipeline_layout_) != VK_SUCCESS) {
            vkDestroyShaderModule(device_, module, nullptr);
            throw std::runtime_error("GsPbdSystem: failed pipeline layout");
        }

        VkComputePipelineCreateInfo pi{};
        pi.sType               = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pi.stage.sType         = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pi.stage.stage         = VK_SHADER_STAGE_COMPUTE_BIT;
        pi.stage.module        = module;
        pi.stage.pName         = "main";
        pi.layout              = pbd_pipeline_layout_;
        VkResult res = vkCreateComputePipelines(device_, pipeline_cache, 1, &pi, nullptr, &pbd_pipeline_);
        vkDestroyShaderModule(device_, module, nullptr);
        if (res != VK_SUCCESS) {
            throw std::runtime_error("GsPbdSystem: failed pipeline create (pbd_solver.comp.spv)");
        }
    }

    // ── Descriptor set allocation ─────────────────────────────────────
    // Single set — PBD solver descriptor set is not per-frame; the
    // underlying buffers are stable across frames.
    VkDescriptorSetAllocateInfo ds_ai{};
    ds_ai.sType              = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ds_ai.descriptorPool     = pool;
    ds_ai.descriptorSetCount = 1;
    ds_ai.pSetLayouts        = &pbd_set_layout_;
    if (vkAllocateDescriptorSets(device_, &ds_ai, &pbd_set_) != VK_SUCCESS) {
        throw std::runtime_error("GsPbdSystem: vkAllocateDescriptorSets failed");
    }
}

void GsPbdSystem::write_descriptors() {
    // PBD solver descriptor set: pbd_states(0), pbd_params(1),
    // pbd_constraints(2), pbd_uniforms(3)
    VkDescriptorBufferInfo pbd_state_info{resources_->pbd_state_ssbo.buffer(), 0, VK_WHOLE_SIZE};
    VkDescriptorBufferInfo pbd_params_info{resources_->pbd_params_ssbo.buffer(), 0, VK_WHOLE_SIZE};
    VkDescriptorBufferInfo pbd_constraint_info{resources_->pbd_constraint_ssbo.buffer(), 0, VK_WHOLE_SIZE};
    VkDescriptorBufferInfo pbd_ubo_info{resources_->pbd_uniform_buffer.buffer(), 0, 32};
    VkWriteDescriptorSet writes[] = {
        {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, pbd_set_, 0, 0, 1,
         VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_state_info, nullptr},
        {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, pbd_set_, 1, 0, 1,
         VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_params_info, nullptr},
        {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, pbd_set_, 2, 0, 1,
         VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_constraint_info, nullptr},
        {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, pbd_set_, 3, 0, 1,
         VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &pbd_ubo_info, nullptr},
    };
    vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
}

void GsPbdSystem::upload_elements(const PbdPhysicsState* states,
                                   const PbdElementParams* params,
                                   uint32_t count) {
    if (count == 0) return;
    uint32_t n = std::min(count, kMaxPbdElements);
    if (resources_->pbd_state_ssbo.mapped())
        std::memcpy(resources_->pbd_state_ssbo.mapped(), states, n * sizeof(PbdPhysicsState));
    if (resources_->pbd_params_ssbo.mapped())
        std::memcpy(resources_->pbd_params_ssbo.mapped(), params, n * sizeof(PbdElementParams));
    pbd_count_ = n;
}

void GsPbdSystem::upload_constraints(const PbdConstraint* constraints, uint32_t count) {
    if (count == 0) return;
    uint32_t n = std::min(count, kMaxPbdConstraints);
    if (resources_->pbd_constraint_ssbo.mapped())
        std::memcpy(resources_->pbd_constraint_ssbo.mapped(), constraints, n * sizeof(PbdConstraint));
    pbd_constraint_count_ = n;
}

void GsPbdSystem::clear() {
    pbd_count_            = 0;
    pbd_constraint_count_ = 0;
    if (resources_->pbd_state_ssbo.mapped()) {
        auto* s = static_cast<PbdPhysicsState*>(resources_->pbd_state_ssbo.mapped());
        for (uint32_t i = 0; i < kMaxPbdElements; ++i) {
            s[i] = PbdPhysicsState{};
            s[i].prev_position = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);  // identity quat
        }
    }
    if (resources_->pbd_params_ssbo.mapped())
        std::memset(resources_->pbd_params_ssbo.mapped(), 0, kMaxPbdElements * sizeof(PbdElementParams));
    if (resources_->pbd_constraint_ssbo.mapped())
        std::memset(resources_->pbd_constraint_ssbo.mapped(), 0, kMaxPbdConstraints * sizeof(PbdConstraint));
}

void GsPbdSystem::dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                            float time, bool determinism_test_active) noexcept {
    (void)frame_in_flight;  // PBD set is not per-frame; reserved for API symmetry.
    if (pbd_count_ == 0 || determinism_test_active) return;

    GS_LABEL(cmd, "PBD");

    struct {
        float    time;
        float    dt;
        uint32_t iterations;
        uint32_t count;
        uint32_t constraint_count;
        uint32_t pad[3];
    } pbd_ubo;
    pbd_ubo.time             = time;
    pbd_ubo.dt               = 1.0f / 60.0f;
    pbd_ubo.iterations       = kPbdSolverIterations;
    pbd_ubo.count            = pbd_count_;
    pbd_ubo.constraint_count = pbd_constraint_count_;
    pbd_ubo.pad[0] = pbd_ubo.pad[1] = pbd_ubo.pad[2] = 0;
    std::memcpy(resources_->pbd_uniform_buffer.mapped(), &pbd_ubo, sizeof(pbd_ubo));

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pbd_pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            pbd_pipeline_layout_, 0, 1, &pbd_set_, 0, nullptr);
    vkCmdPushConstants(cmd, pbd_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                       0, sizeof(uint32_t), &pbd_count_);
    vkCmdDispatch(cmd, (pbd_count_ + 63) / 64, 1, 1);

    // PBD write → preprocess read barrier (spec §5.4).
    // This is the final operation dispatch() emits; the caller's next system
    // (preprocess) sees finished writes to pbd_state_ssbo.
    VkMemoryBarrier pbd_barrier{};
    pbd_barrier.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    pbd_barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    pbd_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        0, 1, &pbd_barrier, 0, nullptr, 0, nullptr);
}

void GsPbdSystem::shutdown() {
    if (device_ == VK_NULL_HANDLE) return;
    // Descriptor sets are freed automatically when gs_pool_ is destroyed
    // by GsRenderer::shutdown(); no individual free needed.
    if (pbd_pipeline_)        { vkDestroyPipeline(device_, pbd_pipeline_, nullptr);             pbd_pipeline_        = VK_NULL_HANDLE; }
    if (pbd_pipeline_layout_) { vkDestroyPipelineLayout(device_, pbd_pipeline_layout_, nullptr); pbd_pipeline_layout_ = VK_NULL_HANDLE; }
    if (pbd_set_layout_)      { vkDestroyDescriptorSetLayout(device_, pbd_set_layout_, nullptr); pbd_set_layout_      = VK_NULL_HANDLE; }
    pbd_set_    = VK_NULL_HANDLE;
    device_     = VK_NULL_HANDLE;
}

}  // namespace gseurat
