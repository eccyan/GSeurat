#include "gseurat/engine/gs_renderer/sort/gs_sort_system.hpp"

#include "gseurat/engine/debug.hpp"
#include "gseurat/engine/gs_renderer/gs_renderer_internal.hpp"
#include "gseurat/engine/gs_renderer/gs_resources.hpp"
#include "gseurat/engine/gs_renderer/streaming/gs_streaming_system.hpp"
#include "gseurat/engine/pipeline.hpp"
#include "gseurat/engine/render_state.hpp"  // RenderState::bones_buffer
#include "gseurat/engine/sort_entry.hpp"

#include <cassert>
#include <stdexcept>
#include <string>

namespace gseurat {

GsSortSystem::~GsSortSystem() {
    shutdown();
}

void GsSortSystem::init(VkDevice device, VkPipelineCache pipeline_cache,
                         VkDescriptorPool pool, GsResourceManager* resources) {
    assert(device != VK_NULL_HANDLE);
    assert(pool != VK_NULL_HANDLE);
    assert(resources != nullptr);
    device_ = device;
    resources_ = resources;

    // ── Set layouts ───────────────────────────────────────────────────
    // Onesweep histogram layout: { input(0), status(1), indirect_args(2) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 3;
        ci.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &onesweep_hist_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsSortSystem: failed onesweep_hist descriptor set layout");
        }
    }
    // Onesweep scatter layout: { input(0), output(1), status(2), indirect_args(3) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 4;
        ci.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &onesweep_scatter_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsSortSystem: failed onesweep_scatter descriptor set layout");
        }
    }
    // Merge layout: { static_sort(0), dynamic_sort(1), merged_sort(2), counts(3) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 4;
        ci.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &merge_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsSortSystem: failed merge descriptor set layout");
        }
    }

    // ── Pipelines ─────────────────────────────────────────────────────
    auto create_pipeline = [&](const char* spv_path, VkDescriptorSetLayout layout,
                                uint32_t push_size,
                                VkPipelineLayout& out_layout, VkPipeline& out_pipeline) {
        auto module = load_shader_module(device_, spv_path);

        VkPipelineLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        layout_info.setLayoutCount = 1;
        layout_info.pSetLayouts = &layout;

        VkPushConstantRange push_range{};
        if (push_size > 0) {
            push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
            push_range.size = push_size;
            layout_info.pushConstantRangeCount = 1;
            layout_info.pPushConstantRanges = &push_range;
        }
        if (vkCreatePipelineLayout(device_, &layout_info, nullptr, &out_layout) != VK_SUCCESS) {
            vkDestroyShaderModule(device_, module, nullptr);
            throw std::runtime_error(std::string("GsSortSystem: pipeline layout: ") + spv_path);
        }

        VkComputePipelineCreateInfo pi{};
        pi.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pi.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pi.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pi.stage.module = module;
        pi.stage.pName = "main";
        pi.layout = out_layout;
        VkResult res = vkCreateComputePipelines(device_, pipeline_cache, 1, &pi, nullptr, &out_pipeline);
        vkDestroyShaderModule(device_, module, nullptr);
        if (res != VK_SUCCESS) {
            throw std::runtime_error(std::string("GsSortSystem: pipeline create: ") + spv_path);
        }
    };

    create_pipeline("shaders/gs_onesweep_histogram.comp.spv", onesweep_hist_layout_, 4,
                    onesweep_hist_pipeline_layout_, onesweep_hist_pipeline_);
    create_pipeline("shaders/gs_onesweep_scatter.comp.spv", onesweep_scatter_layout_, 4,
                    onesweep_scatter_pipeline_layout_, onesweep_scatter_pipeline_);
    create_pipeline("shaders/gs_merge.comp.spv", merge_layout_, 0,
                    merge_pipeline_layout_, merge_pipeline_);

    // ── Descriptor set allocation ─────────────────────────────────────
    // 26 sets total = 12 depth (legacy/static/dynamic × 4 each) × 2 frames
    //                + 2 merge.
    constexpr uint32_t kSetsPerFrame = 12;            // 4 (legacy) + 4 (static) + 4 (dynamic)
    constexpr uint32_t kTotalDepth   = kSetsPerFrame * kMaxFramesInFlight;
    constexpr uint32_t kTotalMerge   = kMaxFramesInFlight;
    constexpr uint32_t kTotal        = kTotalDepth + kTotalMerge;

    VkDescriptorSetLayout layouts[kTotal];
    uint32_t i = 0;
    // Legacy depth: hist_a, hist_b, scatter_ab, scatter_ba — per frame
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        layouts[i++] = onesweep_hist_layout_;     // depth_hist_a
        layouts[i++] = onesweep_hist_layout_;     // depth_hist_b
        layouts[i++] = onesweep_scatter_layout_;  // depth_scatter_ab
        layouts[i++] = onesweep_scatter_layout_;  // depth_scatter_ba
    }
    // Static depth — per frame
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        layouts[i++] = onesweep_hist_layout_;
        layouts[i++] = onesweep_hist_layout_;
        layouts[i++] = onesweep_scatter_layout_;
        layouts[i++] = onesweep_scatter_layout_;
    }
    // Dynamic depth — per frame
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        layouts[i++] = onesweep_hist_layout_;
        layouts[i++] = onesweep_hist_layout_;
        layouts[i++] = onesweep_scatter_layout_;
        layouts[i++] = onesweep_scatter_layout_;
    }
    // Merge — per frame
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        layouts[i++] = merge_layout_;
    }
    assert(i == kTotal);

    VkDescriptorSet sets[kTotal];
    VkDescriptorSetAllocateInfo alloc{};
    alloc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloc.descriptorPool = pool;
    alloc.descriptorSetCount = kTotal;
    alloc.pSetLayouts = layouts;
    if (vkAllocateDescriptorSets(device_, &alloc, sets) != VK_SUCCESS) {
        throw std::runtime_error("GsSortSystem: vkAllocateDescriptorSets failed");
    }

    // Unpack into per-path arrays
    i = 0;
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        depth_hist_sets_a_[f]      = sets[i++];
        depth_hist_sets_b_[f]      = sets[i++];
        depth_scatter_sets_ab_[f]  = sets[i++];
        depth_scatter_sets_ba_[f]  = sets[i++];
    }
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        static_depth_hist_sets_a_[f]      = sets[i++];
        static_depth_hist_sets_b_[f]      = sets[i++];
        static_depth_scatter_sets_ab_[f]  = sets[i++];
        static_depth_scatter_sets_ba_[f]  = sets[i++];
    }
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        dynamic_depth_hist_sets_a_[f]     = sets[i++];
        dynamic_depth_hist_sets_b_[f]     = sets[i++];
        dynamic_depth_scatter_sets_ab_[f] = sets[i++];
        dynamic_depth_scatter_sets_ba_[f] = sets[i++];
    }
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        merge_sets_[f] = sets[i++];
    }
    assert(i == kTotal);

    // ── Preprocess layout + pipeline (Phase 5e — moved from GsRenderer) ──
    // Layout: { gaussians(0), projected(1), sort_keys(2), uniforms(3),
    //           visible_count(4), bones(5), pbd_states(6), page_table(8) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,  1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // PBD
            {8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // Page table
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 8;
        ci.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &preprocess_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsSortSystem: failed preprocess descriptor set layout");
        }
    }

    // The preprocess shader exposes two specialization constants:
    //   id=0: SPLATS_PER_SLAB (default 100000) — divisor used by
    //         resolve_physical_index() to split a logical chunk index
    //         into {slab_logical, offset_in_slab}.
    //   id=1: USE_PAGE_TABLE     (default 0)   — when 1, the shader
    //         resolves through `page_table[]` to translate logical
    //         slab indices to physical slab offsets.
    //
    // The static path must use USE_PAGE_TABLE=1: clear_chunks releases
    // overworld slabs back to a LIFO free-list, so the next chunk gets
    // assigned a non-zero slab index (e.g. dungeon = slab 16) and the
    // direct-addressed read would land in the zeroed region. The
    // dynamic path leaves USE_PAGE_TABLE=0 — dynamic_gaussian_ssbo is
    // densely packed without slabs.
    //
    // SPLATS_PER_SLAB must match streaming_config.slab_size_splats; the
    // engine default (100000, see streaming_config.hpp) matches the
    // shader default, so we keep it constant here. If we ever want to
    // make slab size configurable per scene, this site needs to plumb
    // the runtime value through.
    struct PreprocessSpec {
        uint32_t splats_per_slab;
        uint32_t use_page_table;
    };
    PreprocessSpec static_spec{100000u, 1u};
    PreprocessSpec dynamic_spec{100000u, 0u};
    VkSpecializationMapEntry spec_map[2] = {
        {0, offsetof(PreprocessSpec, splats_per_slab), sizeof(uint32_t)},
        {1, offsetof(PreprocessSpec, use_page_table),  sizeof(uint32_t)},
    };
    VkSpecializationInfo static_spec_info{
        2, spec_map, sizeof(PreprocessSpec), &static_spec};
    VkSpecializationInfo dynamic_spec_info{
        2, spec_map, sizeof(PreprocessSpec), &dynamic_spec};

    // Create the shared pipeline layout (one push-constant range, one
    // descriptor set layout — same for both specializations).
    {
        VkPushConstantRange push_range{};
        push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        push_range.size = static_cast<uint32_t>(sizeof(GsPreprocessPush));

        VkPipelineLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        layout_info.setLayoutCount = 1;
        layout_info.pSetLayouts = &preprocess_layout_;
        layout_info.pushConstantRangeCount = 1;
        layout_info.pPushConstantRanges = &push_range;
        if (vkCreatePipelineLayout(device_, &layout_info, nullptr,
                                    &preprocess_pipeline_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsSortSystem: preprocess pipeline layout");
        }
    }

    auto create_preprocess_pipeline = [&](const VkSpecializationInfo* spec_info,
                                           VkPipeline& out_pipeline) {
        auto module = load_shader_module(device_, "shaders/gs_preprocess.comp.spv");
        VkComputePipelineCreateInfo pi{};
        pi.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pi.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pi.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pi.stage.module = module;
        pi.stage.pName = "main";
        pi.stage.pSpecializationInfo = spec_info;
        pi.layout = preprocess_pipeline_layout_;
        VkResult res = vkCreateComputePipelines(device_, pipeline_cache, 1, &pi,
                                                 nullptr, &out_pipeline);
        vkDestroyShaderModule(device_, module, nullptr);
        if (res != VK_SUCCESS) {
            throw std::runtime_error("GsSortSystem: preprocess pipeline create failed");
        }
    };
    create_preprocess_pipeline(&static_spec_info,  static_preprocess_pipeline_);
    create_preprocess_pipeline(&dynamic_spec_info, dynamic_preprocess_pipeline_);

    // Allocate 4 preprocess descriptor sets (2 static + 2 dynamic, per frame).
    {
        VkDescriptorSetLayout prep_layouts[kMaxFramesInFlight * 2];
        for (uint32_t f = 0; f < kMaxFramesInFlight * 2; ++f) {
            prep_layouts[f] = preprocess_layout_;
        }
        VkDescriptorSet prep_sets[kMaxFramesInFlight * 2];
        VkDescriptorSetAllocateInfo prep_alloc{};
        prep_alloc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        prep_alloc.descriptorPool = pool;
        prep_alloc.descriptorSetCount = kMaxFramesInFlight * 2;
        prep_alloc.pSetLayouts = prep_layouts;
        if (vkAllocateDescriptorSets(device_, &prep_alloc, prep_sets) != VK_SUCCESS) {
            throw std::runtime_error("GsSortSystem: preprocess vkAllocateDescriptorSets failed");
        }
        // Layout: [0] static[0], [1] dynamic[0], [2] static[1], [3] dynamic[1]
        static_preprocess_sets_[0]  = prep_sets[0];
        dynamic_preprocess_sets_[0] = prep_sets[1];
        static_preprocess_sets_[1]  = prep_sets[2];
        dynamic_preprocess_sets_[1] = prep_sets[3];
    }
}

void GsSortSystem::set_sort_sizes(uint32_t static_sort_size, uint32_t static_sort_workgroups,
                                   uint32_t dynamic_sort_size, uint32_t dynamic_sort_workgroups,
                                   uint32_t legacy_sort_size, uint32_t legacy_sort_workgroups,
                                   uint32_t num_passes, uint32_t depth_onesweep_max_wg) {
    static_sort_size_         = static_sort_size;
    static_sort_workgroups_   = static_sort_workgroups;
    dynamic_sort_size_        = dynamic_sort_size;
    dynamic_sort_workgroups_  = dynamic_sort_workgroups;
    legacy_sort_size_         = legacy_sort_size;
    legacy_sort_workgroups_   = legacy_sort_workgroups;
    num_passes_               = num_passes;
    depth_onesweep_max_wg_    = depth_onesweep_max_wg;
}

void GsSortSystem::write_depth_set_quad(VkDescriptorSet hist_a, VkDescriptorSet hist_b,
                                         VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba,
                                         VkBuffer sort_a, VkBuffer sort_b,
                                         VkBuffer status_buf, VkBuffer params_buf) {
    VkDescriptorBufferInfo st_info{status_buf, 0, VK_WHOLE_SIZE};
    VkDescriptorBufferInfo pm_info{params_buf, 0, VK_WHOLE_SIZE};
    // Histogram A: input(0)=sort_a, status(1), params(2)
    { VkDescriptorBufferInfo in_info{sort_a, 0, VK_WHOLE_SIZE};
      VkWriteDescriptorSet w[] = {
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
      }; vkUpdateDescriptorSets(device_, 3, w, 0, nullptr); }
    // Histogram B: input(0)=sort_b
    { VkDescriptorBufferInfo in_info{sort_b, 0, VK_WHOLE_SIZE};
      VkWriteDescriptorSet w[] = {
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
      }; vkUpdateDescriptorSets(device_, 3, w, 0, nullptr); }
    // Scatter A→B: input(0)=sort_a, output(1)=sort_b
    { VkDescriptorBufferInfo in_info{sort_a, 0, VK_WHOLE_SIZE};
      VkDescriptorBufferInfo out_info{sort_b, 0, VK_WHOLE_SIZE};
      VkWriteDescriptorSet w[] = {
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 3, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
      }; vkUpdateDescriptorSets(device_, 4, w, 0, nullptr); }
    // Scatter B→A: input(0)=sort_b, output(1)=sort_a
    { VkDescriptorBufferInfo in_info{sort_b, 0, VK_WHOLE_SIZE};
      VkDescriptorBufferInfo out_info{sort_a, 0, VK_WHOLE_SIZE};
      VkWriteDescriptorSet w[] = {
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
          {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 3, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
      }; vkUpdateDescriptorSets(device_, 4, w, 0, nullptr); }
}

void GsSortSystem::write_descriptors() {
    assert(device_ != VK_NULL_HANDLE);
    assert(resources_ != nullptr);

    // Legacy depth sort (sort_keys / sort_b ping-pong)
    if (resources_->depth_onesweep_statuses[0].buffer() && resources_->depth_sort_params.buffer()) {
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            write_depth_set_quad(
                depth_hist_sets_a_[f], depth_hist_sets_b_[f],
                depth_scatter_sets_ab_[f], depth_scatter_sets_ba_[f],
                resources_->sort_keys_ssbos[f].buffer(),
                resources_->sort_b_ssbos[f].buffer(),
                resources_->depth_onesweep_statuses[f].buffer(),
                resources_->depth_sort_params.buffer());
        }
    }

    // Static + dynamic depth sort (separate static_*/dynamic_* params).
    if (resources_->depth_onesweep_statuses[0].buffer() && resources_->static_depth_params.buffer()) {
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            write_depth_set_quad(
                static_depth_hist_sets_a_[f], static_depth_hist_sets_b_[f],
                static_depth_scatter_sets_ab_[f], static_depth_scatter_sets_ba_[f],
                resources_->static_sort_as[f].buffer(),
                resources_->static_sort_bs[f].buffer(),
                resources_->depth_onesweep_statuses[f].buffer(),
                resources_->static_depth_params.buffer());
        }
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            write_depth_set_quad(
                dynamic_depth_hist_sets_a_[f], dynamic_depth_hist_sets_b_[f],
                dynamic_depth_scatter_sets_ab_[f], dynamic_depth_scatter_sets_ba_[f],
                resources_->dynamic_sort_as[f].buffer(),
                resources_->dynamic_sort_bs[f].buffer(),
                resources_->depth_onesweep_statuses[f].buffer(),
                resources_->dynamic_depth_params.buffer());
        }
    }

    // Merge — only after the split buffers are allocated.
    if (resources_->static_gaussian_ssbo.buffer() && resources_->counts_ssbos[0].buffer()) {
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            VkDescriptorBufferInfo static_info{resources_->static_sort_as[f].buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo dynamic_info{resources_->dynamic_sort_as[f].buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo merged_info{resources_->merged_sort_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo counts_info{resources_->counts_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};

            VkDescriptorSet merge_set = merge_sets_[f];
            VkWriteDescriptorSet writes[] = {
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, merge_set, 0, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &static_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, merge_set, 1, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &dynamic_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, merge_set, 2, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &merged_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, merge_set, 3, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
            };
            vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
        }
    }

    // Preprocess sets — only after split buffers are allocated (Phase 5e).
    if (!resources_->static_gaussian_ssbo.buffer() || !resources_->counts_ssbos[0].buffer()) return;

    // Static preprocess set: static_gaussian(0), projected(1), static_sort_a(2),
    // uniforms(3), counts[0](4), bones(5), pbd(6), page_table(8)
    // sizeof(GsUniforms) matches the buffer allocation; avoids VK_WHOLE_SIZE UBO ambiguity.
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo gaussian_info{resources_->static_gaussian_ssbo.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo projected_info{resources_->projected_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{resources_->static_sort_as[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{resources_->uniform_buffer.buffer(), 0, resources_->uniform_buffer_size};
        VkDescriptorBufferInfo counts_info{resources_->counts_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo bone_info{render_state_ ? render_state_->bones_buffer(FrameIndex{f}) : VK_NULL_HANDLE, 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_info{resources_->pbd_state_ssbo.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo page_table_info{resources_->page_table_ssbo.buffer(), 0, VK_WHOLE_SIZE};

        VkDescriptorSet set = static_preprocess_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &gaussian_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &bone_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 6, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 8, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &page_table_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 8, writes, 0, nullptr);
    }

    // Dynamic preprocess set: dynamic_gaussian(0), projected(1), dynamic_sort_a(2),
    // uniforms(3), counts[1](4), bones(5), pbd(6), page_table(8)
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo gaussian_info{resources_->dynamic_gaussian_ssbo.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo projected_info{resources_->projected_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{resources_->dynamic_sort_as[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{resources_->uniform_buffer.buffer(), 0, resources_->uniform_buffer_size};
        VkDescriptorBufferInfo counts_info{resources_->counts_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo bone_info{render_state_ ? render_state_->bones_buffer(FrameIndex{f}) : VK_NULL_HANDLE, 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_info{resources_->pbd_state_ssbo.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo page_table_info{resources_->page_table_ssbo.buffer(), 0, VK_WHOLE_SIZE};

        VkDescriptorSet set = dynamic_preprocess_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &gaussian_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &bone_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 6, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 8, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &page_table_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 8, writes, 0, nullptr);
    }
}

void GsSortSystem::dispatch_depth_onesweep_impl(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                                  uint32_t num_workgroups,
                                                  VkDescriptorSet hist_a, VkDescriptorSet hist_b,
                                                  VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba) {
    GS_LABEL(cmd, "DepthSort");
    // Clear the per-frame status buffer slot. The descriptor sets bind
    // resources_->depth_onesweep_statuses[frame_in_flight] for both
    // histogram and scatter passes.
    VkDeviceSize status_clear_size = static_cast<VkDeviceSize>(num_passes_) * 256ull
                                     * depth_onesweep_max_wg_ * sizeof(uint32_t);
    vkCmdFillBuffer(cmd, resources_->depth_onesweep_statuses[frame_in_flight].buffer(),
                    0, status_clear_size, 0);
    {
        VkMemoryBarrier sb{};
        sb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        sb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        sb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &sb, 0, nullptr, 0, nullptr);
    }

    for (uint32_t pass = 0; pass < num_passes_; pass++) {
        uint32_t push_data[1] = {pass};
        bool read_from_a = (pass % 2 == 0);

        // Histogram + decoupled lookback
        {
            GS_LABEL(cmd, "Histogram");
            VkDescriptorSet hist_set = read_from_a ? hist_a : hist_b;
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, onesweep_hist_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    onesweep_hist_pipeline_layout_, 0, 1, &hist_set, 0, nullptr);
            vkCmdPushConstants(cmd, onesweep_hist_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                               0, 4, push_data);
            vkCmdDispatch(cmd, num_workgroups, 1, 1);
        }

        insert_compute_barrier(cmd);

        // Scatter
        {
            GS_LABEL(cmd, "Scatter");
            VkDescriptorSet scatter_set = read_from_a ? scatter_ab : scatter_ba;
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, onesweep_scatter_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    onesweep_scatter_pipeline_layout_, 0, 1, &scatter_set, 0, nullptr);
            vkCmdPushConstants(cmd, onesweep_scatter_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                               0, 4, push_data);
            vkCmdDispatch(cmd, num_workgroups, 1, 1);
        }

        insert_compute_barrier(cmd);
    }
    // After even number of passes, sorted result is in buffer A.
}

void GsSortSystem::dispatch_depth_dynamic(VkCommandBuffer cmd, uint32_t frame_in_flight) {
    assert(frame_in_flight < kMaxFramesInFlight);
    dispatch_depth_onesweep_impl(cmd, frame_in_flight, dynamic_sort_workgroups_,
        dynamic_depth_hist_sets_a_[frame_in_flight], dynamic_depth_hist_sets_b_[frame_in_flight],
        dynamic_depth_scatter_sets_ab_[frame_in_flight], dynamic_depth_scatter_sets_ba_[frame_in_flight]);
}

void GsSortSystem::dispatch_depth_static(VkCommandBuffer cmd, uint32_t frame_in_flight) {
    assert(frame_in_flight < kMaxFramesInFlight);
    dispatch_depth_onesweep_impl(cmd, frame_in_flight, static_sort_workgroups_,
        static_depth_hist_sets_a_[frame_in_flight], static_depth_hist_sets_b_[frame_in_flight],
        static_depth_scatter_sets_ab_[frame_in_flight], static_depth_scatter_sets_ba_[frame_in_flight]);
}

void GsSortSystem::dispatch_merge(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                   uint32_t total_upper) {
    assert(frame_in_flight < kMaxFramesInFlight);
    GS_LABEL(cmd, "Merge");
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, merge_pipeline_);
    VkDescriptorSet set = merge_sets_[frame_in_flight];
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            merge_pipeline_layout_, 0, 1, &set, 0, nullptr);
    vkCmdDispatch(cmd, (total_upper + 255) / 256, 1, 1);
}

std::array<GsSortSystem::PrewarmEntry, 5> GsSortSystem::prewarm_entries() const {
    return {{
        {onesweep_hist_pipeline_,     onesweep_hist_pipeline_layout_,    onesweep_hist_layout_},
        {onesweep_scatter_pipeline_,  onesweep_scatter_pipeline_layout_, onesweep_scatter_layout_},
        {merge_pipeline_,             merge_pipeline_layout_,            merge_layout_},
        {static_preprocess_pipeline_,  preprocess_pipeline_layout_,      preprocess_layout_},
        {dynamic_preprocess_pipeline_, preprocess_pipeline_layout_,      preprocess_layout_},
    }};
}

void GsSortSystem::dispatch_preprocess(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                        uint32_t count, uint32_t static_offset,
                                        bool is_static) {
    if (count == 0) return;
    GS_LABEL(cmd, is_static ? "Preprocess.Static" : "Preprocess.Dynamic");

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                      is_static ? static_preprocess_pipeline_
                                : dynamic_preprocess_pipeline_);
    VkDescriptorSet set = is_static
        ? static_preprocess_sets_[frame_in_flight]
        : dynamic_preprocess_sets_[frame_in_flight];
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            preprocess_pipeline_layout_, 0, 1, &set, 0, nullptr);
    GsPreprocessPush push{static_offset, count, is_static ? 0u : 1u};
    vkCmdPushConstants(cmd, preprocess_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                       0, sizeof(GsPreprocessPush), &push);
    vkCmdDispatch(cmd, (count + 255) / 256, 1, 1);
}

void GsSortSystem::shutdown() {
    if (device_ == VK_NULL_HANDLE) return;

    if (onesweep_hist_pipeline_)    { vkDestroyPipeline(device_, onesweep_hist_pipeline_,    nullptr); onesweep_hist_pipeline_ = VK_NULL_HANDLE; }
    if (onesweep_scatter_pipeline_) { vkDestroyPipeline(device_, onesweep_scatter_pipeline_, nullptr); onesweep_scatter_pipeline_ = VK_NULL_HANDLE; }
    if (merge_pipeline_)            { vkDestroyPipeline(device_, merge_pipeline_,            nullptr); merge_pipeline_ = VK_NULL_HANDLE; }

    if (onesweep_hist_pipeline_layout_)    { vkDestroyPipelineLayout(device_, onesweep_hist_pipeline_layout_,    nullptr); onesweep_hist_pipeline_layout_ = VK_NULL_HANDLE; }
    if (onesweep_scatter_pipeline_layout_) { vkDestroyPipelineLayout(device_, onesweep_scatter_pipeline_layout_, nullptr); onesweep_scatter_pipeline_layout_ = VK_NULL_HANDLE; }
    if (merge_pipeline_layout_)            { vkDestroyPipelineLayout(device_, merge_pipeline_layout_,            nullptr); merge_pipeline_layout_ = VK_NULL_HANDLE; }

    if (onesweep_hist_layout_)    { vkDestroyDescriptorSetLayout(device_, onesweep_hist_layout_,    nullptr); onesweep_hist_layout_ = VK_NULL_HANDLE; }
    if (onesweep_scatter_layout_) { vkDestroyDescriptorSetLayout(device_, onesweep_scatter_layout_, nullptr); onesweep_scatter_layout_ = VK_NULL_HANDLE; }
    if (merge_layout_)            { vkDestroyDescriptorSetLayout(device_, merge_layout_,            nullptr); merge_layout_ = VK_NULL_HANDLE; }

    // Preprocess pipelines (Phase 5e — moved from GsRenderer). Two
    // specializations of the same shader, see init() for rationale.
    if (static_preprocess_pipeline_)  { vkDestroyPipeline(device_, static_preprocess_pipeline_,  nullptr); static_preprocess_pipeline_  = VK_NULL_HANDLE; }
    if (dynamic_preprocess_pipeline_) { vkDestroyPipeline(device_, dynamic_preprocess_pipeline_, nullptr); dynamic_preprocess_pipeline_ = VK_NULL_HANDLE; }
    if (preprocess_pipeline_layout_)  { vkDestroyPipelineLayout(device_, preprocess_pipeline_layout_, nullptr); preprocess_pipeline_layout_ = VK_NULL_HANDLE; }
    if (preprocess_layout_)           { vkDestroyDescriptorSetLayout(device_, preprocess_layout_, nullptr);     preprocess_layout_          = VK_NULL_HANDLE; }

    // Sets are pool-owned; pool teardown reclaims them.
    merge_sets_.fill(VK_NULL_HANDLE);
    depth_hist_sets_a_.fill(VK_NULL_HANDLE);
    depth_hist_sets_b_.fill(VK_NULL_HANDLE);
    depth_scatter_sets_ab_.fill(VK_NULL_HANDLE);
    depth_scatter_sets_ba_.fill(VK_NULL_HANDLE);
    static_depth_hist_sets_a_.fill(VK_NULL_HANDLE);
    static_depth_hist_sets_b_.fill(VK_NULL_HANDLE);
    static_depth_scatter_sets_ab_.fill(VK_NULL_HANDLE);
    static_depth_scatter_sets_ba_.fill(VK_NULL_HANDLE);
    dynamic_depth_hist_sets_a_.fill(VK_NULL_HANDLE);
    dynamic_depth_hist_sets_b_.fill(VK_NULL_HANDLE);
    dynamic_depth_scatter_sets_ab_.fill(VK_NULL_HANDLE);
    dynamic_depth_scatter_sets_ba_.fill(VK_NULL_HANDLE);
    static_preprocess_sets_.fill(VK_NULL_HANDLE);
    dynamic_preprocess_sets_.fill(VK_NULL_HANDLE);

    device_ = VK_NULL_HANDLE;
    resources_ = nullptr;
    render_state_ = nullptr;
}

void GsSortSystem::dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                             uint32_t dynamic_count,
                             GsStreamingSystem& streaming,
                             VkQueryPool timestamp_pool,
                             uint32_t ts_slot_offset) {
    GS_LABEL(cmd, "Sort");
    prepare_buffers(cmd, frame_in_flight, dynamic_count, streaming);

    // Depth sort timestamp: begin
    if (timestamp_pool != VK_NULL_HANDLE) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           timestamp_pool, ts_slot_offset + 0);
    }

    // Phase 1: dynamic preprocess + sort
    if (dynamic_count > 0) {
        GS_LABEL(cmd, "Dynamic");
        dispatch_preprocess(cmd, frame_in_flight, dynamic_count,
                            streaming.max_static_count(), /*is_static=*/false);
        insert_compute_barrier(cmd);
        dispatch_depth_dynamic(cmd, frame_in_flight);
    }

    // Phase 2: static preprocess + sort
    if (streaming.static_dirty() && streaming.static_count() > 0) {
        GS_LABEL(cmd, "Static");
        dispatch_preprocess(cmd, frame_in_flight, streaming.static_count(),
                            /*static_offset=*/0u, /*is_static=*/true);
        insert_compute_barrier(cmd);
        dispatch_depth_static(cmd, frame_in_flight);
        streaming.tick_static_dirty();
    }

    // Phase 3: merge (always — reads counts SSBO populated by preprocess shaders).
    // total_upper is the sort-slot upper bound (static + dynamic capacities), not
    // the actual visible count — the merge shader reads merged_visible_count from
    // the counts SSBO. Source both halves from `streaming` to avoid drift if a
    // future hot-reload path mutates streaming's size without calling set_sort_sizes.
    uint32_t total_upper = streaming.static_sort_size() + streaming.dynamic_sort_size();
    dispatch_merge(cmd, frame_in_flight, total_upper);

    // Sort → tile cross-system barrier (producer-side per spec §5.4)
    insert_compute_barrier(cmd);

    // Depth sort timestamp: end
    if (timestamp_pool != VK_NULL_HANDLE) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           timestamp_pool, ts_slot_offset + 1);
    }
}

void GsSortSystem::prepare_buffers(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                    uint32_t dynamic_count,
                                    GsStreamingSystem& streaming) {
    // 1. Static-tail fill (Phase 3 of #421 cross-frame race fix — moved into
    //    sort_ in Phase 5e step 3). Conservative fill: zero the tail
    //    [static_count, static_sort_size) of this slot's static_sort_a/b
    //    buffers when the dirty flag was set by publish_pending_chunks.
    if (streaming.is_static_tail_dirty(frame_in_flight) &&
        streaming.static_count() < streaming.static_sort_size()) {
        const VkDeviceSize entry_sz = sizeof(SortEntry);
        const VkDeviceSize fill_offset =
            static_cast<VkDeviceSize>(streaming.static_count()) * entry_sz;
        const VkDeviceSize fill_size =
            static_cast<VkDeviceSize>(streaming.static_sort_size() - streaming.static_count()) * entry_sz;
        vkCmdFillBuffer(cmd, resources_->static_sort_as[frame_in_flight].buffer(),
                        fill_offset, fill_size, 0xFFFFFFFFu);
        vkCmdFillBuffer(cmd, resources_->static_sort_bs[frame_in_flight].buffer(),
                        fill_offset, fill_size, 0xFFFFFFFFu);

        VkBufferMemoryBarrier sort_barriers[2]{};
        for (uint32_t i = 0; i < 2; ++i) {
            sort_barriers[i].sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
            sort_barriers[i].srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            sort_barriers[i].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
            sort_barriers[i].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            sort_barriers[i].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            sort_barriers[i].offset = 0;
            sort_barriers[i].size = VK_WHOLE_SIZE;
        }
        sort_barriers[0].buffer = resources_->static_sort_as[frame_in_flight].buffer();
        sort_barriers[1].buffer = resources_->static_sort_bs[frame_in_flight].buffer();
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 0, nullptr, 2, sort_barriers, 0, nullptr);
        streaming.clear_static_tail_dirty(frame_in_flight);
    }

    // 2. Counts SSBO reset — 12 bytes if static_dirty + static_count > 0,
    //    else 8 bytes from offset 4 (skip the static count slot).
    const bool static_dirty_this_frame =
        streaming.static_dirty() && streaming.static_count() > 0;
    if (static_dirty_this_frame) {
        vkCmdFillBuffer(cmd, resources_->counts_ssbos[frame_in_flight].buffer(), 0, 12, 0);
    } else {
        vkCmdFillBuffer(cmd, resources_->counts_ssbos[frame_in_flight].buffer(), 4, 8, 0);
    }

    // 3. Dynamic sort_a/b fill — 0xFFFFFFFFu sentinel. Inactive slots stay
    //    past 0xFFFF and get sorted out of the visible window.
    if (dynamic_count > 0 && resources_->dynamic_sort_as[frame_in_flight].buffer()
                          && resources_->dynamic_sort_bs[frame_in_flight].buffer()) {
        const VkDeviceSize dyn_sort_bytes =
            static_cast<VkDeviceSize>(dynamic_sort_size_) * sizeof(SortEntry);
        vkCmdFillBuffer(cmd, resources_->dynamic_sort_as[frame_in_flight].buffer(),
                        0, dyn_sort_bytes, 0xFFFFFFFFu);
        vkCmdFillBuffer(cmd, resources_->dynamic_sort_bs[frame_in_flight].buffer(),
                        0, dyn_sort_bytes, 0xFFFFFFFFu);
    }

    // 4. TRANSFER → COMPUTE barrier (covers static-tail and dynamic-sort fills).
    {
        VkMemoryBarrier fill_barrier{};
        fill_barrier.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &fill_barrier, 0, nullptr, 0, nullptr);
    }
}

}  // namespace gseurat
