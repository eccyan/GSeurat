#include "gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp"

#include "gseurat/engine/debug.hpp"
#include "gseurat/engine/gs_renderer/gs_resources.hpp"
#include "gseurat/engine/gs_renderer/sort/gs_sort_system.hpp"
#include "gseurat/engine/pipeline.hpp"

#include <algorithm>
#include <cassert>
#include <cstdio>
#include <stdexcept>
#include <string>

namespace gseurat {

namespace {

void insert_compute_barrier(VkCommandBuffer cmd) {
    VkMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        0, 1, &barrier, 0, nullptr, 0, nullptr);
}

}  // namespace

GsTileBinSystem::~GsTileBinSystem() {
    shutdown();
}

void GsTileBinSystem::init(VkDevice device, VkPipelineCache pipeline_cache,
                            VkDescriptorPool pool, GsResourceManager* resources,
                            GsSortSystem* sort) {
    assert(device != VK_NULL_HANDLE);
    assert(pool != VK_NULL_HANDLE);
    assert(resources != nullptr);
    assert(sort != nullptr);
    device_    = device;
    resources_ = resources;
    sort_      = sort;

    // ── Set layouts ───────────────────────────────────────────────────
    // Tile binning layout (count + scatter share):
    //   0 projected  1 merged_sort  2 counts (ro)
    //   3 per_splat_tile_count    4 per_splat_tile_offset
    //   5 tile_entries           6 uniforms
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {6, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 7;
        ci.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_bin_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsTileBinSystem: tile_bin descriptor set layout");
        }
    }
    // Tile scan: per_splat_count(0), per_splat_offset(1), scan_block_sums(2), tile_sort_count(3)
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
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_scan_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsTileBinSystem: tile_scan descriptor set layout");
        }
    }
    // Tile indirect: tile_sort_count(0), indirect_args(1)
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 2;
        ci.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_indirect_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsTileBinSystem: tile_indirect descriptor set layout");
        }
    }
    // Tile ranges: sorted_entries(0), tile_ranges(1), tile_count(2)
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
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_ranges_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsTileBinSystem: tile_ranges descriptor set layout");
        }
    }
    // Tile render: projected(0), tile_entries(1), uniforms(2), output_image(3), tile_ranges(4), depth_image(5)
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {5, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 6;
        ci.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_render_layout_) != VK_SUCCESS) {
            throw std::runtime_error("GsTileBinSystem: tile_render descriptor set layout");
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
            throw std::runtime_error(std::string("GsTileBinSystem: pipeline layout: ") + spv_path);
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
            throw std::runtime_error(std::string("GsTileBinSystem: pipeline create: ") + spv_path);
        }
    };

    // Tile-bin scatter (push: max_entries = 4 bytes). Builds the pipeline
    // layout the count pipeline below reuses; count has no push but accepts
    // a 4-byte range without touching it.
    create_pipeline("shaders/gs_tile_bin.comp.spv", tile_bin_layout_, 4,
                    tile_bin_pipeline_layout_, tile_bin_pipeline_);

    // Tile-count pass — reuses tile_bin_pipeline_layout_.
    {
        auto module = load_shader_module(device_, "shaders/gs_tile_count.comp.spv");
        VkPipelineShaderStageCreateInfo stage{};
        stage.sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
        stage.module = module;
        stage.pName  = "main";

        VkComputePipelineCreateInfo pi{};
        pi.sType  = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pi.stage  = stage;
        pi.layout = tile_bin_pipeline_layout_;
        VkResult res = vkCreateComputePipelines(device_, pipeline_cache, 1, &pi, nullptr,
                                                 &tile_count_pipeline_);
        vkDestroyShaderModule(device_, module, nullptr);
        if (res != VK_SUCCESS) {
            throw std::runtime_error("GsTileBinSystem: tile_count pipeline create");
        }
    }

    create_pipeline("shaders/gs_tile_scan.comp.spv", tile_scan_layout_, 12,
                    tile_scan_pipeline_layout_, tile_scan_pipeline_);
    create_pipeline("shaders/gs_tile_ranges.comp.spv", tile_ranges_layout_, 8,
                    tile_ranges_pipeline_layout_, tile_ranges_pipeline_);
    create_pipeline("shaders/gs_tile_prepare_indirect.comp.spv", tile_indirect_layout_, 4,
                    tile_indirect_pipeline_layout_, tile_indirect_pipeline_);
    create_pipeline("shaders/gs_tile_render.comp.spv", tile_render_layout_, 0,
                    tile_render_pipeline_layout_, tile_render_pipeline_);

    // ── Descriptor set allocation ─────────────────────────────────────
    // 18 sets total: 10 tile (5 kinds × 2 frames) + 8 tile-onesweep
    // (hist_a, hist_b, scatter_ab, scatter_ba × 2 frames).
    constexpr uint32_t kTilePerFrame = 5;  // tile_bin, tile_scan, tile_indirect, tile_ranges, tile_render
    constexpr uint32_t kOnesweepPerFrame = 4;  // hist_a, hist_b, scatter_ab, scatter_ba
    constexpr uint32_t kTotal =
        (kTilePerFrame + kOnesweepPerFrame) * kMaxFramesInFlight;

    const VkDescriptorSetLayout onesweep_hist_layout    = sort_->onesweep_hist_set_layout();
    const VkDescriptorSetLayout onesweep_scatter_layout = sort_->onesweep_scatter_set_layout();

    VkDescriptorSetLayout layouts[kTotal];
    uint32_t i = 0;
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        layouts[i++] = tile_bin_layout_;
        layouts[i++] = tile_scan_layout_;
        layouts[i++] = tile_indirect_layout_;
        layouts[i++] = tile_ranges_layout_;
        layouts[i++] = tile_render_layout_;
    }
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        layouts[i++] = onesweep_hist_layout;
        layouts[i++] = onesweep_hist_layout;
        layouts[i++] = onesweep_scatter_layout;
        layouts[i++] = onesweep_scatter_layout;
    }
    assert(i == kTotal);

    VkDescriptorSet sets[kTotal];
    VkDescriptorSetAllocateInfo alloc{};
    alloc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloc.descriptorPool = pool;
    alloc.descriptorSetCount = kTotal;
    alloc.pSetLayouts = layouts;
    if (vkAllocateDescriptorSets(device_, &alloc, sets) != VK_SUCCESS) {
        throw std::runtime_error("GsTileBinSystem: vkAllocateDescriptorSets failed");
    }

    i = 0;
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        tile_bin_sets_[f]      = sets[i++];
        tile_scan_sets_[f]     = sets[i++];
        tile_indirect_sets_[f] = sets[i++];
        tile_ranges_sets_[f]   = sets[i++];
        tile_render_sets_[f]   = sets[i++];
    }
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        onesweep_hist_sets_a_[f]     = sets[i++];
        onesweep_hist_sets_b_[f]     = sets[i++];
        onesweep_scatter_sets_ab_[f] = sets[i++];
        onesweep_scatter_sets_ba_[f] = sets[i++];
    }
    assert(i == kTotal);
}

void GsTileBinSystem::set_sort_sizes(uint32_t static_sort_size, uint32_t dynamic_sort_size) {
    static_sort_size_  = static_sort_size;
    dynamic_sort_size_ = dynamic_sort_size;

    // Capacity: visible Gaussians × avg tile overlap. Cap at 2M entries (16MB per buffer).
    uint32_t visible_upper = static_sort_size_ + dynamic_sort_size_;
    tile_sort_capacity_ = std::min(visible_upper * 4, 1u << 21);
    // Align to 2048 (workgroup size for radix sort)
    tile_sort_size_       = ((tile_sort_capacity_ + 2047) / 2048) * 2048;
    tile_sort_workgroups_ = tile_sort_size_ / 2048;
    if (tile_sort_workgroups_ == 0) tile_sort_workgroups_ = 1;
    tile_sort_size_ = tile_sort_workgroups_ * 2048;

    // Scan sizing — visible_upper rounded up to 256-thread workgroup
    scan_dispatch_size_ = ((visible_upper + 255u) / 256u) * 256u;
    if (scan_dispatch_size_ == 0) scan_dispatch_size_ = 256u;
    scan_num_blocks_ = scan_dispatch_size_ / 256u;

    // Onesweep max workgroups for tile-sort status buffer sizing
    onesweep_max_wg_ = (tile_sort_capacity_ + 2047) / 2048;
    if (onesweep_max_wg_ == 0) onesweep_max_wg_ = 1;
}

void GsTileBinSystem::write_descriptors() {
    if (!resources_->tile_sort_as[0].buffer()) return;

    // ── tile_bin sets ────────────────────────────────────────────────
    // 0 projected  1 merged_sort  2 counts  3 per_splat_count
    // 4 per_splat_offset  5 tile_entries  6 uniforms
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo projected_info{resources_->projected_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo merged_info{resources_->merged_sort_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo counts_info{resources_->counts_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo per_splat_count_info{resources_->per_splat_tile_count_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo per_splat_offset_info{resources_->per_splat_tile_offset_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo tile_entries_info{resources_->tile_sort_as[f].buffer(), 0, VK_WHOLE_SIZE};
        // GsUniforms is an internal struct in gs_renderer.cpp; using WHOLE_SIZE
// matches the buffer's actual size (allocated as sizeof(GsUniforms) in
// init_streaming).
VkDescriptorBufferInfo uniform_info{resources_->uniform_buffer.buffer(), 0, VK_WHOLE_SIZE};

        VkDescriptorSet set = tile_bin_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &merged_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &per_splat_count_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &per_splat_offset_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &tile_entries_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 6, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 7, writes, 0, nullptr);
    }

    // ── tile_scan sets ───────────────────────────────────────────────
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo count_info{resources_->per_splat_tile_count_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo offset_info{resources_->per_splat_tile_offset_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo block_sums_info{resources_->scan_block_sums_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo total_info{resources_->tile_sort_count_ssbos[f].buffer(), 0, sizeof(uint32_t)};

        VkDescriptorSet set = tile_scan_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &count_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &offset_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &block_sums_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &total_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
    }

    // ── tile_ranges sets ─────────────────────────────────────────────
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo sorted_info{resources_->tile_sort_as[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo ranges_info{resources_->tile_ranges_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo count_info{resources_->tile_sort_count_ssbos[f].buffer(), 0, sizeof(uint32_t)};

        VkDescriptorSet set = tile_ranges_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sorted_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &ranges_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &count_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
    }

    // ── tile_indirect sets ───────────────────────────────────────────
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo count_info{resources_->tile_sort_count_ssbos[f].buffer(), 0, sizeof(uint32_t)};
        VkDescriptorBufferInfo args_info{resources_->tile_indirect_args[f].buffer(), 0, VK_WHOLE_SIZE};

        VkDescriptorSet set = tile_indirect_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &count_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 2, writes, 0, nullptr);
    }

    // ── tile-onesweep sets ───────────────────────────────────────────
    if (resources_->onesweep_statuses[0].buffer()) {
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            VkDescriptorBufferInfo a_info{resources_->tile_sort_as[f].buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo b_info{resources_->tile_sort_bs[f].buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo status_info{resources_->onesweep_statuses[f].buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo args_info{resources_->tile_indirect_args[f].buffer(), 0, VK_WHOLE_SIZE};

            // hist_a: input = tile_sort_a
            {
                VkDescriptorSet set = onesweep_hist_sets_a_[f];
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &a_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
            }
            // hist_b: input = tile_sort_b
            {
                VkDescriptorSet set = onesweep_hist_sets_b_[f];
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &b_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
            }
            // scatter_ab: in = a, out = b
            {
                VkDescriptorSet set = onesweep_scatter_sets_ab_[f];
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &a_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &b_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
            }
            // scatter_ba: in = b, out = a
            {
                VkDescriptorSet set = onesweep_scatter_sets_ba_[f];
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &b_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &a_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
            }
        }
    }

    // ── tile_render sets ─────────────────────────────────────────────
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo projected_info{resources_->projected_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo tile_entries_info{resources_->tile_sort_as[f].buffer(), 0, VK_WHOLE_SIZE};
        // GsUniforms is an internal struct in gs_renderer.cpp; using WHOLE_SIZE
// matches the buffer's actual size (allocated as sizeof(GsUniforms) in
// init_streaming).
VkDescriptorBufferInfo uniform_info{resources_->uniform_buffer.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorImageInfo  image_info{VK_NULL_HANDLE, resources_->output_views[f], VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo tile_ranges_info{resources_->tile_ranges_ssbos[f].buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorImageInfo  depth_img_info{VK_NULL_HANDLE, resources_->depth_views[f], VK_IMAGE_LAYOUT_GENERAL};

        VkDescriptorSet set = tile_render_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &tile_entries_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &image_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &tile_ranges_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &depth_img_info, nullptr, nullptr},
        };
        vkUpdateDescriptorSets(device_, 6, writes, 0, nullptr);
    }
}

void GsTileBinSystem::dispatch_sort(VkCommandBuffer cmd, uint32_t frame_in_flight) {
    GS_LABEL(cmd, "TileSort");
    determinism_readback_emitted_ = false;
    GS_DBG_INVARIANT(resources_->tile_sort_as[frame_in_flight].buffer() && tile_sort_capacity_ > 0,
                     "dispatch_sort: tile sort buffers must be allocated before first dispatch");

    uint32_t width  = resources_->output_width;
    uint32_t height = resources_->output_height;
    uint32_t tiles_x = (width + 15) / 16;
    uint32_t tiles_y = (height + 15) / 16;

    // === Phase 0: zero counters + sentinel-fill tile_sort_a ===========
    vkCmdFillBuffer(cmd, resources_->tile_sort_count_ssbos[frame_in_flight].buffer(), 0,
                    sizeof(uint32_t), 0);
    vkCmdFillBuffer(cmd, resources_->tile_sort_as[frame_in_flight].buffer(), 0,
                    static_cast<VkDeviceSize>(tile_sort_size_) * 8, 0xFFFFFFFF);
    vkCmdFillBuffer(cmd, resources_->per_splat_tile_count_ssbos[frame_in_flight].buffer(), 0,
                    static_cast<VkDeviceSize>(scan_dispatch_size_) * sizeof(uint32_t), 0);

    {
        VkMemoryBarrier fill_barrier{};
        fill_barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &fill_barrier, 0, nullptr, 0, nullptr);
    }

    uint32_t visible_upper = static_sort_size_ + dynamic_sort_size_;
    uint32_t count_workgroups = scan_num_blocks_;
    (void)visible_upper;  // suppress unused warning when invariant compiled out

    // === Phase 1: Count pass ==========================================
    {
        GS_LABEL(cmd, "Count");
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_count_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_bin_pipeline_layout_, 0, 1, &tile_bin_sets_[frame_in_flight], 0, nullptr);
        uint32_t push_data[1] = {tile_sort_capacity_};
        vkCmdPushConstants(cmd, tile_bin_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, push_data);
        vkCmdDispatch(cmd, count_workgroups, 1, 1);
    }
    insert_compute_barrier(cmd);

    // === Phase 2: Three-pass exclusive scan ==========================
    {
        GS_LABEL(cmd, "Scan");
        struct ScanPush { uint32_t pass; uint32_t num_elements; uint32_t num_blocks; };
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_scan_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_scan_pipeline_layout_, 0, 1, &tile_scan_sets_[frame_in_flight], 0, nullptr);

        ScanPush p0{0u, scan_dispatch_size_, scan_num_blocks_};
        vkCmdPushConstants(cmd, tile_scan_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p0);
        vkCmdDispatch(cmd, scan_num_blocks_, 1, 1);
        insert_compute_barrier(cmd);

        ScanPush p1{1u, scan_dispatch_size_, scan_num_blocks_};
        vkCmdPushConstants(cmd, tile_scan_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p1);
        vkCmdDispatch(cmd, 1u, 1, 1);
        insert_compute_barrier(cmd);

        ScanPush p2{2u, scan_dispatch_size_, scan_num_blocks_};
        vkCmdPushConstants(cmd, tile_scan_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p2);
        vkCmdDispatch(cmd, scan_num_blocks_, 1, 1);
    }
    insert_compute_barrier(cmd);

    // === Phase 3: Deterministic scatter ==============================
    {
        GS_LABEL(cmd, "Bin");
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_bin_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_bin_pipeline_layout_, 0, 1, &tile_bin_sets_[frame_in_flight], 0, nullptr);
        uint32_t push_data[1] = {tile_sort_capacity_};
        vkCmdPushConstants(cmd, tile_bin_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, push_data);
        vkCmdDispatch(cmd, count_workgroups, 1, 1);
    }
    insert_compute_barrier(cmd);

    // === Phase 4: Prepare indirect args ==============================
    {
        GS_LABEL(cmd, "IndirectArgs");
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_indirect_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_indirect_pipeline_layout_, 0, 1, &tile_indirect_sets_[frame_in_flight], 0, nullptr);
        vkCmdPushConstants(cmd, tile_indirect_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, &tile_sort_capacity_);
        vkCmdDispatch(cmd, 1, 1, 1);
    }

    // Indirect args must be visible before DispatchIndirect reads them.
    {
        VkMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_INDIRECT_COMMAND_READ_BIT | VK_ACCESS_SHADER_READ_BIT;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &barrier, 0, nullptr, 0, nullptr);
    }

    // === Phase 5: Onesweep radix sort (kTileSortPasses passes) =======
    {
        GS_LABEL(cmd, "Onesweep");
        VkDeviceSize status_size = 4ull * 256ull * onesweep_max_wg_ * sizeof(uint32_t);
        vkCmdFillBuffer(cmd, resources_->onesweep_statuses[frame_in_flight].buffer(), 0,
                        status_size, 0);
        {
            VkMemoryBarrier sb{};
            sb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            sb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            sb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &sb, 0, nullptr, 0, nullptr);
        }

        for (uint32_t pass = 0; pass < kTileSortPasses; pass++) {
            uint32_t push_data[1] = {pass};
            bool read_from_a = (pass % 2 == 0);

            // Histogram + decoupled lookback
            {
                VkDescriptorSet hist_set = read_from_a ? onesweep_hist_sets_a_[frame_in_flight]
                                                       : onesweep_hist_sets_b_[frame_in_flight];
                vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, sort_->onesweep_hist_pipeline());
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                        sort_->onesweep_hist_pipeline_layout(), 0, 1, &hist_set, 0, nullptr);
                vkCmdPushConstants(cmd, sort_->onesweep_hist_pipeline_layout(), VK_SHADER_STAGE_COMPUTE_BIT,
                                   0, 4, push_data);
                vkCmdDispatchIndirect(cmd, resources_->tile_indirect_args[frame_in_flight].buffer(), 0);
            }
            insert_compute_barrier(cmd);

            // Scatter
            {
                VkDescriptorSet scatter_set = read_from_a ? onesweep_scatter_sets_ab_[frame_in_flight]
                                                          : onesweep_scatter_sets_ba_[frame_in_flight];
                vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, sort_->onesweep_scatter_pipeline());
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                        sort_->onesweep_scatter_pipeline_layout(), 0, 1, &scatter_set, 0, nullptr);
                vkCmdPushConstants(cmd, sort_->onesweep_scatter_pipeline_layout(), VK_SHADER_STAGE_COMPUTE_BIT,
                                   0, 4, push_data);
                vkCmdDispatchIndirect(cmd, resources_->tile_indirect_args[frame_in_flight].buffer(), 0);
            }
            insert_compute_barrier(cmd);
        }
        // After kTileSortPasses (even count = 4), sorted result is in tile_sort_a.
    }

    // === Frame-determinism readback (when harness is active) ==========
    // resources_->determinism_readback stays single-instance: only one
    // frame emits at a time, and the harness waits on the in-flight
    // fence before reading.
    if (determinism_test_active_ && resources_->determinism_readback.buffer() != VK_NULL_HANDLE
        && resources_->determinism_readback_size > 0) {
        VkBufferMemoryBarrier src_barrier{};
        src_barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        src_barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        src_barrier.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        src_barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        src_barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        src_barrier.buffer = resources_->tile_sort_as[frame_in_flight].buffer();
        src_barrier.offset = 0;
        src_barrier.size = resources_->determinism_readback_size;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            0, 0, nullptr, 1, &src_barrier, 0, nullptr);

        VkBufferCopy region{};
        region.srcOffset = 0;
        region.dstOffset = 0;
        region.size = resources_->determinism_readback_size;
        vkCmdCopyBuffer(cmd, resources_->tile_sort_as[frame_in_flight].buffer(),
                        resources_->determinism_readback.buffer(), 1, &region);

        VkBufferMemoryBarrier dst_barrier{};
        dst_barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        dst_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        dst_barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        dst_barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        dst_barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        dst_barrier.buffer = resources_->determinism_readback.buffer();
        dst_barrier.offset = 0;
        dst_barrier.size = resources_->determinism_readback_size;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_HOST_BIT,
            0, 0, nullptr, 1, &dst_barrier, 0, nullptr);
        determinism_readback_emitted_  = true;
        determinism_last_emitted_frame_ = frame_in_flight;
    }

    // === Phase 6: Tile range detection ===============================
    {
        uint32_t num_tiles = tiles_x * tiles_y;
        vkCmdFillBuffer(cmd, resources_->tile_ranges_ssbos[frame_in_flight].buffer(), 0,
                        static_cast<VkDeviceSize>(num_tiles) * 2 * sizeof(uint32_t), 0);

        VkMemoryBarrier fill_barrier{};
        fill_barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &fill_barrier, 0, nullptr, 0, nullptr);
    }

    {
        GS_LABEL(cmd, "Ranges");
        uint32_t num_tiles = tiles_x * tiles_y;
        uint32_t push_data[2] = {num_tiles, tile_sort_capacity_};
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_ranges_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_ranges_pipeline_layout_, 0, 1, &tile_ranges_sets_[frame_in_flight], 0, nullptr);
        vkCmdPushConstants(cmd, tile_ranges_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 8, push_data);
        vkCmdDispatchIndirect(cmd, resources_->tile_indirect_args[frame_in_flight].buffer(),
                              3 * sizeof(uint32_t));
    }
    insert_compute_barrier(cmd);
}

void GsTileBinSystem::dispatch_render(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                       uint32_t width, uint32_t height) {
    GS_LABEL(cmd, "Rasterize");
    GS_DBG_INVARIANT(resources_->tile_sort_as[frame_in_flight].buffer() && tile_sort_capacity_ > 0,
                     "dispatch_render: tile sort buffers must be allocated post-init");

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_render_pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            tile_render_pipeline_layout_, 0, 1, &tile_render_sets_[frame_in_flight], 0, nullptr);
    uint32_t tiles_x = (width + 15) / 16;
    uint32_t tiles_y = (height + 15) / 16;
    vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
}

std::array<GsTileBinSystem::PrewarmEntry, 6> GsTileBinSystem::prewarm_entries() const {
    return {{
        {"gs_tile_bin",              tile_bin_pipeline_,      tile_bin_pipeline_layout_,      tile_bin_layout_,      4},
        {"gs_tile_count",            tile_count_pipeline_,    tile_bin_pipeline_layout_,      tile_bin_layout_,      4},
        {"gs_tile_scan",             tile_scan_pipeline_,     tile_scan_pipeline_layout_,     tile_scan_layout_,     12},
        {"gs_tile_ranges",           tile_ranges_pipeline_,   tile_ranges_pipeline_layout_,   tile_ranges_layout_,   8},
        {"gs_tile_prepare_indirect", tile_indirect_pipeline_, tile_indirect_pipeline_layout_, tile_indirect_layout_, 4},
        {"gs_tile_render",           tile_render_pipeline_,   tile_render_pipeline_layout_,   tile_render_layout_,   0},
    }};
}

VmaAllocation GsTileBinSystem::determinism_readback_allocation() const {
    return resources_->determinism_readback.allocation();
}

VmaAllocation GsTileBinSystem::tile_sort_count_allocation() const {
    return resources_->tile_sort_count_ssbos[determinism_last_emitted_frame_].allocation();
}

const void* GsTileBinSystem::determinism_readback_data() const {
    return resources_->determinism_readback.mapped();
}

uint32_t GsTileBinSystem::live_tile_sort_count() const {
    const auto& slot = resources_->tile_sort_count_ssbos[determinism_last_emitted_frame_];
    if (slot.mapped() == nullptr) return 0;
    return *static_cast<const uint32_t*>(slot.mapped());
}

void GsTileBinSystem::shutdown() {
    if (device_ == VK_NULL_HANDLE) return;

    auto destroy_pipeline = [&](VkPipeline& p) {
        if (p) { vkDestroyPipeline(device_, p, nullptr); p = VK_NULL_HANDLE; }
    };
    auto destroy_layout = [&](VkPipelineLayout& l) {
        if (l) { vkDestroyPipelineLayout(device_, l, nullptr); l = VK_NULL_HANDLE; }
    };
    auto destroy_set_layout = [&](VkDescriptorSetLayout& l) {
        if (l) { vkDestroyDescriptorSetLayout(device_, l, nullptr); l = VK_NULL_HANDLE; }
    };

    destroy_pipeline(tile_bin_pipeline_);
    destroy_pipeline(tile_count_pipeline_);
    destroy_pipeline(tile_scan_pipeline_);
    destroy_pipeline(tile_ranges_pipeline_);
    destroy_pipeline(tile_indirect_pipeline_);
    destroy_pipeline(tile_render_pipeline_);

    destroy_layout(tile_bin_pipeline_layout_);
    destroy_layout(tile_scan_pipeline_layout_);
    destroy_layout(tile_ranges_pipeline_layout_);
    destroy_layout(tile_indirect_pipeline_layout_);
    destroy_layout(tile_render_pipeline_layout_);

    destroy_set_layout(tile_bin_layout_);
    destroy_set_layout(tile_scan_layout_);
    destroy_set_layout(tile_ranges_layout_);
    destroy_set_layout(tile_indirect_layout_);
    destroy_set_layout(tile_render_layout_);

    device_ = VK_NULL_HANDLE;
}

}  // namespace gseurat
