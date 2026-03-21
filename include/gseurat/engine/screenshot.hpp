#pragma once

#include "gseurat/engine/buffer.hpp"

#include <cstdint>
#include <string>

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

namespace gseurat {

// BGRA→RGBA pixel swizzle with alpha forced to 255.
// src and dst may not overlap. pixel_count is the number of 4-byte pixels.
void swizzle_bgra_to_rgba(const uint8_t* src, uint8_t* dst, uint32_t pixel_count);

class ScreenshotCapture {
public:
    void request(const std::string& path);
    bool has_pending() const;

    // Records image-to-buffer copy commands (call before vkEndCommandBuffer).
    void record_copy(VkCommandBuffer cmd, VkImage src_image, VkExtent2D extent,
                     VmaAllocator allocator);

    // After GPU fence completes, reads back pixels and writes PNG.
    void readback_and_write(VmaAllocator allocator, VkExtent2D extent);

    bool write_ok() const;
    uint32_t width() const;
    uint32_t height() const;

    void shutdown(VmaAllocator allocator);

private:
    std::string path_;
    Buffer staging_buffer_;
    bool buffer_initialized_ = false;
    bool write_ok_ = false;
    uint32_t width_ = 0;
    uint32_t height_ = 0;
};

}  // namespace gseurat
