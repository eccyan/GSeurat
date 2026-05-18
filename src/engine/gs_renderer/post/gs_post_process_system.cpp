#include "gseurat/engine/gs_renderer/post/gs_post_process_system.hpp"

#include "gseurat/engine/gs_renderer/gs_resources.hpp"
#include "gseurat/engine/pipeline.hpp"

#include <glm/glm.hpp>

#include <cassert>
#include <cstring>
#include <stdexcept>
#include <string>

namespace gseurat {

GsPostProcessSystem::~GsPostProcessSystem() {
    shutdown();
}

void GsPostProcessSystem::init(VkDevice device, VkPipelineCache pipeline_cache,
                                VkDescriptorPool pool, GsResourceManager* resources) {
    assert(device != VK_NULL_HANDLE);
    assert(pool != VK_NULL_HANDLE);
    assert(resources != nullptr);
    device_ = device;
    resources_ = resources;

    // Set layout: { input_image(readonly), depth_image(readonly), output_image(writeonly), ubo }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // input
            {1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // depth
            {2, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // output
            {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // UBO
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 4;
        ci.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &set_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsPostProcessSystem: failed to create descriptor set layout");
        }
    }

    // Pipeline: gs_post_process.comp, no push constants (dimensions in UBO).
    {
        auto module = load_shader_module(device_, "shaders/gs_post_process.comp.spv");

        VkPipelineLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        layout_info.setLayoutCount = 1;
        layout_info.pSetLayouts = &set_layout_;
        if (vkCreatePipelineLayout(device_, &layout_info, nullptr, &pipeline_layout_) != VK_SUCCESS) {
            vkDestroyShaderModule(device_, module, nullptr);
            throw std::runtime_error("GsPostProcessSystem: failed to create pipeline layout");
        }

        VkComputePipelineCreateInfo pi{};
        pi.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pi.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pi.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pi.stage.module = module;
        pi.stage.pName = "main";
        pi.layout = pipeline_layout_;
        VkResult res = vkCreateComputePipelines(device_, pipeline_cache, 1, &pi, nullptr, &pipeline_);
        vkDestroyShaderModule(device_, module, nullptr);
        if (res != VK_SUCCESS) {
            throw std::runtime_error("GsPostProcessSystem: failed to create pipeline");
        }
    }

    // Allocate two descriptor sets (one per frame in flight) from the shared
    // gs_pool_. Pool capacity covers this — the central batch shrank by 2
    // when this system took ownership of these sets.
    {
        VkDescriptorSetLayout layouts[kMaxFramesInFlight];
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) layouts[f] = set_layout_;

        VkDescriptorSetAllocateInfo alloc{};
        alloc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        alloc.descriptorPool = pool;
        alloc.descriptorSetCount = kMaxFramesInFlight;
        alloc.pSetLayouts = layouts;
        if (vkAllocateDescriptorSets(device_, &alloc, sets_.data()) != VK_SUCCESS) {
            throw std::runtime_error("GsPostProcessSystem: vkAllocateDescriptorSets failed");
        }
    }
}

void GsPostProcessSystem::write_descriptors() {
    assert(device_ != VK_NULL_HANDLE);
    assert(resources_ != nullptr);
    // Per-frame: each sets_[i] binds frame i's output, depth, processed views.
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorImageInfo input_info{VK_NULL_HANDLE, resources_->output_views[f],    VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorImageInfo depth_info{VK_NULL_HANDLE, resources_->depth_views[f],     VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorImageInfo proc_info {VK_NULL_HANDLE, resources_->processed_views[f], VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo ubo_info{resources_->pp_ubo_buffer.buffer(), 0, sizeof(GsPostProcessUbo)};

        VkDescriptorSet set = sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  &input_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  &depth_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  &proc_info,  nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr,     &ubo_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
    }
}

void GsPostProcessSystem::dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                    uint32_t width, uint32_t height) {
    assert(pipeline_ != VK_NULL_HANDLE && "init() must run first");
    assert(frame_in_flight < kMaxFramesInFlight);

    // Update post-process UBO.
    GsPostProcessUbo pp_ubo{};
    pp_ubo.fog_params = glm::vec4(params_.fog_density,
                                   params_.fog_color_r,
                                   params_.fog_color_g,
                                   params_.fog_color_b);
    pp_ubo.exposure_vignette = glm::vec4(params_.exposure,
                                          params_.vignette_radius,
                                          params_.vignette_softness,
                                          params_.bloom_intensity);
    pp_ubo.bloom_fade = glm::vec4(params_.bloom_threshold,
                                   params_.fade_amount,
                                   params_.flash_r,
                                   params_.flash_g);
    pp_ubo.effects = glm::vec4(params_.flash_b,
                                params_.ca_intensity,
                                params_.dof_focus_distance,
                                params_.dof_focus_range);
    pp_ubo.dimensions = glm::vec4(params_.dof_max_blur,
                                   static_cast<float>(width),
                                   static_cast<float>(height),
                                   params_.far_plane);
    pp_ubo.ground_sky = glm::vec4(params_.ground_color, params_.horizon_y);
    pp_ubo.sky_enable = glm::vec4(params_.sky_color,
                                   params_.background_enabled ? 1.0f : 0.0f);
    pp_ubo.overlay = glm::vec4(params_.overlay_r,
                                params_.overlay_g,
                                params_.overlay_b,
                                params_.overlay_alpha);
    pp_ubo.overlay_effect_type = params_.overlay_effect_type;
    pp_ubo._pad0 = pp_ubo._pad1 = pp_ubo._pad2 = 0;
    std::memcpy(resources_->pp_ubo_buffer.mapped(), &pp_ubo, sizeof(pp_ubo));

    // Transition this frame's processed image to GENERAL for compute write.
    {
        VkImageMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barrier.srcAccessMask = 0;
        barrier.dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        barrier.newLayout = VK_IMAGE_LAYOUT_GENERAL;
        barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.image = resources_->processed_images[frame_in_flight];
        barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 0, nullptr, 0, nullptr, 1, &barrier);
    }

    // Dispatch (same tile grid as render).
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_);
    VkDescriptorSet set = sets_[frame_in_flight];
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            pipeline_layout_, 0, 1, &set, 0, nullptr);
    uint32_t tiles_x = (width + 15) / 16;
    uint32_t tiles_y = (height + 15) / 16;
    vkCmdDispatch(cmd, tiles_x, tiles_y, 1);

    // Phase 5e: processed_image GENERAL → SHADER_READ_ONLY_OPTIMAL
    // (formerly emitted from GsRenderer::render after post_.dispatch).
    {
        VkImageMemoryBarrier barrier{};
        barrier.sType            = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barrier.srcAccessMask    = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask    = VK_ACCESS_SHADER_READ_BIT;
        barrier.oldLayout        = VK_IMAGE_LAYOUT_GENERAL;
        barrier.newLayout        = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.image            = resources_->processed_images[frame_in_flight];
        barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
            0, 0, nullptr, 0, nullptr, 1, &barrier);
    }
}

void GsPostProcessSystem::shutdown() {
    if (device_ == VK_NULL_HANDLE) return;

    if (pipeline_) {
        vkDestroyPipeline(device_, pipeline_, nullptr);
        pipeline_ = VK_NULL_HANDLE;
    }
    if (pipeline_layout_) {
        vkDestroyPipelineLayout(device_, pipeline_layout_, nullptr);
        pipeline_layout_ = VK_NULL_HANDLE;
    }
    if (set_layout_) {
        vkDestroyDescriptorSetLayout(device_, set_layout_, nullptr);
        set_layout_ = VK_NULL_HANDLE;
    }
    // sets_ are owned by the descriptor pool; pool teardown reclaims them.
    sets_.fill(VK_NULL_HANDLE);

    device_ = VK_NULL_HANDLE;
    resources_ = nullptr;
}

}  // namespace gseurat
