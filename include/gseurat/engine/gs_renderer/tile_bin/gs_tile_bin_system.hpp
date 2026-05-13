#pragma once

#include "gseurat/engine/types.hpp"  // kMaxFramesInFlight

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <array>
#include <cstdint>

namespace gseurat {

struct GsResourceManager;
class GsSortSystem;

// Phase 5d: tile binning + tile sort + tile rasterization extraction. Owns:
//  - 5 descriptor set layouts + 5 pipeline layouts + 6 pipelines (tile_count
//    shares tile_bin layout): tile_bin (+ tile_count), tile_scan,
//    tile_indirect, tile_ranges, tile_render
//  - 10 tile descriptor sets (5 kinds × 2 frames) + 8 tile-onesweep sets
//    (hist_a, hist_b, scatter_ab, scatter_ba × 2 frames) borrowing
//    GsSortSystem's onesweep_*_set_layout()
//  - Sizing scalars (tile_sort_capacity_, tile_sort_size_, …) pushed in
//    via set_sort_sizes() from GsRenderer::init_streaming
//  - Determinism harness state (active flag, emitted flag, last-emitted
//    frame slot) — exposed via 1-line forwarders on GsRenderer for ABI
//    stability
//
// Lifetime: by-value member of GsRenderer; same lifetime as the renderer.
// init() runs in GsRenderer::create_descriptor_resources() after
// gs_pool_ exists and after sort_.init() (we borrow sort_'s onesweep
// set layouts).
class GsTileBinSystem {
public:
    GsTileBinSystem() = default;
    ~GsTileBinSystem();

    GsTileBinSystem(const GsTileBinSystem&) = delete;
    GsTileBinSystem& operator=(const GsTileBinSystem&) = delete;
    GsTileBinSystem(GsTileBinSystem&&) = delete;
    GsTileBinSystem& operator=(GsTileBinSystem&&) = delete;

    // Create 5 set layouts, 5 pipeline layouts, 6 pipelines, and allocate
    // 18 descriptor sets (10 tile + 8 tile-onesweep) from the shared
    // gs_pool_. Borrows onesweep_*_set_layout() from `sort`.
    void init(VkDevice device, VkPipelineCache pipeline_cache,
              VkDescriptorPool pool, GsResourceManager* resources,
              GsSortSystem* sort);

    // Compute + cache tile-sort sizing for a given visible-splat upper
    // bound (static_sort_size + dynamic_sort_size). Called from
    // GsRenderer::init_streaming after the static/dynamic split is known.
    // Writes back into `out_capacity_size_bytes` so init_streaming can
    // size the tile_sort buffers it allocates inside GsResourceManager.
    void set_sort_sizes(uint32_t static_sort_size, uint32_t dynamic_sort_size);

    // Write/refresh all 18 descriptor sets. Called from
    // GsRenderer::update_descriptors after buffer (re)creation.
    void write_descriptors();

    // 6-pass tile sort: tile_count → tile_scan ×3 → tile_bin (scatter) →
    // tile_prepare_indirect → onesweep radix sort ×kPasses (via sort_'s
    // pipelines) → tile_ranges. Also records the determinism readback
    // copy when the harness is active.
    void dispatch_sort(VkCommandBuffer cmd, uint32_t frame_in_flight);

    // Final tile rasterization dispatch. Width/height come from the
    // renderer (output size may have been resized since init_streaming).
    void dispatch_render(VkCommandBuffer cmd, uint32_t frame_in_flight,
                         uint32_t width, uint32_t height);

    // Tear down. Idempotent.
    void shutdown();

    // ── Determinism harness controls (forwarded by GsRenderer) ────────
    void set_determinism_test_active(bool active) {
        determinism_test_active_ = active;
        if (!active) determinism_readback_emitted_ = false;
    }
    bool determinism_test_active() const { return determinism_test_active_; }
    bool determinism_readback_emitted_this_frame() const {
        return determinism_readback_emitted_;
    }
    // Allocation of the host-visible readback buffer (single-instance —
    // only one frame emits at a time, harness waits on in-flight fence).
    VmaAllocation determinism_readback_allocation() const;
    // Allocation of the per-frame tile_sort_count_ssbo slot that the
    // last dispatch_sort recorded into.
    VmaAllocation tile_sort_count_allocation() const;
    const void*   determinism_readback_data() const;
    // Post-fence: returns the live tile-sort entry count from the slot
    // that the most-recent dispatch_sort recorded into.
    uint32_t      live_tile_sort_count() const;

    // ── Sizing access (used by GsRenderer::init_streaming to size the
    //    per-frame tile_sort_* buffers in GsResourceManager) ───────────
    uint32_t tile_sort_capacity()   const { return tile_sort_capacity_; }
    uint32_t tile_sort_size()       const { return tile_sort_size_; }
    uint32_t tile_sort_workgroups() const { return tile_sort_workgroups_; }
    uint32_t scan_dispatch_size()   const { return scan_dispatch_size_; }
    uint32_t scan_num_blocks()      const { return scan_num_blocks_; }
    uint32_t onesweep_max_wg()      const { return onesweep_max_wg_; }

    // ── Prewarm ───────────────────────────────────────────────────────
    struct PrewarmEntry {
        const char*              name;
        VkPipeline               pipeline;
        VkPipelineLayout         pipeline_layout;
        VkDescriptorSetLayout    set_layout;
        uint32_t                 push_size;
    };
    std::array<PrewarmEntry, 6> prewarm_entries() const;

private:
    static constexpr uint32_t kTileSortPasses = 4;  // 4 radix passes for 32-bit key

    VkDevice           device_     = VK_NULL_HANDLE;
    GsResourceManager* resources_  = nullptr;
    GsSortSystem*      sort_       = nullptr;

    // Layouts + pipelines
    VkDescriptorSetLayout  tile_bin_layout_              = VK_NULL_HANDLE;  // shared by tile_count
    VkPipelineLayout       tile_bin_pipeline_layout_     = VK_NULL_HANDLE;
    VkPipeline             tile_bin_pipeline_            = VK_NULL_HANDLE;
    VkPipeline             tile_count_pipeline_          = VK_NULL_HANDLE;

    VkDescriptorSetLayout  tile_scan_layout_             = VK_NULL_HANDLE;
    VkPipelineLayout       tile_scan_pipeline_layout_    = VK_NULL_HANDLE;
    VkPipeline             tile_scan_pipeline_           = VK_NULL_HANDLE;

    VkDescriptorSetLayout  tile_indirect_layout_         = VK_NULL_HANDLE;
    VkPipelineLayout       tile_indirect_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline             tile_indirect_pipeline_       = VK_NULL_HANDLE;

    VkDescriptorSetLayout  tile_ranges_layout_           = VK_NULL_HANDLE;
    VkPipelineLayout       tile_ranges_pipeline_layout_  = VK_NULL_HANDLE;
    VkPipeline             tile_ranges_pipeline_         = VK_NULL_HANDLE;

    VkDescriptorSetLayout  tile_render_layout_           = VK_NULL_HANDLE;
    VkPipelineLayout       tile_render_pipeline_layout_  = VK_NULL_HANDLE;
    VkPipeline             tile_render_pipeline_         = VK_NULL_HANDLE;

    // Per-frame descriptor sets
    std::array<VkDescriptorSet, kMaxFramesInFlight> tile_bin_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> tile_scan_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> tile_indirect_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> tile_ranges_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> tile_render_sets_{};

    // Tile-onesweep sets — borrow sort_'s onesweep_*_set_layout
    std::array<VkDescriptorSet, kMaxFramesInFlight> onesweep_hist_sets_a_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> onesweep_hist_sets_b_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> onesweep_scatter_sets_ab_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> onesweep_scatter_sets_ba_{};

    // Sizing scalars (computed in set_sort_sizes)
    uint32_t static_sort_size_       = 0;
    uint32_t dynamic_sort_size_      = 0;
    uint32_t tile_sort_capacity_     = 0;
    uint32_t tile_sort_size_         = 0;
    uint32_t tile_sort_workgroups_   = 0;
    uint32_t scan_dispatch_size_     = 0;
    uint32_t scan_num_blocks_        = 0;
    uint32_t onesweep_max_wg_        = 0;

    // Determinism harness state
    bool     determinism_test_active_       = false;
    bool     determinism_readback_emitted_  = false;
    uint32_t determinism_last_emitted_frame_ = 0;
};

}  // namespace gseurat
