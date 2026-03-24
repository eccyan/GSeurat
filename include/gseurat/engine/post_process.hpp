#pragma once

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <vector>

#include "gseurat/engine/types.hpp"

namespace gseurat {

class Swapchain;

struct PostProcessParams {
    float bloom_threshold = 1.0f;
    float bloom_soft_knee = 0.5f;
    float bloom_intensity = 0.35f;
    float exposure = 1.2f;
    float vignette_radius = 0.75f;
    float vignette_softness = 0.45f;
    float dof_focus_distance = 12.0f;
    float dof_focus_range = 3.0f;
    float dof_max_blur = 1.0f;
    float dof_near_plane = 0.1f;
    float dof_far_plane = 100.0f;
    float fog_density = 0.0f;
    float god_rays_intensity = 0.0f;  // 0 = off, 0.5-2.0 = typical range
    float fog_color_r = 0.3f;
    float fog_color_g = 0.35f;
    float fog_color_b = 0.45f;
    float fade_amount = 0.0f;
    float ca_intensity = 0.0f;
    float flash_r = 0.0f;
    float flash_g = 0.0f;
    float flash_b = 0.0f;
};

class PostProcessPipeline {
public:
    void init(VkDevice device, VmaAllocator allocator, const Swapchain& swapchain);
    void shutdown(VkDevice device, VmaAllocator allocator);

    VkRenderPass scene_render_pass() const { return scene_render_pass_; }
    VkFramebuffer scene_framebuffer() const { return scene_framebuffer_; }
    VkRenderPass composite_render_pass() const { return composite_render_pass_; }
    VkFramebuffer composite_framebuffer(uint32_t swapchain_index) const {
        return composite_framebuffers_[swapchain_index];
    }

    // Records bloom extract + H-blur + V-blur, then begins composite render pass.
    // Caller draws UI sprites into the open composite pass, then ends it.
    void record_post_process(VkCommandBuffer cmd, uint32_t swapchain_index,
                             const PostProcessParams& params);

    // Update light glow UBO for screen-space light rendering in composite
    void update_light_glow(VmaAllocator allocator, const LightGlowData& data);


private:
    struct ImageResource {
        VkImage image = VK_NULL_HANDLE;
        VmaAllocation allocation = VK_NULL_HANDLE;
        VkImageView view = VK_NULL_HANDLE;
    };

    void create_images(VkDevice device, VmaAllocator allocator, VkExtent2D scene_extent);
    void create_sampler(VkDevice device);
    void create_render_passes(VkDevice device, VkFormat swapchain_format);
    void create_framebuffers(VkDevice device, const Swapchain& swapchain);
    void create_descriptor_resources(VkDevice device);
    void create_pipelines(VkDevice device);

    ImageResource create_color_image(VkDevice device, VmaAllocator allocator,
                                     VkFormat format, uint32_t width, uint32_t height,
                                     VkImageUsageFlags usage);
    void destroy_image(VkDevice device, VmaAllocator allocator, ImageResource& img);

    VkDevice device_ = VK_NULL_HANDLE;

    // Scene render targets
    ImageResource offscreen_color_{};
    ImageResource offscreen_depth_{};

    // Bloom ping-pong buffers (quarter resolution)
    ImageResource bloom_a_{};
    ImageResource bloom_b_{};

    // DoF half-res ping-pong buffers
    ImageResource dof_a_{};
    ImageResource dof_b_{};

    VkSampler linear_sampler_ = VK_NULL_HANDLE;
    VkSampler nearest_sampler_ = VK_NULL_HANDLE;

    // Render passes
    VkRenderPass scene_render_pass_ = VK_NULL_HANDLE;
    VkRenderPass bloom_render_pass_ = VK_NULL_HANDLE;
    VkRenderPass composite_render_pass_ = VK_NULL_HANDLE;

    // Framebuffers
    VkFramebuffer scene_framebuffer_ = VK_NULL_HANDLE;
    VkFramebuffer bloom_a_framebuffer_ = VK_NULL_HANDLE;
    VkFramebuffer bloom_b_framebuffer_ = VK_NULL_HANDLE;
    VkFramebuffer dof_a_framebuffer_ = VK_NULL_HANDLE;
    VkFramebuffer dof_b_framebuffer_ = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> composite_framebuffers_;

    // Descriptor resources
    VkDescriptorPool pp_pool_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout pp_layout_ = VK_NULL_HANDLE;       // 1 sampler
    VkDescriptorSetLayout composite_layout_ = VK_NULL_HANDLE; // 4 samplers
    VkDescriptorSet ds_offscreen_ = VK_NULL_HANDLE;   // reads offscreen color
    VkDescriptorSet ds_bloom_a_ = VK_NULL_HANDLE;     // reads bloom_a
    VkDescriptorSet ds_bloom_b_ = VK_NULL_HANDLE;     // reads bloom_b
    VkDescriptorSet ds_dof_a_ = VK_NULL_HANDLE;       // reads dof_a
    VkDescriptorSet ds_composite_ = VK_NULL_HANDLE;   // reads offscreen + bloom + dof + depth

    // Pipeline resources
    VkPipelineLayout bloom_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout composite_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline bloom_extract_pipeline_ = VK_NULL_HANDLE;
    VkPipeline bloom_blur_pipeline_ = VK_NULL_HANDLE;
    VkPipeline dof_blur_pipeline_ = VK_NULL_HANDLE;
    VkPipeline composite_pipeline_ = VK_NULL_HANDLE;

    uint32_t scene_width_ = 0;
    uint32_t scene_height_ = 0;
    uint32_t bloom_width_ = 0;
    uint32_t bloom_height_ = 0;
    uint32_t dof_width_ = 0;
    uint32_t dof_height_ = 0;

    // Light glow UBO for composite pass
    VkBuffer light_glow_buffer_ = VK_NULL_HANDLE;
    VmaAllocation light_glow_alloc_ = VK_NULL_HANDLE;
};

}  // namespace gseurat
