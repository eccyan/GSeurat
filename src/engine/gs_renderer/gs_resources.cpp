#include "gseurat/engine/gs_renderer/gs_resources.hpp"

#include <cassert>

namespace gseurat {

GsResourceManager::~GsResourceManager() {
    shutdown();
}

void GsResourceManager::initialize(VkDevice d, VmaAllocator a) {
    assert(d != VK_NULL_HANDLE);
    assert(a != VK_NULL_HANDLE);
    assert((device == VK_NULL_HANDLE || device == d) && "device mismatch");
    assert((allocator == VK_NULL_HANDLE || allocator == a) && "allocator mismatch");
    device = d;
    allocator = a;
}

void GsResourceManager::destroy_output_views_and_images() {
    if (device == VK_NULL_HANDLE) return;
    for (uint32_t i = 0; i < kMaxFramesInFlight; ++i) {
        if (output_views[i]) {
            vkDestroyImageView(device, output_views[i], nullptr);
            output_views[i] = VK_NULL_HANDLE;
        }
        if (output_images[i]) {
            vmaDestroyImage(allocator, output_images[i], output_allocations[i]);
            output_images[i] = VK_NULL_HANDLE;
            output_allocations[i] = VK_NULL_HANDLE;
        }
        if (depth_views[i]) {
            vkDestroyImageView(device, depth_views[i], nullptr);
            depth_views[i] = VK_NULL_HANDLE;
        }
        if (depth_images[i]) {
            vmaDestroyImage(allocator, depth_images[i], depth_allocations[i]);
            depth_images[i] = VK_NULL_HANDLE;
            depth_allocations[i] = VK_NULL_HANDLE;
        }
        if (processed_views[i]) {
            vkDestroyImageView(device, processed_views[i], nullptr);
            processed_views[i] = VK_NULL_HANDLE;
        }
        if (processed_images[i]) {
            vmaDestroyImage(allocator, processed_images[i], processed_allocations[i]);
            processed_images[i] = VK_NULL_HANDLE;
            processed_allocations[i] = VK_NULL_HANDLE;
        }
    }
}

void GsResourceManager::destroy_streaming_buffers() {
    if (allocator == VK_NULL_HANDLE) return;
    uniform_buffer.destroy(allocator);
    pbd_state_ssbo.destroy(allocator);
    pbd_params_ssbo.destroy(allocator);
    pbd_constraint_ssbo.destroy(allocator);
    pbd_uniform_buffer.destroy(allocator);
    static_gaussian_ssbo.destroy(allocator);
    dynamic_gaussian_ssbo.destroy(allocator);
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        static_sort_as[f].destroy(allocator);
        static_sort_bs[f].destroy(allocator);
        projected_ssbos[f].destroy(allocator);
        sort_keys_ssbos[f].destroy(allocator);
        sort_b_ssbos[f].destroy(allocator);
        visible_count_ssbos[f].destroy(allocator);
        dynamic_sort_as[f].destroy(allocator);
        dynamic_sort_bs[f].destroy(allocator);
        merged_sort_ssbos[f].destroy(allocator);
        counts_ssbos[f].destroy(allocator);
    }
    page_table_ssbo.destroy(allocator);
    chunk_table_ssbo.destroy(allocator);
    pp_ubo_buffer.destroy(allocator);
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        depth_onesweep_statuses[f].destroy(allocator);
    }
    depth_sort_params.destroy(allocator);
    static_depth_params.destroy(allocator);
    dynamic_depth_params.destroy(allocator);
}

void GsResourceManager::destroy_tile_bin_buffers() {
    if (allocator == VK_NULL_HANDLE) return;
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        tile_sort_as[f].destroy(allocator);
        tile_sort_bs[f].destroy(allocator);
        tile_sort_count_ssbos[f].destroy(allocator);
        tile_ranges_ssbos[f].destroy(allocator);
        tile_indirect_args[f].destroy(allocator);
        per_splat_tile_count_ssbos[f].destroy(allocator);
        per_splat_tile_offset_ssbos[f].destroy(allocator);
        scan_block_sums_ssbos[f].destroy(allocator);
    }
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        onesweep_statuses[f].destroy(allocator);
    }
    determinism_readback.destroy(allocator);
}

void GsResourceManager::shutdown() {
    if (device == VK_NULL_HANDLE) return;

    destroy_streaming_buffers();
    destroy_tile_bin_buffers();
    destroy_output_views_and_images();

    if (output_sampler) {
        vkDestroySampler(device, output_sampler, nullptr);
        output_sampler = VK_NULL_HANDLE;
    }

    device = VK_NULL_HANDLE;
    allocator = VK_NULL_HANDLE;
}

}  // namespace gseurat
