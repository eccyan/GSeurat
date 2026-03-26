#pragma once

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/types.hpp"

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>
#include <glm/glm.hpp>
#include <vector>

namespace gseurat {

class GsRenderer {
public:
    void init(VkDevice device, VmaAllocator allocator, VkDescriptorPool pool);
    void load_cloud(const GaussianCloud& cloud);
    void update_active_gaussians(const Gaussian* data, uint32_t count);
    void update_gaussian_data(const Gaussian* data, uint32_t count);
    void resize_output(uint32_t width, uint32_t height);
    void render(VkCommandBuffer cmd, const glm::mat4& view, const glm::mat4& proj);
    VkImageView output_view() const { return output_view_; }
    VkSampler output_sampler() const { return output_sampler_; }
    static constexpr uint32_t kParticleHeadroom = 2048;

    bool has_cloud() const { return gaussian_count_ > 0; }
    uint32_t gaussian_count() const { return gaussian_count_; }
    uint32_t max_gaussian_count() const { return max_gaussian_count_; }
    uint32_t output_width() const { return output_width_; }
    uint32_t output_height() const { return output_height_; }
    uint32_t visible_count() const {
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
    void set_light_mode(int mode) { light_mode_ = mode; }
    int light_mode() const { return light_mode_; }
    void set_light_dir(const glm::vec3& d) { light_dir_ = d; }
    void set_light_intensity(float i) { light_intensity_ = i; }
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

    void shutdown(VmaAllocator allocator);

private:
    void create_output_image(uint32_t width, uint32_t height);
    void create_compute_pipelines();
    void create_descriptor_resources();
    void update_descriptors();

    VkDevice device_ = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;

    // Output storage image
    VkImage output_image_ = VK_NULL_HANDLE;
    VmaAllocation output_allocation_ = VK_NULL_HANDLE;
    VkImageView output_view_ = VK_NULL_HANDLE;
    VkSampler output_sampler_ = VK_NULL_HANDLE;
    uint32_t output_width_ = 0;
    uint32_t output_height_ = 0;

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

    // Legacy sort (kept for fallback, not dispatched)
    VkDescriptorSetLayout sort_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout sort_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline sort_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet sort_set_ = VK_NULL_HANDLE;

    bool initialized_ = false;

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
