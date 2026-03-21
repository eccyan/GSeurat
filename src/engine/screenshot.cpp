#include "vulkan_game/engine/screenshot.hpp"

#include <vector>

#include <stb_image_write.h>

namespace vulkan_game {

void swizzle_bgra_to_rgba(const uint8_t* src, uint8_t* dst, uint32_t pixel_count) {
    for (uint32_t i = 0; i < pixel_count; ++i) {
        dst[i * 4 + 0] = src[i * 4 + 2]; // B → R
        dst[i * 4 + 1] = src[i * 4 + 1]; // G → G
        dst[i * 4 + 2] = src[i * 4 + 0]; // R → B
        dst[i * 4 + 3] = 255;             // A = opaque
    }
}

void ScreenshotCapture::request(const std::string& path) {
    path_ = path;
    write_ok_ = false;
}

bool ScreenshotCapture::has_pending() const {
    return !path_.empty();
}

void ScreenshotCapture::record_copy(VkCommandBuffer cmd, VkImage src_image,
                                     VkExtent2D extent, VmaAllocator allocator) {
    // Lazy-init readback buffer
    if (!buffer_initialized_) {
        VkDeviceSize buf_size = static_cast<VkDeviceSize>(extent.width) *
                                extent.height * 4;
        staging_buffer_ = Buffer::create_readback(allocator, buf_size);
        buffer_initialized_ = true;
    }

    // Barrier: PRESENT_SRC → TRANSFER_SRC
    VkImageMemoryBarrier to_transfer{};
    to_transfer.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    to_transfer.srcAccessMask = VK_ACCESS_MEMORY_READ_BIT;
    to_transfer.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    to_transfer.oldLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    to_transfer.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    to_transfer.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    to_transfer.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    to_transfer.image = src_image;
    to_transfer.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
        VK_PIPELINE_STAGE_TRANSFER_BIT,
        0, 0, nullptr, 0, nullptr, 1, &to_transfer);

    // Copy image to buffer
    VkBufferImageCopy region{};
    region.bufferOffset = 0;
    region.bufferRowLength = 0;
    region.bufferImageHeight = 0;
    region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    region.imageOffset = {0, 0, 0};
    region.imageExtent = {extent.width, extent.height, 1};

    vkCmdCopyImageToBuffer(cmd, src_image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                           staging_buffer_.buffer(), 1, &region);

    // Barrier: TRANSFER_SRC → PRESENT_SRC
    VkImageMemoryBarrier to_present{};
    to_present.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    to_present.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    to_present.dstAccessMask = VK_ACCESS_MEMORY_READ_BIT;
    to_present.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    to_present.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    to_present.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    to_present.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    to_present.image = src_image;
    to_present.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT,
        0, 0, nullptr, 0, nullptr, 1, &to_present);
}

void ScreenshotCapture::readback_and_write(VmaAllocator allocator, VkExtent2D extent) {
    vmaInvalidateAllocation(allocator, staging_buffer_.allocation(), 0, VK_WHOLE_SIZE);

    uint32_t w = extent.width;
    uint32_t h = extent.height;
    auto* src = static_cast<const uint8_t*>(staging_buffer_.mapped());

    std::vector<uint8_t> rgba(w * h * 4);
    swizzle_bgra_to_rgba(src, rgba.data(), w * h);

    write_ok_ = stbi_write_png(path_.c_str(),
                                static_cast<int>(w), static_cast<int>(h),
                                4, rgba.data(), static_cast<int>(w * 4)) != 0;
    width_ = w;
    height_ = h;
    path_.clear();
}

bool ScreenshotCapture::write_ok() const { return write_ok_; }
uint32_t ScreenshotCapture::width() const { return width_; }
uint32_t ScreenshotCapture::height() const { return height_; }

void ScreenshotCapture::shutdown(VmaAllocator allocator) {
    if (buffer_initialized_) {
        staging_buffer_.destroy(allocator);
        buffer_initialized_ = false;
    }
}

}  // namespace vulkan_game
