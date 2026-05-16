#pragma once

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_renderer/gs_resources.hpp"
#include "gseurat/engine/gs_renderer/pbd/gs_pbd_system.hpp"
#include "gseurat/engine/gs_renderer/post/gs_post_process_system.hpp"
#include "gseurat/engine/gs_renderer/post/post_process_params.hpp"
#include "gseurat/engine/gs_renderer/sort/gs_sort_system.hpp"
#include "gseurat/engine/gs_renderer/streaming/gs_streaming_system.hpp"
#include "gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp"
#include "gseurat/engine/pbd_types.hpp"
#include "gseurat/engine/render_state.hpp"  // FrameIndex
#include "gseurat/engine/slab_allocator.hpp"
#include "gseurat/engine/streaming_config.hpp"
#include "gseurat/engine/transfer_queue.hpp"
#include "gseurat/engine/types.hpp"
#include "gseurat/engine/world_manifest.hpp"

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <array>
#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <optional>
#include <thread>
#include <vector>

namespace gseurat {

class RenderState;

// Phase 5b: GsPostProcessParams and GsPostProcessUbo definitions moved to
// gseurat/engine/gs_renderer/post/post_process_params.hpp (included above).
// The include keeps external callers source-compatible.

// Push constants for preprocess shader (static/dynamic offset)
struct GsPreprocessPush {
    uint32_t projected_offset;
    uint32_t gaussian_count;
    uint32_t counts_index;  // 0 for static, 1 for dynamic
};

class GsRenderer {
public:
    void init(VkDevice device, VkPhysicalDevice physical_device, VmaAllocator allocator,
              VkDescriptorPool pool, VkPipelineCache pipeline_cache);
    // Phase 5e-2: GsRenderer's init_streaming stays as the orchestrator
    // (drives non-streaming buffer destroy/recreate, descriptor refresh,
    // pbd reset). It delegates the streaming-derivation portion to
    // GsStreamingSystem::init_streaming() partway through.
    void init_streaming(const StreamingConfig& config);
    // Phase 5e-2: forwarder.
    void unload_cloud(uint32_t chunk_id) { streaming_.unload_cloud(chunk_id); }
    // Release every active chunk and any in-flight pending async loads.
    // Used by full scene loads/transitions (`Renderer::init_gs`) so the
    // new scene replaces the old. Streaming-style appends should NOT
    // call this. Performs a `vkDeviceWaitIdle` to drain transfers before
    // returning slab indices to the allocator.
    //
    // `drain_cmd` is a transient command buffer the caller has already
    // begun via `vkBeginCommandBuffer`; clear_chunks records any
    // outstanding acquire barriers from completed transfers into it.
    // The caller is responsible for ending + submitting + waiting on
    // `drain_cmd`. Pass `VK_NULL_HANDLE` only for the single-queue
    // (Apple/fallback) path where no acquire barriers are required —
    // on dedicated transfer family that path leaves callbacks deferred
    // to the next frame, which would then fire against the next scene
    // and corrupt slab state.
    //
    // Phase 5e-2: forwarder; renderer-local counters that aren't
    // streaming-owned (dynamic_count_, sort_done_once_) are reset here.
    void clear_chunks(VkCommandBuffer drain_cmd = VK_NULL_HANDLE) {
        streaming_.clear_chunks(drain_cmd);
        dynamic_count_   = 0;
        sort_done_once_  = false;
    }
    // Async upload via the shared host-visible staging ring. The cloud is
    // moved into a pending-load job stored on the renderer; per-slab
    // `reserve_staging` + memcpy + `submit_with_handle` are issued by
    // `poll_transfers` across frames so a 100-slab cloud doesn't have to
    // fit in the staging ring at once. Returns one Handle per slab,
    // pre-allocated so `EngineLoadingMonitor` can poll their status
    // immediately even before any has been submitted to the GPU.
    // Requires init_streaming() and create_transfer_queue() to have been
    // called first; logs an error and returns {} if streaming isn't ready.
    // Phase 5e-2: forwarder to GsStreamingSystem.
    std::vector<TransferQueue::Handle> load_cloud_async(GaussianCloud cloud) {
        return streaming_.load_cloud_async(std::move(cloud));
    }
    // `frame_in_flight` identifies the slot the caller has waited on; only
    // resources owned by that slot may be written from `frame_cmd`. Other
    // slots' state (e.g. static_sort tail) is updated lazily when those
    // slots are next reused.
    void poll_transfers(VkCommandBuffer frame_cmd, uint32_t frame_in_flight) {
        streaming_.poll_transfers(frame_cmd, frame_in_flight);
    }
    // Phase 5e-1: forwards to GsStreamingSystem.
    void create_transfer_queue(VkQueue transfer_q, uint32_t transfer_family,
                               uint32_t graphics_family, bool dedicated) {
        streaming_.create_transfer_queue(transfer_q, transfer_family, graphics_family, dedicated);
    }

    // Exposed for the engine-level loading monitor: AppBase wires a status
    // provider against this so the EngineState machine can advance from
    // Loading → Warming when the streamer's transfer handles complete.
    // Returns nullptr until `create_transfer_queue` runs.
    // Phase 5e-1: forwards to GsStreamingSystem.
    TransferQueue* transfer_queue() { return streaming_.transfer_queue(); }
    const TransferQueue* transfer_queue() const { return streaming_.transfer_queue(); }
    // Phase 5e-2: update_active_gaussians + update_gaussian_data
    // removed as dead code — no callers existed outside the renderer
    // itself, and they were the last writers to gaussian_count_ that
    // weren't streaming-owned, blocking the Q3 migration.

    // Per-frame dynamic upload API (CPU-sourced transient: particles,
    // scene anims). Writes at offset `persistent_dyn_count_ + gpu_prefix`
    // and sets dynamic_count_ to `persistent_dyn_count_ + gpu_prefix +
    // count`. Static geometry (terrain) arrives via load_cloud_async +
    // publish_pending_chunks.
    //
    // `gpu_prefix` is the number of slots already filled at offset
    // `persistent_dyn_count_` by GPU compose passes (4c-vfx + 4c-pbd =
    // vfx_count + pbd_count). Callers that don't run any compose pass
    // pass 0 (default) and behave as before.
    void update_dynamic_gaussians(const Gaussian* data, uint32_t count,
                                  uint32_t gpu_prefix = 0);

    // Phase 4c-vfx: GPU compose pass for VFX splats. Copies `vfx_count`
    // slots from RenderState's vfx_buffer (bound via set_render_state)
    // into dynamic_gaussian_ssbo at offset `persistent_dyn_count_`.
    // Must be called BEFORE update_dynamic_gaussians on the same frame.
    void dispatch_compose_vfx(VkCommandBuffer cmd, FrameIndex frame_idx,
                              uint32_t vfx_count);

    // Phase 4c-pbd: GPU compose pass for PBD splats. Copies `pbd_count`
    // slots from RenderState's pbd_buffer into dynamic_gaussian_ssbo at
    // offset `persistent_dyn_count_ + vfx_count`. Must be called AFTER
    // dispatch_compose_vfx (so the offset is correct) and BEFORE
    // update_dynamic_gaussians on the same frame.
    void dispatch_compose_pbd(VkCommandBuffer cmd, FrameIndex frame_idx,
                              uint32_t vfx_count, uint32_t pbd_count);

    // Phase 4e: GPU compose pass for particle splats. Copies
    // `particles_count` slots from RenderState's particles_buffer
    // into dynamic_gaussian_ssbo at offset
    // `persistent_dyn_count_ + vfx_count + pbd_count`. Must be called
    // AFTER both other compose dispatches and BEFORE
    // update_dynamic_gaussians on the same frame.
    void dispatch_compose_particles(VkCommandBuffer cmd, FrameIndex frame_idx,
                                    uint32_t prior_offset,
                                    uint32_t particles_count);

    // Once-per-scene (or per-chunk-event) upload API for the "persistent prefix"
    // of the dynamic buffer: characters, NPCs, PBD-tagged trees. Replaces all
    // existing persistent-dynamic content. Caller assembles the full vector;
    // engine doesn't track per-source slots. After this call, dynamic_count_
    // resets to the persistent count (transient region is zero until the next
    // update_dynamic_gaussians).
    void set_persistent_dynamics(const Gaussian* data, uint32_t count);
    uint32_t persistent_dynamic_count() const { return persistent_dyn_count_; }
    // Phase 5e-2: forwarders to GsStreamingSystem.
    uint32_t max_static_count()  const { return streaming_.max_static_count(); }
    uint32_t max_dynamic_count() const { return streaming_.max_dynamic_count(); }
    uint32_t static_count()      const { return streaming_.static_count(); }
    uint32_t dynamic_count()     const { return dynamic_count_; }
    bool     static_dirty()      const { return streaming_.static_dirty(); }
    // Marks the static head of resources_->projected_ssbos as dirty for the next
    // kMaxFramesInFlight frames. Phase 3: with per-frame projected SSBOs,
    // each frame slot must run static_preprocess once to refresh its slot.
    void set_static_dirty(bool d) { streaming_.set_static_dirty(d); }

    void resize_output(uint32_t width, uint32_t height);

    // Records a one-time barrier+clear that transitions every per-frame
    // GS output, processed, and depth image out of `VK_IMAGE_LAYOUT_UNDEFINED`
    // (post-creation state) into `VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL`
    // with contents cleared to black. The renderer's main pass samples
    // `resources_->processed_views[frame]` every frame; without this seed transition,
    // the very first frame after `resize_output` while the engine state is
    // `Loading` (i.e. the GS compute path is gated off) would hit a
    // layout-mismatch validation error. Caller is responsible for submitting
    // and waiting on the recorded command buffer.
    void init_output_layouts(VkCommandBuffer cmd);

    // `frame_in_flight` selects which of the kMaxFramesInFlight per-frame
    // image and descriptor sets to write into / bind. The caller is the
    // top-level Renderer which already tracks `current_frame_`.
    void render(VkCommandBuffer cmd, uint32_t frame_in_flight,
                const glm::mat4& view, const glm::mat4& proj);
    // Per-frame view consumed by the composite/blit. Caller passes the
    // same frame index it used to record `render()` so the sampled image
    // is the one this frame just wrote to.
    VkImageView output_view(uint32_t frame_in_flight) const {
        return resources_->processed_views[frame_in_flight] != VK_NULL_HANDLE
            ? resources_->processed_views[frame_in_flight]
            : resources_->output_views[frame_in_flight];
    }
    VkImageView raw_output_view(uint32_t frame_in_flight) const {
        return resources_->output_views[frame_in_flight];
    }
    // Backwards-compatible accessors returning all per-frame views; the
    // descriptor allocator binds set i to view i.
    const std::array<VkImageView, kMaxFramesInFlight>& output_views() const {
        // Prefer processed if available; callers needing the raw-HDR
        // version use `raw_output_views()`.
        return resources_->processed_views[0] != VK_NULL_HANDLE ? resources_->processed_views : resources_->output_views;
    }
    const std::array<VkImageView, kMaxFramesInFlight>& raw_output_views() const {
        return resources_->output_views;
    }
    VkSampler output_sampler() const { return resources_->output_sampler; }
    // Phase 5e-2: moved into GsStreamingSystem. Alias kept for external
    // ABI stability (no external direct readers, just keeping the symbol).
    static constexpr uint32_t kDynamicHeadroom = GsStreamingSystem::kDynamicHeadroom;

    bool has_cloud()              const { return streaming_.gaussian_count() > 0; }
    uint32_t gaussian_count()     const { return streaming_.gaussian_count(); }
    uint32_t max_gaussian_count() const { return streaming_.max_gaussian_count(); }
    uint32_t output_width() const { return resources_->output_width; }
    uint32_t output_height() const { return resources_->output_height; }
    uint32_t visible_count() const {
        if (resources_->counts_ssbos[0].mapped()) {
            auto* c = static_cast<const uint32_t*>(resources_->counts_ssbos[0].mapped());
            return c[0] + c[1];  // static_visible + dynamic_visible
        }
        if (resources_->visible_count_ssbos[0].mapped())
            return *static_cast<const uint32_t*>(resources_->visible_count_ssbos[0].mapped());
        return 0;
    }
    void set_shadow_box_params(const glm::vec3& cone_dir, float cone_cos,
                               const glm::vec3& cam_pos, float margin = 32.0f);
    void clear_shadow_box_params();
    void set_skip_sort(bool skip) { skip_sort_ = skip; }
    bool skip_sort() const { return skip_sort_; }
    void set_scale_multiplier(float m) { scale_multiplier_ = m; }
    float scale_multiplier() const { return scale_multiplier_; }
    bool sort_done_once() const { return sort_done_once_; }

    // Visual effect setters
    void set_effect_time(float t) { time_ = t; }
    void set_toon_bands(int bands) { toon_bands_ = bands; }
    int toon_bands() const { return toon_bands_; }
    void set_pixel_art_intensity(float v) { pixel_art_intensity_ = glm::clamp(v, 0.0f, 1.0f); }
    float pixel_art_intensity() const { return pixel_art_intensity_; }
    void set_light_mode(int mode) { light_mode_ = mode; }
    int light_mode() const { return light_mode_; }
    void set_light_dir(const glm::vec3& d) { light_dir_ = d; }
    void set_light_intensity(float i) { light_intensity_ = i; }
    float light_intensity() const { return light_intensity_; }
    void set_point_lights(const std::vector<PointLight>& lights);
    const std::vector<PointLight>& point_lights() const { return point_lights_; }
    void set_touch_point(const glm::vec3& p, float radius, float timer = 0.0f) {
        touch_point_ = p; touch_radius_ = radius; touch_active_ = true; touch_time_ = timer;
    }
    void set_touch_time(float t) { touch_time_ = t; }
    void clear_touch() { touch_active_ = false; touch_time_ = 0.0f; }
    bool touch_active() const { return touch_active_; }
    void set_fire_region(float y_min, float y_max, float strength = 1.0f) {
        fire_y_min_ = y_min; fire_y_max_ = y_max; effect_strength_ = strength;
    }
    void clear_fire() { fire_y_min_ = 0.0f; fire_y_max_ = 0.0f; }
    void set_water_threshold(float y, float strength = 1.0f) {
        water_y_ = y; effect_strength_ = strength;
    }
    void clear_water() { water_y_ = -1000.0f; }
    float water_y() const { return water_y_; }
    float fire_y_min() const { return fire_y_min_; }
    float fire_y_max() const { return fire_y_max_; }

    // Wave 2 effect setters
    void set_explode_t(float t) { explode_t_ = t; }
    float explode_t() const { return explode_t_; }
    void set_voxel_t(float t) { voxel_t_ = t; }
    float voxel_t() const { return voxel_t_; }
    void set_pulse_t(float t) { pulse_t_ = t; }
    float pulse_t() const { return pulse_t_; }
    void set_xray_depth(float d) { xray_depth_ = d; }
    float xray_depth() const { return xray_depth_; }
    void set_swirl_t(float t) { swirl_t_ = t; }
    float swirl_t() const { return swirl_t_; }
    void set_burn_t(float t) { burn_t_ = t; }
    float burn_t() const { return burn_t_; }

    // Bone transforms. Phase 4b: storage moved to RenderState (per
    // frame-in-flight). Producers write through
    // render_state.bones_writer(FrameIndex); GsRenderer's preprocess
    // descriptors bind render_state.bones_buffer(FrameIndex{f}).
    void set_render_state(RenderState* rs) noexcept;

    // Phase 5a: GPU resource ownership. AppBase owns a GsResourceManager
    // and binds it here BEFORE init() so create_output_image and
    // init_streaming can populate it. Lifetime: the manager outlives
    // GsRenderer (AppBase destructs it before VkContext tear-down).
    void set_resources(GsResourceManager* r) noexcept { resources_ = r; }

    // Actor world rotation for root motion (Phase 2: applied to per-Gaussian covariance).
    // No static_dirty_=true: bone-animated splats now live in dynamic, and the
    // dynamic preprocess re-applies actor_rotation every frame via the bone
    // skinning path (gs_preprocess.comp:209-213).
    void set_actor_rotation(const glm::quat& q) { actor_rotation_ = q; }

    // PBD (Position Based Dynamics) solver
    void upload_pbd_elements(const PbdPhysicsState* states,
                             const PbdElementParams* params,
                             uint32_t count);
    void upload_pbd_constraints(const PbdConstraint* constraints, uint32_t count);
    void clear_pbd();
    // Phase 5e step 1.10: forwarded to GsPbdSystem.
    uint32_t pbd_count() const { return pbd_.count(); }
    uint32_t pbd_constraint_count() const { return pbd_.constraint_count(); }

    // Post-process parameters (fog, tone mapping, vignette, etc.)
    // Phase 5b: forwards to the by-value GsPostProcessSystem member.
    void set_post_process_params(const GsPostProcessParams& p) { post_.params() = p; }
    const GsPostProcessParams& post_process_params() const { return post_.params(); }

    // Frame-determinism test harness (Mode 1): forwarded to GsTileBinSystem,
    // which owns the readback state since 5d. Public API stays identical.
    void set_determinism_test_active(bool active) { tile_.set_determinism_test_active(active); }
    bool determinism_test_active() const { return tile_.determinism_test_active(); }
    bool determinism_readback_emitted_this_frame() const { return tile_.determinism_readback_emitted_this_frame(); }
    VmaAllocation determinism_readback_allocation() const { return tile_.determinism_readback_allocation(); }
    VmaAllocation tile_sort_count_allocation() const { return tile_.tile_sort_count_allocation(); }
    uint32_t tile_sort_capacity() const { return tile_.tile_sort_capacity(); }
    const void* determinism_readback_data() const { return tile_.determinism_readback_data(); }
    uint32_t live_tile_sort_count() const { return tile_.live_tile_sort_count(); }

    // GPU timing averages (populated over kTimestampAvgFrames)
    float depth_sort_ms_avg() const { return depth_sort_ms_avg_; }
    float tile_sort_ms_avg() const { return tile_sort_ms_avg_; }
    float rasterize_ms_avg() const { return rasterize_ms_avg_; }

    // GPU timing for the most recent frame whose timestamps were available.
    // Updated every frame the readback succeeds (no 60-frame averaging) so
    // single-frame spikes are not smeared.
    float depth_sort_ms_last() const { return depth_sort_ms_last_; }
    float tile_sort_ms_last() const { return tile_sort_ms_last_; }
    float rasterize_ms_last() const { return rasterize_ms_last_; }

    // Phase 5e-1: streaming state + lightweight methods live in
    // GsStreamingSystem. GsRenderer keeps thin forwarders for ABI
    // stability — external callers (renderer.cpp, app_base.cpp,
    // demo, command_dispatcher) don't need source changes.
    const StreamingConfig& streaming_config() const { return streaming_.config(); }
    uint32_t active_chunk_count()             const { return streaming_.active_chunk_count(); }
    uint32_t total_active_splats()            const { return streaming_.total_active_splats(); }
    bool streaming_initialized()              const { return streaming_.initialized(); }
    uint32_t pending_load_count()             const { return streaming_.pending_load_count(); }

    // Per-chunk inventory for diagnostic dumps. status_str is one of
    // "loading", "active", "unloading". Re-exports the system's nested
    // type so callers can still write `GsRenderer::ChunkInventoryEntry`.
    using ChunkInventoryEntry = GsStreamingSystem::ChunkInventoryEntry;
    std::vector<ChunkInventoryEntry> chunk_inventory() const { return streaming_.chunk_inventory(); }

    // World manifest (Phase 3 streaming)
    void load_world(const WorldManifest& manifest) { streaming_.load_world(manifest); }
    const WorldManifest& world_manifest() const   { return streaming_.world_manifest(); }

    // Pre-warm every compute pipeline by submitting **one pipeline per
    // command buffer**, with `vkQueueWaitIdle` between submissions. This
    // forces MoltenVK to compile each `MTLComputePipelineState`
    // sequentially, bounding peak compile-time memory pressure.
    //
    // The earlier all-in-one-cmd-buffer design (#409) compiled all 13
    // shaders in parallel and crashed WindowServer on a Mac with limited
    // free RAM (#410 reverted it).
    //
    // Soft-fail: any internal error logs and returns; the engine continues
    // with cold caches and pays the first-frame compile cost mid-frame.
    //
    // `pump_events` (optional) is invoked after each pipeline's
    // `vkQueueWaitIdle` and inside the inter-pipeline yield loop. It lets
    // the caller drain the windowing system's event queue (typically
    // `glfwPollEvents`) without dragging GLFW into the engine layer.
    // Without this, focus changes / window-damage events sit unprocessed
    // for the multi-second cold-cache prewarm pass and the demo window
    // appears frozen until prewarm completes.
    void prewarm_pipelines(VkQueue queue, VkCommandPool cmd_pool,
                           std::function<void()> pump_events = {});

    void shutdown(VmaAllocator allocator);

private:
    void create_output_image(uint32_t width, uint32_t height);
    void create_compute_pipelines();
    void create_descriptor_resources();
    void update_descriptors();
    // Phase 5c: dispatch_depth_onesweep moved to GsSortSystem (sort_.dispatch_depth_*).
    // Phase 5d: dispatch_tile_sort moved to GsTileBinSystem (tile_.dispatch_sort).
    // Phase 5e-2: publish_pending_chunks + diag_streaming_dump moved to
    // GsStreamingSystem as private members called from poll_transfers.

    VkDevice device_ = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;
    VkPipelineCache pipeline_cache_ = VK_NULL_HANDLE;

    // Per-frame intermediate images. Frame N writes into images_[N % kMaxFramesInFlight];
    // Frame N+1 begins recording before frame N's GPU work has finished, so a single
    // shared VkImage would be raced (compute write of frame N+1 vs composite read of
    // frame N). Indexed by `frame_in_flight` passed into render().



    // GPU buffers
    // Per-frame racing SSBOs: frame N writes slot [N % kMaxFramesInFlight]
    // while frame N-1 is still draining. Phase 1 of the cross-frame race
    // fix converts these to arrays; Phase 3 will wire frame_in_flight into
    // dispatch sites. For now all consumers access slot [0].

    // Phase 5a: GPU resource ownership. Non-owning; bound via set_resources()
    // before init(). AppBase owns the GsResourceManager lifetime.
    GsResourceManager* resources_ = nullptr;

    // Phase 5b: first system extraction. Owns the gs_post_process.comp
    // pipeline + descriptors + runtime params. Lifetime tied to the
    // renderer; init() in GsRenderer::init(), shutdown() inside our
    // explicit shutdown(allocator).
    GsPostProcessSystem post_;

    // Phase 5c: depth sort + merge extraction. Owns onesweep histogram +
    // scatter pipelines (shared with 5d tile-bin via getters), merge
    // pipeline, all depth-sort descriptor sets (3 paths × 4 sets × 2
    // frames + 2 merge = 26 sets), and the sort-size scalars.
    GsSortSystem sort_;

    // Phase 5d: tile binning + tile sort + tile rasterization extraction.
    // Owns 5 layouts + 6 pipelines + 18 descriptor sets (10 tile + 8 tile-
    // onesweep). Borrows sort_'s onesweep pipelines via accessors. Holds
    // the determinism readback harness state (forwarded by the getters
    // above for ABI stability).
    GsTileBinSystem tile_;

    // Phase 5e: PBD solver extraction. Owns the pbd_solver.comp pipeline,
    // descriptor set layout, pipeline layout, and single descriptor set.
    // Public upload_pbd_*/clear_pbd forward to this member.
    GsPbdSystem pbd_;

    // Phase 4b: bone transform storage moved to gseurat::RenderState
    // (per-frame-in-flight, persistent-mapped). Set via set_render_state
    // before init_streaming. Non-owning pointer; AppBase owns lifetime.
    RenderState* render_state_ = nullptr;
    glm::quat actor_rotation_{1.0f, 0.0f, 0.0f, 0.0f};  // Root motion world rotation

    // Phase 5e step 1.10: pbd_count_ and pbd_constraint_count_ moved to GsPbdSystem.
    // Accessors pbd_count() / pbd_constraint_count() forward to pbd_.count() / pbd_.constraint_count().

    // Phase 5e-2: static/dynamic sort sizing, dirty flags, max counts,
    // and the per-slot sentinel-fill request all moved into
    // GsStreamingSystem. dynamic_count_ stays here — it's mutated every
    // frame by set_persistent_dynamics / update_dynamic_gaussians, not
    // by streaming.
    uint32_t dynamic_count_ = 0;            // persistent_dyn_count_ + transient
    uint32_t persistent_dyn_count_ = 0;     // chars/NPCs/PBD-trees prefix in dynamic SSBO

    // Phase 5e-2: GsStreamingSystem owns the full streaming subsystem
    // (data + 7 heavy mutators + 14 cross-cutting sizing/count/dirty
    // fields). The friend declaration from 5e-1 is gone.
    GsStreamingSystem streaming_;

    // Descriptor resources
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorPool gs_pool_ = VK_NULL_HANDLE;
    // preprocess_layout_ is shared by the active static/dynamic preprocess
    // sets below. The legacy single-source `preprocess_sets_` allocations
    // were removed in #397 — the pre-split path has been dead since the
    // streaming-strict invariant landed.
    VkDescriptorSetLayout preprocess_layout_ = VK_NULL_HANDLE;

    // Phase 5c: merge pipeline + layout + sets moved to GsSortSystem.

    // Static/dynamic preprocess descriptor sets — per-frame (Phase 2 plumbing;
    // dispatch still binds [0] until Phase 3).
    std::array<VkDescriptorSet, kMaxFramesInFlight> static_preprocess_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_preprocess_sets_{};

    // Compute pipelines
    VkPipelineLayout preprocess_pipeline_layout_ = VK_NULL_HANDLE;

    VkPipeline preprocess_pipeline_ = VK_NULL_HANDLE;

    // Phase 5e step 1.10: pbd_layout_, pbd_pipeline_layout_, pbd_pipeline_, pbd_set_
    // moved into GsPbdSystem (the pbd_ member declared above).

    // Phase 4c-vfx / 4c-pbd / 4e: GPU compose pass. Dedicated descriptor
    // pool so the central kSetCount=58 allocation in dispatch_descriptor_sets
    // doesn't get reshuffled. One set per (frame, source) tuple: VFX +
    // PBD + Particles share the same pipeline + push-constant layout
    // (splat_count, dst_offset) but distinct src descriptors, so we
    // allocate 3 × kMaxFramesInFlight sets total.
    VkDescriptorSetLayout compose_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout compose_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline compose_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorPool compose_pool_ = VK_NULL_HANDLE;
    std::array<VkDescriptorSet, kMaxFramesInFlight> compose_sets_vfx_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> compose_sets_pbd_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> compose_sets_particles_{};
    // Both sets are written together by update_compose_descriptors when
    // render_state_ and resources_->dynamic_gaussian_ssbo are both live.
    bool compose_descriptors_initialised_ = false;
    void create_compose_pipeline();
    void update_compose_descriptors();  // called from set_render_state

    // Phase 5b: post-process pipeline / layout / sets / params live in
    // GsPostProcessSystem (by-value member below). Renderer dispatches via
    // post_.dispatch(); set_post_process_params() forwards to post_.params().

    // #397: sort_layout_, sort_pipeline_layout_, sort_pipeline_, and the
    // sort_sets_ allocation were all artefacts of the pre-Onesweep depth
    // sort path. Onesweep moved into GsSortSystem (Phase 5c) and owns its
    // own layout/pipeline/sets; nothing in the live render path bound the
    // legacy ones — they were write-only since 5c.

    // Phase 5d: all tile-bin / tile-sort / tile-render layouts, pipelines,
    // descriptor sets, sizing scalars, and determinism harness state moved
    // into GsTileBinSystem (the `tile_` member declared earlier).

    // Phase 5e-2: depth_onesweep_max_wg_ moved into GsStreamingSystem
    // along with the rest of the sort-sizing scalars.

    bool initialized_ = false;

    // Phase 5e-1: world_manifest_ moved into GsStreamingSystem.

    // GPU timestamp profiling: 6 queries per frame slot, kMaxFramesInFlight
    // slots total. Frame f's queries live at indices [f*6, f*6+6):
    //   +0: depth_sort_begin, +1: depth_sort_end
    //   +2: tile_sort_begin,  +3: tile_sort_end
    //   +4: raster_begin,     +5: raster_end
    // Per-slot is required to keep timestamps_written_per_slot_[f] coherent
    // with the non-blocking vkGetQueryPoolResults read: with a shared pool
    // the previous frame's reset would discard frame N's timestamps before
    // any later frame could read them, and on CPU-ahead systems the avg
    // log would never fire.
    VkQueryPool timestamp_pool_ = VK_NULL_HANDLE;
    static constexpr uint32_t kTimestampQueriesPerFrame = 6;
    static constexpr uint32_t kTimestampPoolSize =
        kMaxFramesInFlight * kTimestampQueriesPerFrame;
    float timestamp_period_ns_ = 0.0f;   // nanoseconds per tick
    uint32_t timestamp_frame_ = 0;
    float depth_sort_ms_accum_ = 0.0f;
    float tile_sort_ms_accum_ = 0.0f;
    float rasterize_ms_accum_ = 0.0f;
    float depth_sort_ms_avg_ = 0.0f;     // last completed average
    float tile_sort_ms_avg_ = 0.0f;
    float rasterize_ms_avg_ = 0.0f;
    float depth_sort_ms_last_ = 0.0f;    // last per-frame raw sample
    float tile_sort_ms_last_ = 0.0f;
    float rasterize_ms_last_ = 0.0f;
    // true once frame f has issued its writes — read-and-reset at the start
    // of the NEXT time slot f is reused, where the in-flight fence wait
    // guarantees the writes have landed.
    std::array<bool, kMaxFramesInFlight> timestamps_written_per_slot_{};
    static constexpr uint32_t kTimestampAvgFrames = 60;

    // Shadow box parameters
    bool skip_sort_ = false;
    bool sort_done_once_ = false;  // true after first full sort
    bool shadow_box_active_ = false;
    float shadow_box_margin_ = 128.0f;
    float shadow_box_cone_cos_ = 0.0f;
    glm::vec3 shadow_box_cone_dir_{0.0f, 0.0f, -1.0f};
    glm::vec3 shadow_box_cam_pos_{0.0f};
    uint32_t num_sort_passes_ = 2;
    float scale_multiplier_ = 1.0f;

    // Visual effect state
    float time_ = 0.0f;
    int toon_bands_ = 0;          // 0 = off, 3/4/5 = band count
    float pixel_art_intensity_ = 0.0f; // 0.0 = off, 1.0 = full retro pixel art
    int light_mode_ = 0;          // 0 = off, 1 = directional, 2 = point
    glm::vec3 light_dir_{0.5f, 1.0f, 0.7f};
    float light_intensity_ = 1.0f;
    glm::vec3 touch_point_{0.0f};
    float touch_radius_ = 20.0f;
    bool touch_active_ = false;
    float touch_time_ = 0.0f;
    float water_y_ = -1000.0f;    // sentinel: disabled
    float fire_y_min_ = 0.0f;
    float fire_y_max_ = 0.0f;
    float effect_strength_ = 1.0f;

    // Wave 2 effects
    float explode_t_ = 0.0f;
    float voxel_t_ = 0.0f;
    float pulse_t_ = 0.0f;
    float xray_depth_ = 0.0f;
    float swirl_t_ = 0.0f;
    float burn_t_ = 0.0f;

    // Point lights for GS scene lighting
    std::vector<PointLight> point_lights_;
};

}  // namespace gseurat
