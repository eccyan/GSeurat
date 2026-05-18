#pragma once

#include "gseurat/engine/gs_renderer/post/post_process_params.hpp"
#include "gseurat/engine/types.hpp"  // kMaxFramesInFlight

#include <vulkan/vulkan.h>

#include <array>
#include <cstdint>

namespace gseurat {

struct GsResourceManager;

// Phase 5b: first system extraction. Owns the post-process compute pipeline
// (gs_post_process.comp): descriptor set layout, pipeline layout, pipeline,
// and the per-frame descriptor sets that bind frame f's
// {output_view, depth_view, processed_view, pp_ubo_buffer}.
//
// Lifetime: by-value member of GsRenderer. Same lifetime as the renderer;
// no heap allocation overhead. Lifecycle: init() at GsRenderer::init() time
// (after the renderer's gs_pool_ and GsResourceManager are live); shutdown()
// from GsRenderer::shutdown(). The dispatch path is invoked from
// GsRenderer::render() once per frame; the system owns both the
// processed_image UNDEFINED→GENERAL pre-barrier and the GENERAL→
// SHADER_READ_ONLY_OPTIMAL post-barrier (Phase 5e, step 6).
class GsPostProcessSystem {
public:
    GsPostProcessSystem() = default;
    ~GsPostProcessSystem();

    GsPostProcessSystem(const GsPostProcessSystem&) = delete;
    GsPostProcessSystem& operator=(const GsPostProcessSystem&) = delete;
    GsPostProcessSystem(GsPostProcessSystem&&) = delete;
    GsPostProcessSystem& operator=(GsPostProcessSystem&&) = delete;

    // Create the set layout, pipeline layout, pipeline, and allocate two
    // descriptor sets (one per frame in flight). `pool` is GsRenderer's
    // shared gs_pool_ — moving pool ownership is out of scope for 5b.
    void init(VkDevice device, VkPipelineCache pipeline_cache,
              VkDescriptorPool pool, GsResourceManager* resources);

    // Per-frame descriptor binding refresh. Called from
    // GsRenderer::update_descriptors after the per-frame image views are
    // (re)created on resize.
    void write_descriptors();

    // Issue the gs_post_process.comp dispatch. Owns both
    //  - the processed_image UNDEFINED→GENERAL pre-barrier (existing), and
    //  - the processed_image GENERAL→SHADER_READ_ONLY_OPTIMAL post-barrier
    //    (Phase 5e — absorbed from GsRenderer::render).
    // `frame_in_flight` selects the descriptor set + processed image slot.
    // Caller owns the upstream tile→post barrier (lives on GsTileBinSystem
    // per spec §5.4 producer-side rule).
    void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                  uint32_t width, uint32_t height);

    // Runtime params (formerly GsRenderer::gs_pp_params_). The renderer's
    // public setter/getter forwards to this.
    GsPostProcessParams&       params()       { return params_; }
    const GsPostProcessParams& params() const { return params_; }

    // Prewarm hook — GsRenderer::prewarm_pipelines aggregates this into its
    // full prewarm list so the on-disk pipeline cache covers our pipeline.
    struct PrewarmInfo {
        VkPipeline               pipeline;
        VkPipelineLayout         pipeline_layout;
        VkDescriptorSetLayout    set_layout;
    };
    PrewarmInfo prewarm_info() const {
        return {pipeline_, pipeline_layout_, set_layout_};
    }

    // Tear down everything. Idempotent against null handles.
    void shutdown();

private:
    VkDevice                                          device_     = VK_NULL_HANDLE;
    GsResourceManager*                                resources_  = nullptr;

    VkDescriptorSetLayout                             set_layout_         = VK_NULL_HANDLE;
    VkPipelineLayout                                  pipeline_layout_    = VK_NULL_HANDLE;
    VkPipeline                                        pipeline_           = VK_NULL_HANDLE;
    std::array<VkDescriptorSet, kMaxFramesInFlight>   sets_{};

    GsPostProcessParams                               params_{};
};

}  // namespace gseurat
