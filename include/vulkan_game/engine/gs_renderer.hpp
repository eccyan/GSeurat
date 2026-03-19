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
    void render(VkCommandBuffer cmd, const glm::mat4& view, const glm::mat4& proj,
                uint32_t width, uint32_t height);
    VkImageView output_view() const { return output_view_; }
    VkSampler output_sampler() const { return output_sampler_; }
    bool has_cloud() const { return gaussian_count_ > 0; }
    uint32_t gaussian_count() const { return gaussian_count_; }
    void shutdown(VmaAllocator allocator);

private:
    void create_output_image(uint32_t width, uint32_t height);
    void create_compute_pipelines();
    void create_descriptor_resources();
    void update_descriptors();

    VkDevice device_ = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;

    // Output storage image (320x240 R16G16B16A16_SFLOAT)
    VkImage output_image_ = VK_NULL_HANDLE;
    VmaAllocation output_allocation_ = VK_NULL_HANDLE;
    VkImageView output_view_ = VK_NULL_HANDLE;
    VkSampler output_sampler_ = VK_NULL_HANDLE;
    uint32_t output_width_ = 0;
    uint32_t output_height_ = 0;

    // GPU buffers
    Buffer gaussian_ssbo_;           // Input Gaussians
    Buffer projected_ssbo_;          // Projected 2D splats
    Buffer sort_keys_ssbo_;          // Sort keys (depth | index)
    Buffer sort_indices_ssbo_;       // Sort value (original index)
    Buffer uniform_buffer_;          // Camera + resolution
    Buffer tile_count_ssbo_;         // Per-tile Gaussian counts
    uint32_t gaussian_count_ = 0;

    // Descriptor resources
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorPool gs_pool_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout preprocess_layout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout sort_layout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout render_layout_ = VK_NULL_HANDLE;
    VkDescriptorSet preprocess_set_ = VK_NULL_HANDLE;
    VkDescriptorSet sort_set_ = VK_NULL_HANDLE;
    VkDescriptorSet render_set_ = VK_NULL_HANDLE;

    // Compute pipelines
    VkPipelineLayout preprocess_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout sort_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout render_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline preprocess_pipeline_ = VK_NULL_HANDLE;
    VkPipeline sort_pipeline_ = VK_NULL_HANDLE;
    VkPipeline render_pipeline_ = VK_NULL_HANDLE;

    bool initialized_ = false;
};

}  // namespace vulkan_game
