#pragma once

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/texture.hpp"

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <cstdint>
#include <deque>
#include <functional>
#include <string>
#include <vector>

namespace gseurat {

// Describes a texture ready for GPU upload (pixels already loaded on CPU).
struct StagedTexture {
    std::string cache_key;
    std::vector<uint8_t> pixels;   // RGBA
    uint32_t width = 0;
    uint32_t height = 0;
    VkFilter filter = VK_FILTER_NEAREST;
    VkSamplerAddressMode address_mode = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    VkFormat format = VK_FORMAT_R8G8B8A8_SRGB;

    VkDeviceSize byte_size() const {
        return static_cast<VkDeviceSize>(width) * height * 4;
    }
};

// Callback invoked when a staged texture finishes GPU upload.
using TextureReadyCallback = std::function<void(const std::string& cache_key, Texture texture)>;

// Budget-limited per-frame GPU texture uploader.
//
// Usage:
//   1. enqueue_texture() to queue CPU-side pixel data for GPU upload
//   2. flush() once per frame to process a budget-limited batch
//   3. Completed textures are delivered via the callback
//
// Internally uses double-buffered staging: one staging buffer may be
// in-flight (waiting on a GPU fence) while the other is being filled.
class StagingUploader {
public:
    void init(VkDevice device, VmaAllocator allocator,
              VkCommandPool cmd_pool, VkQueue queue,
              TextureReadyCallback callback);
    void shutdown();

    // Queue a texture for GPU upload. The pixels are moved into the queue.
    void enqueue_texture(StagedTexture tex);

    // Process up to budget_bytes of pending uploads this frame.
    // Creates VkImages, copies via staging buffer, transitions layout.
    // Returns number of textures uploaded this frame.
    uint32_t flush(VkDeviceSize budget_bytes = 4 * 1024 * 1024);

    // Number of pending textures awaiting upload.
    uint32_t pending_count() const { return static_cast<uint32_t>(pending_.size()); }

    // Total bytes pending upload.
    VkDeviceSize pending_bytes() const;

    // Check if there are any in-flight uploads from the previous flush.
    bool has_in_flight() const { return in_flight_count_ > 0; }

private:
    // Complete in-flight uploads from previous flush (check fence).
    void retire_in_flight();

    // Create a one-shot command buffer, begin recording.
    VkCommandBuffer begin_one_shot();

    // End recording and submit with the given fence.
    void end_and_submit(VkCommandBuffer cmd, VkFence fence);

    VkDevice device_ = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;
    VkCommandPool cmd_pool_ = VK_NULL_HANDLE;
    VkQueue queue_ = VK_NULL_HANDLE;
    TextureReadyCallback callback_;

    std::deque<StagedTexture> pending_;

    // Double-buffered: staging resources alternate between slots 0 and 1.
    static constexpr uint32_t kSlots = 2;
    uint32_t current_slot_ = 0;

    VkFence fences_[kSlots] = {};
    VkCommandBuffer cmds_[kSlots] = {};

    // Textures whose GPU upload is in-flight (waiting on fence from previous flush).
    struct InFlightTexture {
        std::string cache_key;
        Texture texture;
        Buffer staging_buffer;
    };
    std::vector<InFlightTexture> in_flight_textures_[kSlots];
    uint32_t in_flight_count_ = 0;
};

}  // namespace gseurat
