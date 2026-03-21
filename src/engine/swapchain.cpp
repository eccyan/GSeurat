#include "gseurat/engine/swapchain.hpp"
#include "gseurat/engine/vk_context.hpp"

#include <algorithm>
#include <stdexcept>

namespace gseurat {

void Swapchain::init(const VkContext& context, uint32_t width, uint32_t height) {
    auto physical = context.physical_device();
    auto surface = context.surface();
    auto device = context.device();

    VkSurfaceCapabilitiesKHR caps;
    vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical, surface, &caps);

    uint32_t format_count = 0;
    vkGetPhysicalDeviceSurfaceFormatsKHR(physical, surface, &format_count, nullptr);
    std::vector<VkSurfaceFormatKHR> formats(format_count);
    vkGetPhysicalDeviceSurfaceFormatsKHR(physical, surface, &format_count, formats.data());

    uint32_t mode_count = 0;
    vkGetPhysicalDeviceSurfacePresentModesKHR(physical, surface, &mode_count, nullptr);
    std::vector<VkPresentModeKHR> modes(mode_count);
    vkGetPhysicalDeviceSurfacePresentModesKHR(physical, surface, &mode_count, modes.data());

    // Choose format
    VkSurfaceFormatKHR chosen_format = formats[0];
    for (const auto& fmt : formats) {
        if (fmt.format == VK_FORMAT_B8G8R8A8_SRGB &&
            fmt.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) {
            chosen_format = fmt;
            break;
        }
    }

    // Choose present mode
    VkPresentModeKHR chosen_mode = VK_PRESENT_MODE_FIFO_KHR;
    for (auto mode : modes) {
        if (mode == VK_PRESENT_MODE_MAILBOX_KHR) {
            chosen_mode = mode;
            break;
        }
    }

    // Choose extent
    if (caps.currentExtent.width != 0xFFFFFFFF) {
        extent_ = caps.currentExtent;
    } else {
        extent_.width = std::clamp(width, caps.minImageExtent.width, caps.maxImageExtent.width);
        extent_.height =
            std::clamp(height, caps.minImageExtent.height, caps.maxImageExtent.height);
    }

    uint32_t image_count = caps.minImageCount + 1;
    if (caps.maxImageCount > 0 && image_count > caps.maxImageCount) {
        image_count = caps.maxImageCount;
    }

    image_format_ = chosen_format.format;

    VkSwapchainCreateInfoKHR create_info{};
    create_info.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
    create_info.surface = surface;
    create_info.minImageCount = image_count;
    create_info.imageFormat = chosen_format.format;
    create_info.imageColorSpace = chosen_format.colorSpace;
    create_info.imageExtent = extent_;
    create_info.imageArrayLayers = 1;
    create_info.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    create_info.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    create_info.preTransform = caps.currentTransform;
    create_info.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    create_info.presentMode = chosen_mode;
    create_info.clipped = VK_TRUE;

    if (vkCreateSwapchainKHR(device, &create_info, nullptr, &swapchain_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create swapchain");
    }

    // Get images
    vkGetSwapchainImagesKHR(device, swapchain_, &image_count, nullptr);
    images_.resize(image_count);
    vkGetSwapchainImagesKHR(device, swapchain_, &image_count, images_.data());

    // Create image views
    image_views_.resize(image_count);
    for (uint32_t i = 0; i < image_count; i++) {
        VkImageViewCreateInfo view_info{};
        view_info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        view_info.image = images_[i];
        view_info.viewType = VK_IMAGE_VIEW_TYPE_2D;
        view_info.format = image_format_;
        view_info.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        view_info.subresourceRange.levelCount = 1;
        view_info.subresourceRange.layerCount = 1;

        if (vkCreateImageView(device, &view_info, nullptr, &image_views_[i]) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create swapchain image view");
        }
    }
}

void Swapchain::shutdown(VkDevice device) {
    for (auto view : image_views_) {
        vkDestroyImageView(device, view, nullptr);
    }
    vkDestroySwapchainKHR(device, swapchain_, nullptr);
}

}  // namespace gseurat
