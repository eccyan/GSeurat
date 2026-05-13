#pragma once

#include "gseurat/engine/types.hpp"  // kMaxFramesInFlight

#include <vulkan/vulkan.h>

#include <array>
#include <cstdint>

namespace gseurat {

struct GsResourceManager;

// Phase 5c: depth sort + merge extraction. Owns:
//  - Onesweep histogram and scatter pipelines (shared with 5d tile-bin
//    via the onesweep_*() getters — tile-bin reads them out instead of
//    duplicating pipeline creation)
//  - Merge pipeline + per-frame merge descriptor sets
//  - All three depth-sort descriptor set quads: legacy (sort_keys/sort_b),
//    static (static_sort_a/b), dynamic (dynamic_sort_a/b), each 4 sets
//    (hist_a, hist_b, scatter_ab, scatter_ba) per frame in flight =
//    12 sets per frame × 2 frames = 24 sets, +2 merge = 26 sets total
//
// Lifetime: by-value member of GsRenderer; same lifetime as the renderer.
// init() runs in GsRenderer::init() after gs_pool_ exists.
// set_sort_sizes() is called from GsRenderer::init_streaming() after the
// sort sizes are computed (it's a "push" rather than a back-pointer to
// keep coupling tight).
class GsSortSystem {
public:
    GsSortSystem() = default;
    ~GsSortSystem();

    GsSortSystem(const GsSortSystem&) = delete;
    GsSortSystem& operator=(const GsSortSystem&) = delete;
    GsSortSystem(GsSortSystem&&) = delete;
    GsSortSystem& operator=(GsSortSystem&&) = delete;

    // Create the 3 set layouts, 3 pipeline layouts, 3 pipelines, and
    // allocate 26 descriptor sets (12 depth × 2 frames + 2 merge) from
    // the shared gs_pool_.
    void init(VkDevice device, VkPipelineCache pipeline_cache,
              VkDescriptorPool pool, GsResourceManager* resources);

    // Push sort sizes computed by GsRenderer::init_streaming. Must be
    // called before any dispatch_*().
    void set_sort_sizes(uint32_t static_sort_size, uint32_t static_sort_workgroups,
                        uint32_t dynamic_sort_size, uint32_t dynamic_sort_workgroups,
                        uint32_t legacy_sort_size, uint32_t legacy_sort_workgroups,
                        uint32_t num_passes, uint32_t depth_onesweep_max_wg);

    // Write/refresh all 26 descriptor sets. Called from
    // GsRenderer::update_descriptors after buffer (re)creation.
    void write_descriptors();

    // Per-path depth-sort entry points. Each clears its status buffer
    // slot, then runs `num_passes_` × {histogram, scatter}. After
    // dispatch, the sorted output lives in slot A (even passes).
    void dispatch_depth_dynamic(VkCommandBuffer cmd, uint32_t frame_in_flight);
    void dispatch_depth_static (VkCommandBuffer cmd, uint32_t frame_in_flight);
    void dispatch_depth_legacy (VkCommandBuffer cmd, uint32_t frame_in_flight);

    // Merge dispatch: combines static + dynamic sorted entries into
    // merged_sort_ssbo using counts SSBO. `total_upper` is the static +
    // dynamic sort-size sum (visible upper bound).
    void dispatch_merge(VkCommandBuffer cmd, uint32_t frame_in_flight,
                        uint32_t total_upper);

    // Cross-system pipeline access for 5d (tile-bin reuses onesweep
    // pipelines). Phase 5c keeps these accessible so GsRenderer's
    // existing dispatch_tile_sort can still call into them.
    VkPipeline             onesweep_hist_pipeline()           const { return onesweep_hist_pipeline_; }
    VkPipeline             onesweep_scatter_pipeline()        const { return onesweep_scatter_pipeline_; }
    VkPipelineLayout       onesweep_hist_pipeline_layout()    const { return onesweep_hist_pipeline_layout_; }
    VkPipelineLayout       onesweep_scatter_pipeline_layout() const { return onesweep_scatter_pipeline_layout_; }
    VkDescriptorSetLayout  onesweep_hist_set_layout()         const { return onesweep_hist_layout_; }
    VkDescriptorSetLayout  onesweep_scatter_set_layout()      const { return onesweep_scatter_layout_; }
    uint32_t               num_passes()                       const { return num_passes_; }

    // Prewarm entries — 3 pipelines (onesweep_hist, onesweep_scatter, merge).
    struct PrewarmEntry {
        VkPipeline               pipeline;
        VkPipelineLayout         pipeline_layout;
        VkDescriptorSetLayout    set_layout;
    };
    std::array<PrewarmEntry, 3> prewarm_entries() const;

    // Tear down. Idempotent.
    void shutdown();

private:
    VkDevice                                          device_     = VK_NULL_HANDLE;
    GsResourceManager*                                resources_  = nullptr;

    // Onesweep layouts + pipelines (shared with 5d tile-bin)
    VkDescriptorSetLayout   onesweep_hist_layout_              = VK_NULL_HANDLE;
    VkDescriptorSetLayout   onesweep_scatter_layout_           = VK_NULL_HANDLE;
    VkPipelineLayout        onesweep_hist_pipeline_layout_     = VK_NULL_HANDLE;
    VkPipelineLayout        onesweep_scatter_pipeline_layout_  = VK_NULL_HANDLE;
    VkPipeline              onesweep_hist_pipeline_            = VK_NULL_HANDLE;
    VkPipeline              onesweep_scatter_pipeline_         = VK_NULL_HANDLE;

    // Merge
    VkDescriptorSetLayout   merge_layout_              = VK_NULL_HANDLE;
    VkPipelineLayout        merge_pipeline_layout_     = VK_NULL_HANDLE;
    VkPipeline              merge_pipeline_            = VK_NULL_HANDLE;
    std::array<VkDescriptorSet, kMaxFramesInFlight> merge_sets_{};

    // Depth onesweep — legacy path (sort_keys/sort_b)
    std::array<VkDescriptorSet, kMaxFramesInFlight> depth_hist_sets_a_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> depth_hist_sets_b_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> depth_scatter_sets_ab_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> depth_scatter_sets_ba_{};

    // Depth onesweep — static path (static_sort_a/b)
    std::array<VkDescriptorSet, kMaxFramesInFlight> static_depth_hist_sets_a_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> static_depth_hist_sets_b_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> static_depth_scatter_sets_ab_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> static_depth_scatter_sets_ba_{};

    // Depth onesweep — dynamic path (dynamic_sort_a/b)
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_depth_hist_sets_a_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_depth_hist_sets_b_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_depth_scatter_sets_ab_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_depth_scatter_sets_ba_{};

    // Sort sizes (pushed from GsRenderer::init_streaming)
    uint32_t static_sort_size_         = 0;
    uint32_t static_sort_workgroups_   = 0;
    uint32_t dynamic_sort_size_        = 0;
    uint32_t dynamic_sort_workgroups_  = 0;
    uint32_t legacy_sort_size_         = 0;
    uint32_t legacy_sort_workgroups_   = 0;
    uint32_t num_passes_               = 2;
    uint32_t depth_onesweep_max_wg_    = 0;

    // Helpers
    void write_depth_set_quad(VkDescriptorSet hist_a, VkDescriptorSet hist_b,
                              VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba,
                              VkBuffer sort_a, VkBuffer sort_b,
                              VkBuffer status_buf, VkBuffer params_buf);
    void dispatch_depth_onesweep_impl(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                       uint32_t num_workgroups,
                                       VkDescriptorSet hist_a, VkDescriptorSet hist_b,
                                       VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba);
};

}  // namespace gseurat
