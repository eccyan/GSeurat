#pragma once

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <vector>

namespace vulkan_game {

class Swapchain;

class RenderPassManager {
public:
    void init(VkDevice device, VmaAllocator allocator, const Swapchain& swapchain);
    void shutdown(VkDevice device, VmaAllocator allocator);

    VkRenderPass render_pass() const { return render_pass_; }
    VkFramebuffer framebuffer(uint32_t index) const { return framebuffers_[index]; }

private:
    void create_depth_resources(VkDevice device, VmaAllocator allocator, VkExtent2D extent);
    void create_render_pass(VkDevice device, VkFormat color_format);
    void create_framebuffers(VkDevice device, const Swapchain& swapchain);

    VkRenderPass render_pass_ = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> framebuffers_;

    VkImage depth_image_ = VK_NULL_HANDLE;
    VmaAllocation depth_allocation_ = VK_NULL_HANDLE;
    VkImageView depth_image_view_ = VK_NULL_HANDLE;
};

}  // namespace vulkan_game
