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
#include <atomic>
#include <memory>
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
};

// GPU UBO layout for gs_post_process.comp (std140, 7 × vec4 = 112 bytes)
struct GsPostProcessUbo {
    glm::vec4 fog_params;         // density, r, g, b
    glm::vec4 exposure_vignette;  // exposure, radius, softness, bloom_intensity
    glm::vec4 bloom_fade;         // bloom_threshold, fade_amount, flash_r, flash_g
    glm::vec4 effects;            // flash_b, ca_intensity, dof_focus_dist, dof_focus_range
    glm::vec4 dimensions;         // dof_max_blur, width, height, far_plane
    glm::vec4 ground_sky;         // ground_r, ground_g, ground_b, horizon_y
    glm::vec4 sky_enable;         // sky_r, sky_g, sky_b, enable (> 0.5 = on)
};

// Push constants for preprocess shader (static/dynamic offset)
struct GsPreprocessPush {
    uint32_t projected_offset;
    uint32_t gaussian_count;
    uint32_t counts_index;  // 0 for static, 1 for dynamic
};

class GsRenderer {
public:
    void init(VkDevice device, VkPhysicalDevice physical_device, VmaAllocator allocator, VkDescriptorPool pool);
    void load_cloud(const GaussianCloud& cloud);
    void init_streaming(const StreamingConfig& config);
    void unload_cloud(uint32_t chunk_id);
    void load_cloud_async(const std::string& ply_path);
    void poll_transfers(VkCommandBuffer frame_cmd);
    void create_transfer_queue(VkQueue transfer_q, uint32_t transfer_family,
                               bool dedicated, VkQueue graphics_q);
    void update_active_gaussians(const Gaussian* data, uint32_t count);
    void update_gaussian_data(const Gaussian* data, uint32_t count);

    // Static/dynamic split API
    void update_static_gaussians(const Gaussian* data, uint32_t count);
    void update_dynamic_gaussians(const Gaussian* data, uint32_t count);
    uint32_t max_static_count() const { return max_static_count_; }
    uint32_t max_dynamic_count() const { return max_dynamic_count_; }
    uint32_t static_count() const { return static_count_; }
    uint32_t dynamic_count() const { return dynamic_count_; }
    bool static_dirty() const { return static_dirty_; }
    void set_static_dirty(bool d) { static_dirty_ = d; }

    void resize_output(uint32_t width, uint32_t height);
    void render(VkCommandBuffer cmd, const glm::mat4& view, const glm::mat4& proj);
    VkImageView output_view() const { return processed_view_ ? processed_view_ : output_view_; }
    VkImageView raw_output_view() const { return output_view_; }
    VkSampler output_sampler() const { return output_sampler_; }
    static constexpr uint32_t kParticleHeadroom = 2048;
    static constexpr uint32_t kDynamicHeadroom = 8192;  // particles + character + animated regions

    void ensure_capacity(uint32_t needed_total);

    bool has_cloud() const { return gaussian_count_ > 0; }
    uint32_t gaussian_count() const { return gaussian_count_; }
    uint32_t max_gaussian_count() const { return max_gaussian_count_; }
    uint32_t output_width() const { return output_width_; }
    uint32_t output_height() const { return output_height_; }
    uint32_t visible_count() const {
        if (counts_ssbo_.mapped()) {
            auto* c = static_cast<const uint32_t*>(counts_ssbo_.mapped());
            return c[0] + c[1];  // static_visible + dynamic_visible
        }
        if (visible_count_ssbo_.mapped())
            return *static_cast<const uint32_t*>(visible_count_ssbo_.mapped());
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

    // Actor world rotation for root motion (Phase 2: applied to per-Gaussian covariance)
    void set_actor_rotation(const glm::quat& q) { actor_rotation_ = q; static_dirty_ = true; }

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

    void set_tile_binning(bool enabled) { tile_binning_enabled_ = enabled; }
    bool tile_binning() const { return tile_binning_enabled_; }


    // World manifest (Phase 3 streaming)
    void load_world(const WorldManifest& manifest);
    const WorldManifest& world_manifest() const { return world_manifest_; }

    void shutdown(VmaAllocator allocator);

private:
    void create_output_image(uint32_t width, uint32_t height);
    void create_compute_pipelines();
    void create_descriptor_resources();
    void update_descriptors();
    void dispatch_radix_sort(VkCommandBuffer cmd, uint32_t sort_size, uint32_t num_workgroups,
        VkDescriptorSet hist_a, VkDescriptorSet hist_b, VkDescriptorSet scan,
        VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba);
    void dispatch_tile_sort(VkCommandBuffer cmd);
    void load_cloud_legacy(const GaussianCloud& cloud);

    VkDevice device_ = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;

    // Output storage image (raw HDR from tile rasterizer)
    VkImage output_image_ = VK_NULL_HANDLE;
    VmaAllocation output_allocation_ = VK_NULL_HANDLE;
    VkImageView output_view_ = VK_NULL_HANDLE;
    VkSampler output_sampler_ = VK_NULL_HANDLE;
    uint32_t output_width_ = 0;
    uint32_t output_height_ = 0;

    // Depth storage image (R16F, per-pixel view-space depth from tile rasterizer)
    VkImage depth_image_ = VK_NULL_HANDLE;
    VmaAllocation depth_allocation_ = VK_NULL_HANDLE;
    VkImageView depth_view_ = VK_NULL_HANDLE;

    // Post-processed output image (RGBA16F, final result after effects)
    VkImage processed_image_ = VK_NULL_HANDLE;
    VmaAllocation processed_allocation_ = VK_NULL_HANDLE;
    VkImageView processed_view_ = VK_NULL_HANDLE;

    // GPU buffers
    Buffer gaussian_ssbo_;           // Input Gaussians
    Buffer projected_ssbo_;          // Projected 2D splats
    Buffer sort_keys_ssbo_;          // Sort buffer A (ping-pong)
    Buffer sort_b_ssbo_;             // Sort buffer B (ping-pong)
    Buffer histogram_ssbo_;          // Radix sort histogram (256 bins × num_workgroups)
    Buffer uniform_buffer_;          // Camera + resolution
    Buffer visible_count_ssbo_;      // Atomic counter: visible Gaussians after frustum cull
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
    Buffer dynamic_sort_a_;
    Buffer dynamic_sort_b_;
    Buffer static_histogram_ssbo_;
    Buffer dynamic_histogram_ssbo_;
    Buffer merged_sort_ssbo_;
    Buffer counts_ssbo_;  // {static_visible, dynamic_visible, merged_visible}

    uint32_t static_count_ = 0;
    uint32_t dynamic_count_ = 0;
    uint32_t max_static_count_ = 0;
    uint32_t max_dynamic_count_ = 0;
    uint32_t static_sort_size_ = 0;
    uint32_t dynamic_sort_size_ = 0;
    uint32_t static_sort_workgroups_ = 0;
    uint32_t dynamic_sort_workgroups_ = 0;
    bool static_dirty_ = true;

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

    // Async transfer + background loading
    std::unique_ptr<TransferQueue> transfer_queue_;
    std::vector<std::thread> load_threads_;
    std::atomic<uint32_t> pending_loads_{0};

    uint32_t gaussian_count_ = 0;
    uint32_t max_gaussian_count_ = 0;
    uint32_t sort_size_ = 0;         // Power-of-2 padded count
    uint32_t num_sort_workgroups_ = 0;

    // Descriptor resources
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorPool gs_pool_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout preprocess_layout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout render_layout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout radix_histogram_layout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout radix_scan_layout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout radix_scatter_layout_ = VK_NULL_HANDLE;

    VkDescriptorSet preprocess_set_ = VK_NULL_HANDLE;
    VkDescriptorSet render_set_ = VK_NULL_HANDLE;
    VkDescriptorSet radix_histogram_set_a_ = VK_NULL_HANDLE;  // reads sort A
    VkDescriptorSet radix_histogram_set_b_ = VK_NULL_HANDLE;  // reads sort B
    VkDescriptorSet radix_scan_set_ = VK_NULL_HANDLE;
    VkDescriptorSet radix_scatter_set_ab_ = VK_NULL_HANDLE;   // A → B
    VkDescriptorSet radix_scatter_set_ba_ = VK_NULL_HANDLE;   // B → A

    // Merge pipeline
    VkDescriptorSetLayout merge_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout merge_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline merge_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet merge_set_ = VK_NULL_HANDLE;

    // Static/dynamic preprocess and sort descriptor sets
    VkDescriptorSet static_preprocess_set_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_preprocess_set_ = VK_NULL_HANDLE;
    VkDescriptorSet static_histogram_set_a_ = VK_NULL_HANDLE;
    VkDescriptorSet static_histogram_set_b_ = VK_NULL_HANDLE;
    VkDescriptorSet static_scatter_set_ab_ = VK_NULL_HANDLE;
    VkDescriptorSet static_scatter_set_ba_ = VK_NULL_HANDLE;
    VkDescriptorSet static_scan_set_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_histogram_set_a_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_histogram_set_b_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_scatter_set_ab_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_scatter_set_ba_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_scan_set_ = VK_NULL_HANDLE;

    // Compute pipelines
    VkPipelineLayout preprocess_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout render_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout radix_histogram_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout radix_scan_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout radix_scatter_pipeline_layout_ = VK_NULL_HANDLE;

    VkPipeline preprocess_pipeline_ = VK_NULL_HANDLE;
    VkPipeline render_pipeline_ = VK_NULL_HANDLE;
    VkPipeline radix_histogram_pipeline_ = VK_NULL_HANDLE;
    VkPipeline radix_scan_pipeline_ = VK_NULL_HANDLE;
    VkPipeline radix_scatter_pipeline_ = VK_NULL_HANDLE;

    // PBD solver pipeline
    VkDescriptorSetLayout pbd_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout pbd_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline pbd_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet pbd_set_ = VK_NULL_HANDLE;

    // Post-process pipeline
    VkDescriptorSetLayout post_process_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout post_process_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline post_process_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet post_process_set_ = VK_NULL_HANDLE;
    Buffer pp_ubo_buffer_;
    GsPostProcessParams gs_pp_params_;

    // Legacy sort (kept for fallback, not dispatched)
    VkDescriptorSetLayout sort_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout sort_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline sort_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet sort_set_ = VK_NULL_HANDLE;

    // ── Tile binning pipeline (Phase 1) ──
    VkDescriptorSetLayout tile_bin_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout tile_bin_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline tile_bin_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet tile_bin_set_ = VK_NULL_HANDLE;

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

    // Tile render pipeline (separate from render_pipeline_ — 8 bindings)
    VkDescriptorSetLayout tile_render_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout tile_render_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline tile_render_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet tile_render_set_ = VK_NULL_HANDLE;

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

    Buffer onesweep_status_;    // per-digit lookback status buffer (coherent)
    uint32_t onesweep_max_wg_ = 0;

    // Tile sort buffers
    Buffer tile_sort_a_;              // TileSortEntry ping buffer (8 bytes/entry)
    Buffer tile_sort_b_;              // TileSortEntry pong buffer
    Buffer tile_sort_count_ssbo_;     // atomic counter (single uint32)
    Buffer tile_ranges_ssbo_;         // per-tile {start, count}
    Buffer tile_indirect_args_;       // indirect dispatch args (8 × uint32)

    uint32_t tile_sort_capacity_ = 0;    // max entries in tile sort buffers
    uint32_t tile_sort_size_ = 0;        // workgroup-aligned count for radix sort
    uint32_t tile_sort_workgroups_ = 0;
    static constexpr uint32_t kTileSortPasses = 4;  // 4 passes for 32-bit key
    bool tile_binning_enabled_ = true;

    bool initialized_ = false;

    // World manifest (Phase 3 streaming)
    WorldManifest world_manifest_;

    // GPU timestamp profiling: queries 0-3 = sort_begin, sort_end, raster_begin, raster_end
    VkQueryPool timestamp_pool_ = VK_NULL_HANDLE;
    float timestamp_period_ns_ = 0.0f;   // nanoseconds per tick
    uint32_t timestamp_frame_ = 0;
    float sort_ms_accum_ = 0.0f;
    float rasterize_ms_accum_ = 0.0f;
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
