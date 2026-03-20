#pragma once

#include "vulkan_game/engine/buffer.hpp"
#include "vulkan_game/engine/gaussian_cloud.hpp"

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>
#include <glm/glm.hpp>

namespace vulkan_game {

class GsRenderer {
public:
    void init(VkDevice device, VmaAllocator allocator, VkDescriptorPool pool);
    void load_cloud(const GaussianCloud& cloud);
    void update_active_gaussians(const Gaussian* data, uint32_t count);
    void resize_output(uint32_t width, uint32_t height);
    void render(VkCommandBuffer cmd, const glm::mat4& view, const glm::mat4& proj);
    VkImageView output_view() const { return output_view_; }
    VkSampler output_sampler() const { return output_sampler_; }
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
};

}  // namespace vulkan_game
