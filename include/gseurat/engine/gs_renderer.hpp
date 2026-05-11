#pragma once

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/pbd_types.hpp"
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

// Post-process parameters forwarded from the composite pipeline to GS compute.
// Mirrors relevant fields from PostProcessParams for consistent visual treatment.
struct GsPostProcessParams {
    float fog_density = 0.0f;
    float fog_color_r = 0.3f;
    float fog_color_g = 0.35f;
    float fog_color_b = 0.45f;
    float exposure = 1.2f;
    float vignette_radius = 0.75f;
    float vignette_softness = 0.45f;
    float bloom_intensity = 0.35f;
    float bloom_threshold = 1.0f;
    float fade_amount = 0.0f;
    float flash_r = 0.0f;
    float flash_g = 0.0f;
    float flash_b = 0.0f;
    float ca_intensity = 0.0f;
    float dof_focus_distance = 12.0f;
    float dof_focus_range = 3.0f;
    float dof_max_blur = 0.5f;
    float far_plane = 1000.0f;  // GS camera far plane for depth normalization

    // Hybrid background (ground plane + sky gradient)
    glm::vec3 ground_color{0.0f};  // RGB ground color (0 = disabled)
    glm::vec3 sky_color{0.0f};     // RGB sky color (0 = disabled)
    float horizon_y = 0.5f;        // Normalized screen Y of horizon (0=top, 1=bottom)
    bool background_enabled = false;

    // Scene-transition overlay (final mix() applied at end of compositing).
    // overlay_alpha == 0 produces a shader no-op.
    float overlay_r = 1.0f;
    float overlay_g = 1.0f;
    float overlay_b = 1.0f;
    float overlay_alpha = 0.0f;
    uint32_t overlay_effect_type = 0;  // 0 = solid fade, 1 = left-to-right wipe
};

// GPU UBO layout for gs_post_process.comp (std140, 8 × vec4 + 16 = 144 bytes)
struct GsPostProcessUbo {
    glm::vec4 fog_params;         // density, r, g, b
    glm::vec4 exposure_vignette;  // exposure, radius, softness, bloom_intensity
    glm::vec4 bloom_fade;         // bloom_threshold, fade_amount, flash_r, flash_g
    glm::vec4 effects;            // flash_b, ca_intensity, dof_focus_dist, dof_focus_range
    glm::vec4 dimensions;         // dof_max_blur, width, height, far_plane
    glm::vec4 ground_sky;         // ground_r, ground_g, ground_b, horizon_y
    glm::vec4 sky_enable;         // sky_r, sky_g, sky_b, enable (> 0.5 = on)
    glm::vec4 overlay;            // r, g, b, alpha (scene transition overlay)
    uint32_t  overlay_effect_type; // 0 = solid fade, 1 = left-to-right wipe
    uint32_t  _pad0;
    uint32_t  _pad1;
    uint32_t  _pad2;
};

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
    void init_streaming(const StreamingConfig& config);
    void unload_cloud(uint32_t chunk_id);
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
    void clear_chunks(VkCommandBuffer drain_cmd = VK_NULL_HANDLE);
    // Async upload via the shared host-visible staging ring. The cloud is
    // moved into a pending-load job stored on the renderer; per-slab
    // `reserve_staging` + memcpy + `submit_with_handle` are issued by
    // `poll_transfers` across frames so a 100-slab cloud doesn't have to
    // fit in the staging ring at once. Returns one Handle per slab,
    // pre-allocated so `EngineLoadingMonitor` can poll their status
    // immediately even before any has been submitted to the GPU.
    // Requires init_streaming() and create_transfer_queue() to have been
    // called first; logs an error and returns {} if streaming isn't ready.
    std::vector<TransferQueue::Handle> load_cloud_async(GaussianCloud cloud);
    void poll_transfers(VkCommandBuffer frame_cmd);
    void create_transfer_queue(VkQueue transfer_q, uint32_t transfer_family,
                               uint32_t graphics_family, bool dedicated);

    // Exposed for the engine-level loading monitor: AppBase wires a status
    // provider against this so the EngineState machine can advance from
    // Loading → Warming when the streamer's transfer handles complete.
    // Returns nullptr until `create_transfer_queue` runs.
    TransferQueue* transfer_queue() { return transfer_queue_.get(); }
    const TransferQueue* transfer_queue() const { return transfer_queue_.get(); }
    void update_active_gaussians(const Gaussian* data, uint32_t count);
    void update_gaussian_data(const Gaussian* data, uint32_t count);

    // Per-frame dynamic upload API (VFX/particles/scene-anim "transient suffix").
    // Writes at offset persistent_dyn_count_; sets dynamic_count_ to
    // persistent_dyn_count_ + count. Static geometry (terrain) arrives via
    // load_cloud_async + publish_pending_chunks, not this path.
    void update_dynamic_gaussians(const Gaussian* data, uint32_t count);

    // Once-per-scene (or per-chunk-event) upload API for the "persistent prefix"
    // of the dynamic buffer: characters, NPCs, PBD-tagged trees. Replaces all
    // existing persistent-dynamic content. Caller assembles the full vector;
    // engine doesn't track per-source slots. After this call, dynamic_count_
    // resets to the persistent count (transient region is zero until the next
    // update_dynamic_gaussians).
    void set_persistent_dynamics(const Gaussian* data, uint32_t count);
    uint32_t persistent_dynamic_count() const { return persistent_dyn_count_; }
    uint32_t max_static_count() const { return max_static_count_; }
    uint32_t max_dynamic_count() const { return max_dynamic_count_; }
    uint32_t static_count() const { return static_count_; }
    uint32_t dynamic_count() const { return dynamic_count_; }
    bool static_dirty() const { return static_dirty_frames_remaining_ > 0; }
    // Marks the static head of projected_ssbos_ as dirty for the next
    // kMaxFramesInFlight frames. Phase 3: with per-frame projected SSBOs,
    // each frame slot must run static_preprocess once to refresh its slot.
    void set_static_dirty(bool d) {
        static_dirty_frames_remaining_ = d ? kMaxFramesInFlight : 0;
    }

    void resize_output(uint32_t width, uint32_t height);

    // Records a one-time barrier+clear that transitions every per-frame
    // GS output, processed, and depth image out of `VK_IMAGE_LAYOUT_UNDEFINED`
    // (post-creation state) into `VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL`
    // with contents cleared to black. The renderer's main pass samples
    // `processed_views_[frame]` every frame; without this seed transition,
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
        return processed_views_[frame_in_flight] != VK_NULL_HANDLE
            ? processed_views_[frame_in_flight]
            : output_views_[frame_in_flight];
    }
    VkImageView raw_output_view(uint32_t frame_in_flight) const {
        return output_views_[frame_in_flight];
    }
    // Backwards-compatible accessors returning all per-frame views; the
    // descriptor allocator binds set i to view i.
    const std::array<VkImageView, kMaxFramesInFlight>& output_views() const {
        // Prefer processed if available; callers needing the raw-HDR
        // version use `raw_output_views()`.
        return processed_views_[0] != VK_NULL_HANDLE ? processed_views_ : output_views_;
    }
    const std::array<VkImageView, kMaxFramesInFlight>& raw_output_views() const {
        return output_views_;
    }
    VkSampler output_sampler() const { return output_sampler_; }
    // Sized for: persistent dynamics (PBD-tagged trees, characters, NPCs) +
    // transient dynamics (VFX objects, particle emitters, scene animations).
    // The split-tail design (Option A) puts all bone-animated and PBD-tagged
    // splats in dynamic_gaussian_ssbo_ so the static depth sort doesn't have
    // to re-run every frame to keep them current. Persistent content sums to
    // ~700-800k splats for the island demo (12 trees × ~60k tagged + chars
    // + NPCs); transient adds ~200k headroom for chimney_smoke + torches.
    // 1M × 64 B = 64 MB; projected_ssbo_ grows proportionally. M5 unified
    // memory absorbs this trivially.
    static constexpr uint32_t kDynamicHeadroom = 1048576;

    bool has_cloud() const { return gaussian_count_ > 0; }
    uint32_t gaussian_count() const { return gaussian_count_; }
    uint32_t max_gaussian_count() const { return max_gaussian_count_; }
    uint32_t output_width() const { return output_width_; }
    uint32_t output_height() const { return output_height_; }
    uint32_t visible_count() const {
        if (counts_ssbos_[0].mapped()) {
            auto* c = static_cast<const uint32_t*>(counts_ssbos_[0].mapped());
            return c[0] + c[1];  // static_visible + dynamic_visible
        }
        if (visible_count_ssbos_[0].mapped())
            return *static_cast<const uint32_t*>(visible_count_ssbos_[0].mapped());
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

    // Bone transforms for character skinning (max 32 bones)
    static constexpr uint32_t kMaxBones = 32;
    void upload_bone_transforms(const glm::mat4* transforms, uint32_t count);
    void clear_bone_transforms();

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
    uint32_t pbd_count() const { return pbd_count_; }
    uint32_t pbd_constraint_count() const { return pbd_constraint_count_; }

    // Post-process parameters (fog, tone mapping, vignette, etc.)
    void set_post_process_params(const GsPostProcessParams& p) { gs_pp_params_ = p; }
    const GsPostProcessParams& post_process_params() const { return gs_pp_params_; }

    // Frame-determinism test harness (Mode 1): when active, copy the
    // post-Onesweep tile_sort_a_ buffer into a host-mapped readback so the
    // CPU can hash the live entry range and detect order-instability
    // across frames with frozen inputs. Debug-only; no production cost.
    void set_determinism_test_active(bool active) {
        determinism_test_active_ = active;
        if (!active) determinism_readback_emitted_ = false;
    }
    bool determinism_test_active() const { return determinism_test_active_; }

    // True iff `dispatch_tile_sort` actually emitted a host-visible copy of
    // tile_sort_a_ this frame. False during scene-transition / loading frames
    // where the GS compute path was skipped (no cloud, !gs_rendering,
    // !dispatch_gpu_compute, capacity == 0). The harness uses this to skip
    // frames with stale readback contents — without it the test could report
    // a false STABLE verdict from leftover bytes.
    bool determinism_readback_emitted_this_frame() const {
        return determinism_readback_emitted_;
    }

    // Raw VMA allocation handles + capacity exposed for the harness to call
    // `vmaInvalidateAllocation` after the in-flight fence and clamp the hash
    // range to actual buffer size. Both buffers are host-mapped; on
    // platforms whose memory type is not `HOST_COHERENT`, omitting the
    // invalidate would let stale CPU caches leak into the verdict.
    VmaAllocation determinism_readback_allocation() const {
        return determinism_readback_.allocation();
    }
    VmaAllocation tile_sort_count_allocation() const {
        return tile_sort_count_ssbo_.allocation();
    }
    uint32_t tile_sort_capacity() const { return tile_sort_capacity_; }

    const void* determinism_readback_data() const {
        return determinism_readback_.mapped();
    }
    uint32_t live_tile_sort_count() const {
        if (tile_sort_count_ssbo_.mapped() == nullptr) return 0;
        return *static_cast<const uint32_t*>(tile_sort_count_ssbo_.mapped());
    }

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

    // Live streaming config (slab_size_splats etc.). Demo plumbs this into
    // GsChunkStreamer so its [streaming] event-log "slabs=" field uses the
    // same vocabulary as the renderer's slab-based streamer.
    const StreamingConfig& streaming_config() const { return streaming_config_; }

    // Streaming state (read-only)
    uint32_t active_chunk_count() const { return static_cast<uint32_t>(active_chunks_.size()); }
    uint32_t total_active_splats() const { return total_active_splats_; }
    bool streaming_initialized() const { return streaming_initialized_; }

    // Per-chunk inventory for diagnostic dumps. status_str is one of
    // "loading", "active", "unloading"; splat_count is the splat count
    // published by the chunk's load completion callback.
    struct ChunkInventoryEntry {
        std::string status_str;
        uint32_t page_table_offset;
        uint32_t splat_count;
        uint32_t slab_count;
    };
    std::vector<ChunkInventoryEntry> chunk_inventory() const;
    uint32_t pending_load_count() const { return static_cast<uint32_t>(pending_loads_.size()); }

    // World manifest (Phase 3 streaming)
    void load_world(const WorldManifest& manifest);
    const WorldManifest& world_manifest() const { return world_manifest_; }

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
    void dispatch_depth_onesweep(VkCommandBuffer cmd, uint32_t sort_size, uint32_t num_workgroups,
        VkDescriptorSet hist_a, VkDescriptorSet hist_b,
        VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba);
    // Phase 3: frame_in_flight selects tile_bin_sets_[f] so the per-frame
    // racing projected/merged/counts slots are read correctly.
    void dispatch_tile_sort(VkCommandBuffer cmd, uint32_t frame_in_flight);
    // Drain pending_publications_ and record the metadata writes
    // (page_table, chunk_table) onto `cmd` via vkCmdUpdateBuffer + a
    // TRANSFER_WRITE -> SHADER_READ barrier. Called from poll_transfers
    // immediately after poll_completions enqueues new publications.
    void publish_pending_chunks(VkCommandBuffer cmd);

    // DIAG: stderr-print streaming-state snapshot (active_chunks_, counts,
    // projected_ssbo_/merged_sort_ssbo_/static_sort_a_ tail samples) for
    // ghost investigation. Opt-in via env var GS_DIAG_STREAMING=1.
    void diag_streaming_dump(uint64_t frame);

    VkDevice device_ = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;
    VkPipelineCache pipeline_cache_ = VK_NULL_HANDLE;

    // Per-frame intermediate images. Frame N writes into images_[N % kMaxFramesInFlight];
    // Frame N+1 begins recording before frame N's GPU work has finished, so a single
    // shared VkImage would be raced (compute write of frame N+1 vs composite read of
    // frame N). Indexed by `frame_in_flight` passed into render().
    std::array<VkImage,        kMaxFramesInFlight> output_images_{};
    std::array<VmaAllocation,  kMaxFramesInFlight> output_allocations_{};
    std::array<VkImageView,    kMaxFramesInFlight> output_views_{};
    VkSampler output_sampler_ = VK_NULL_HANDLE;
    uint32_t output_width_ = 0;
    uint32_t output_height_ = 0;

    std::array<VkImage,        kMaxFramesInFlight> depth_images_{};
    std::array<VmaAllocation,  kMaxFramesInFlight> depth_allocations_{};
    std::array<VkImageView,    kMaxFramesInFlight> depth_views_{};

    std::array<VkImage,        kMaxFramesInFlight> processed_images_{};
    std::array<VmaAllocation,  kMaxFramesInFlight> processed_allocations_{};
    std::array<VkImageView,    kMaxFramesInFlight> processed_views_{};

    // GPU buffers
    Buffer gaussian_ssbo_;           // Input Gaussians
    // Per-frame racing SSBOs: frame N writes slot [N % kMaxFramesInFlight]
    // while frame N-1 is still draining. Phase 1 of the cross-frame race
    // fix converts these to arrays; Phase 3 will wire frame_in_flight into
    // dispatch sites. For now all consumers access slot [0].
    std::array<Buffer, kMaxFramesInFlight> projected_ssbos_{};   // Projected 2D splats
    std::array<Buffer, kMaxFramesInFlight> sort_keys_ssbos_{};   // Sort buffer A (ping-pong)
    std::array<Buffer, kMaxFramesInFlight> sort_b_ssbos_{};      // Sort buffer B (ping-pong)

    Buffer uniform_buffer_;          // Camera + resolution
    std::array<Buffer, kMaxFramesInFlight> visible_count_ssbos_{};  // Atomic counter: visible Gaussians after frustum cull
    Buffer bone_ssbo_;               // Bone transforms for character skinning
    uint32_t bone_count_ = 0;
    glm::quat actor_rotation_{1.0f, 0.0f, 0.0f, 0.0f};  // Root motion world rotation

    // PBD solver resources
    Buffer pbd_state_ssbo_;
    Buffer pbd_params_ssbo_;
    Buffer pbd_constraint_ssbo_;
    Buffer pbd_uniform_buffer_;
    uint32_t pbd_count_ = 0;
    uint32_t pbd_constraint_count_ = 0;

    // Static/dynamic split buffers
    Buffer static_gaussian_ssbo_;
    Buffer dynamic_gaussian_ssbo_;
    Buffer static_sort_a_;
    Buffer static_sort_b_;
    // Per-frame racing SSBOs (see comment above projected_ssbos_).
    std::array<Buffer, kMaxFramesInFlight> dynamic_sort_as_{};
    std::array<Buffer, kMaxFramesInFlight> dynamic_sort_bs_{};
    std::array<Buffer, kMaxFramesInFlight> merged_sort_ssbos_{};
    std::array<Buffer, kMaxFramesInFlight> counts_ssbos_{};  // {static_visible, dynamic_visible, merged_visible}

    uint32_t static_count_ = 0;
    uint32_t dynamic_count_ = 0;            // persistent_dyn_count_ + transient
    uint32_t persistent_dyn_count_ = 0;     // chars/NPCs/PBD-trees prefix in dynamic SSBO
    uint32_t max_static_count_ = 0;
    uint32_t max_dynamic_count_ = 0;
    uint32_t static_sort_size_ = 0;
    uint32_t dynamic_sort_size_ = 0;
    uint32_t static_sort_workgroups_ = 0;
    uint32_t dynamic_sort_workgroups_ = 0;
    // Static-head refresh countdown. With per-frame projected_ssbos_,
    // each frame slot must re-run static_preprocess once after a static
    // mutation. Initialized to kMaxFramesInFlight so the first
    // kMaxFramesInFlight frames each refresh their own projected slot.
    uint32_t static_dirty_frames_remaining_ = kMaxFramesInFlight;

    // --- Streaming architecture (Phase 2) ---
    StreamingConfig streaming_config_;
    std::unique_ptr<SlabAllocator> slab_allocator_;
    Buffer page_table_ssbo_;
    Buffer chunk_table_ssbo_;

    struct ChunkState {
        enum class Status { LOADING, ACTIVE, UNLOADING };
        Status status;
        SlabAllocator::SlabHandle handle;
        uint32_t page_table_offset;
        uint32_t splat_count;
    };
    std::vector<ChunkState> active_chunks_;
    uint32_t total_active_splats_{0};
    bool streaming_initialized_{false};

    // Async transfer queue. Reservations and submits run on the main thread;
    // `poll_transfers` (per-frame) retires fences and fires per-batch
    // completion callbacks that publish uploaded chunks to the renderer.
    std::unique_ptr<TransferQueue> transfer_queue_;

    // Queued async cloud uploads. `load_cloud_async` always pushes to
    // the back; `poll_transfers` drains the front job's slabs as the
    // staging ring frees space, and pops once a job's slabs are all
    // submitted (the per-job completion callback then fires later when
    // the GPU fence retires). The deque lets WorldStreamer queue
    // multiple chunks back-to-back without losing requests — under
    // single-slot semantics, the streamer marks chunks `LOADING` once
    // and never retries, so a rejected request would stick forever.
    struct PendingLoadJob {
        GaussianCloud cloud;
        SlabAllocator::SlabHandle slab_handle;
        std::vector<TransferQueue::Handle> handles;  // one per slab
        uint32_t splat_count = 0;
        uint32_t slabs_needed = 0;
        uint32_t slab_size_splats = 0;
        uint32_t next_slab = 0;          // index of the next slab to submit
        bool completion_enqueued = false; // true once enqueue_completion() ran
    };
    std::deque<PendingLoadJob> pending_loads_;

    // Chunks whose metadata mutation (page_table, chunk_table) has been
    // requested but not yet published on the GPU. Both load completions and
    // unload requests enqueue here; the actual SSBO writes happen in
    // publish_pending_chunks() recorded onto the current frame's command
    // buffer with TRANSFER_WRITE -> SHADER_READ barriers. This avoids the
    // host/device race that raw mapped writes have against in-flight GPU
    // reads of the same SSBOs.
    struct PendingChunkPublication {
        enum class Op { Load, Unload };
        Op op = Op::Load;
        // Load: handle for the new chunk (slabs already filled via TransferQueue).
        // Unload: ownership of the chunk's slab handle, captured from
        //         active_chunks_ at unload_cloud() time. The handle stays
        //         in this struct until publish moves it onto
        //         deferred_slab_releases_ for fence-safe release.
        SlabAllocator::SlabHandle handle;
        uint32_t splat_count = 0;        // Load only
        uint32_t slabs_needed = 0;
        uint32_t slab_size_splats = 0;   // Load only
        uint32_t unload_chunk_id = 0;    // Unload only
    };
    std::deque<PendingChunkPublication> pending_publications_;

    // Slabs released by an unload have to outlive any in-flight frame that
    // was reading them via the OLD page_table. We can't return them to the
    // allocator immediately — a concurrent load could check those same
    // physical slabs out and TransferQueue would overwrite Gaussian data
    // still being read by the prior frame. Hold for at least
    // kMaxFramesInFlight ticks of poll_transfers (+1 for slack), then
    // release. That guarantees the frame which last referenced the OLD
    // page_table has retired.
    struct DeferredSlabRelease {
        SlabAllocator::SlabHandle handle;
        uint32_t frames_remaining = 0;
    };
    std::deque<DeferredSlabRelease> deferred_slab_releases_;

    uint32_t gaussian_count_ = 0;
    uint32_t max_gaussian_count_ = 0;
    uint32_t sort_size_ = 0;         // Power-of-2 padded count
    uint32_t num_sort_workgroups_ = 0;

    // Descriptor resources
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorPool gs_pool_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout preprocess_layout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout render_layout_ = VK_NULL_HANDLE;
    // Per-frame compute sets: preprocess_sets_[f] is bound to *_ssbos_[f].
    // Phase 2: plumbing only — dispatch sites still use [0]. Phase 3 routes
    // frame_in_flight to actually use the per-frame slot.
    std::array<VkDescriptorSet, kMaxFramesInFlight> preprocess_sets_{};
    // render_set_ binds output_image + depth_image — both per-frame —
    // so the set must also be per-frame to point at the right pair.
    std::array<VkDescriptorSet, kMaxFramesInFlight> render_sets_{};

    // Merge pipeline
    VkDescriptorSetLayout merge_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout merge_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline merge_pipeline_ = VK_NULL_HANDLE;
    // Per-frame merge sets: merge_sets_[f] binds dynamic_sort_as_[f],
    // merged_sort_ssbos_[f], counts_ssbos_[f] (all racing per-frame buffers).
    std::array<VkDescriptorSet, kMaxFramesInFlight> merge_sets_{};

    // Static/dynamic preprocess descriptor sets — per-frame (Phase 2 plumbing;
    // dispatch still binds [0] until Phase 3).
    std::array<VkDescriptorSet, kMaxFramesInFlight> static_preprocess_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_preprocess_sets_{};

    // Compute pipelines
    VkPipelineLayout preprocess_pipeline_layout_ = VK_NULL_HANDLE;

    VkPipeline preprocess_pipeline_ = VK_NULL_HANDLE;

    // PBD solver pipeline
    VkDescriptorSetLayout pbd_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout pbd_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline pbd_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet pbd_set_ = VK_NULL_HANDLE;

    // Post-process pipeline
    VkDescriptorSetLayout post_process_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout post_process_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline post_process_pipeline_ = VK_NULL_HANDLE;
    // post_process binds input output_image + depth_image AND output processed_image
    // — three per-frame images, so the set is per-frame.
    std::array<VkDescriptorSet, kMaxFramesInFlight> post_process_sets_{};
    Buffer pp_ubo_buffer_;
    GsPostProcessParams gs_pp_params_;

    // Legacy sort (kept for fallback, not dispatched)
    VkDescriptorSetLayout sort_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout sort_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline sort_pipeline_ = VK_NULL_HANDLE;
    // Per-frame sort sets (Phase 2 plumbing; dispatch still binds [0]).
    std::array<VkDescriptorSet, kMaxFramesInFlight> sort_sets_{};

    // ── Tile binning pipeline (deterministic count→scan→scatter) ──
    // The combined `tile_bin_layout_` covers both the count and scatter
    // shaders (gs_tile_count.comp / gs_tile_bin.comp). Bindings:
    //   0 projected[]   1 merged_entries[]   2 counts (ro)
    //   3 per_splat_tile_count[]  4 per_splat_tile_offset[]
    //   5 tile_entries[]          6 uniforms
    // Count shader uses 0,1,2,3,6. Scatter uses 0,1,2,4,5,6.
    VkDescriptorSetLayout tile_bin_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout tile_bin_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline tile_bin_pipeline_ = VK_NULL_HANDLE;
    // Per-frame (Phase 3): tile_bin_sets_[f] binds projected_ssbos_[f],
    // merged_sort_ssbos_[f], counts_ssbos_[f]. Other bindings (per_splat_*,
    // tile_entries, uniforms) are single-instance.
    std::array<VkDescriptorSet, kMaxFramesInFlight> tile_bin_sets_{};

    // Pre-scatter count pass (gs_tile_count.comp). Shares layout/set with
    // tile_bin_pipeline_ — the binding set is a strict superset of what
    // either shader reads.
    VkPipeline tile_count_pipeline_ = VK_NULL_HANDLE;

    // Three-dispatch exclusive prefix-sum (gs_tile_scan.comp). Bindings:
    //   0 per_splat_tile_count[]  1 per_splat_tile_offset[]
    //   2 scan_block_sums[]       3 tile_sort_count
    VkDescriptorSetLayout tile_scan_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout tile_scan_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline tile_scan_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet tile_scan_set_ = VK_NULL_HANDLE;

    // Indirect dispatch preparation
    VkDescriptorSetLayout tile_indirect_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout tile_indirect_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline tile_indirect_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet tile_indirect_set_ = VK_NULL_HANDLE;

    // Tile range detection pipeline
    VkDescriptorSetLayout tile_ranges_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout tile_ranges_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline tile_ranges_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet tile_ranges_set_ = VK_NULL_HANDLE;

    // Tile render pipeline (8 bindings)
    VkDescriptorSetLayout tile_render_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout tile_render_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline tile_render_pipeline_ = VK_NULL_HANDLE;
    // tile_render binds output_image + depth_image — per-frame.
    std::array<VkDescriptorSet, kMaxFramesInFlight> tile_render_sets_{};

    // Onesweep 2-dispatch sort (histogram+lookback → scatter)
    VkDescriptorSetLayout onesweep_hist_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout onesweep_hist_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline onesweep_hist_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet onesweep_hist_set_a_ = VK_NULL_HANDLE;  // read from A
    VkDescriptorSet onesweep_hist_set_b_ = VK_NULL_HANDLE;  // read from B

    VkDescriptorSetLayout onesweep_scatter_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout onesweep_scatter_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline onesweep_scatter_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet onesweep_scatter_set_ab_ = VK_NULL_HANDLE;  // read A → write B
    VkDescriptorSet onesweep_scatter_set_ba_ = VK_NULL_HANDLE;  // read B → write A

    Buffer onesweep_status_;    // per-digit lookback status buffer (tile sort, coherent)
    uint32_t onesweep_max_wg_ = 0;

    // Depth sort Onesweep (reuses same shaders as tile sort)
    Buffer depth_onesweep_status_;       // per-digit lookback status (depth sort, coherent)
    Buffer depth_sort_params_;           // IndirectArgs-layout buffer for legacy depth sort
    Buffer static_depth_params_;         // IndirectArgs-layout buffer for static depth sort
    Buffer dynamic_depth_params_;        // IndirectArgs-layout buffer for dynamic depth sort
    uint32_t depth_onesweep_max_wg_ = 0;

    // Depth sort Onesweep descriptor sets (legacy path) — per-frame.
    // These bind racing sort_keys_ssbos_[f] / sort_b_ssbos_[f].
    std::array<VkDescriptorSet, kMaxFramesInFlight> depth_hist_sets_a_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> depth_hist_sets_b_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> depth_scatter_sets_ab_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> depth_scatter_sets_ba_{};

    // Depth sort Onesweep descriptor sets (static path) — single-instance.
    // These bind only static_sort_a_/b_ which are GPU-fenced via static_dirty_.
    VkDescriptorSet static_depth_hist_set_a_ = VK_NULL_HANDLE;
    VkDescriptorSet static_depth_hist_set_b_ = VK_NULL_HANDLE;
    VkDescriptorSet static_depth_scatter_set_ab_ = VK_NULL_HANDLE;
    VkDescriptorSet static_depth_scatter_set_ba_ = VK_NULL_HANDLE;

    // Depth sort Onesweep descriptor sets (dynamic path) — per-frame.
    // These bind racing dynamic_sort_as_[f] / dynamic_sort_bs_[f].
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_depth_hist_sets_a_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_depth_hist_sets_b_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_depth_scatter_sets_ab_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_depth_scatter_sets_ba_{};

    // Tile sort buffers
    Buffer tile_sort_a_;              // TileSortEntry ping buffer (8 bytes/entry)
    Buffer tile_sort_b_;              // TileSortEntry pong buffer
    Buffer tile_sort_count_ssbo_;     // single uint32 — written by gs_tile_scan pass=1
    Buffer tile_ranges_ssbo_;         // per-tile {start, count}
    Buffer tile_indirect_args_;       // indirect dispatch args (8 × uint32)

    // Deterministic tile-bin (Fix B) intermediate SSBOs. All sized to the
    // visible-splat upper bound (static_sort_size_ + dynamic_sort_size_).
    Buffer per_splat_tile_count_ssbo_;   // uint32 × visible_upper
    Buffer per_splat_tile_offset_ssbo_;  // uint32 × visible_upper (exclusive scan)
    Buffer scan_block_sums_ssbo_;        // uint32 × ceil(visible_upper / 256)
    uint32_t scan_dispatch_size_ = 0;    // visible_upper rounded up to 256
    uint32_t scan_num_blocks_ = 0;       // scan_dispatch_size_ / 256
    // Frame-determinism harness: HOST_VISIBLE copy of the post-Onesweep
    // tile_sort_a_ buffer. Sized to match tile_sort_a_; only populated when
    // determinism_test_active_ is true.
    Buffer determinism_readback_;
    VkDeviceSize determinism_readback_size_ = 0;
    bool determinism_test_active_ = false;
    // Set true by `dispatch_tile_sort` once the host-visible copy has
    // actually been recorded for the current command buffer. Cleared at
    // the start of each `dispatch_tile_sort`. The harness consults this
    // before counting a frame so that loading / transition frames where
    // the GS compute path was gated off don't pollute the verdict.
    bool determinism_readback_emitted_ = false;

    uint32_t tile_sort_capacity_ = 0;    // max entries in tile sort buffers
    uint32_t tile_sort_size_ = 0;        // workgroup-aligned count for radix sort
    uint32_t tile_sort_workgroups_ = 0;
    static constexpr uint32_t kTileSortPasses = 4;  // 4 passes for 32-bit key
    bool initialized_ = false;

    // World manifest (Phase 3 streaming)
    WorldManifest world_manifest_;

    // GPU timestamp profiling: 6 queries
    //   0: depth_sort_begin, 1: depth_sort_end
    //   2: tile_sort_begin,  3: tile_sort_end
    //   4: raster_begin,     5: raster_end
    VkQueryPool timestamp_pool_ = VK_NULL_HANDLE;
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
    bool timestamps_written_ = false;     // true after rasterize dispatch writes timestamps
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
