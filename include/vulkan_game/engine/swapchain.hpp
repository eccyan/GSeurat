#pragma once

#include <vulkan/vulkan.h>

#include <vector>

namespace vulkan_game {

class VkContext;

class Swapchain {
public:
    void init(const VkContext& context, uint32_t width, uint32_t height);
    void shutdown(VkDevice device);

    VkSwapchainKHR swapchain() const { return swapchain_; }
    VkFormat image_format() const { return image_format_; }
    VkExtent2D extent() const { return extent_; }
    const std::vector<VkImageView>& image_views() const { return image_views_; }
    uint32_t image_count() const { return static_cast<uint32_t>(image_views_.size()); }
    VkImage image(uint32_t index) const { return images_[index]; }

private:
    VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
    VkFormat image_format_ = VK_FORMAT_UNDEFINED;
    VkExtent2D extent_{};
    std::vector<VkImage> images_;
    std::vector<VkImageView> image_views_;
};

}  // namespace vulkan_game
