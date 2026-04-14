#pragma once

#include "gseurat/engine/vk_context.hpp"
#include "gseurat/engine/buffer.hpp"

#include <vector>

namespace gseurat {

class GpuTestContext {
public:
    void init();
    void shutdown();

    VkContext& context() { return ctx_; }
    VmaAllocator allocator() { return ctx_.allocator(); }
    VkDevice device() { return ctx_.device(); }
    uint32_t queue_family() { return ctx_.graphics_queue_family(); }

    // Begin recording commands (resets command buffer)
    VkCommandBuffer begin_commands();

    // End recording, submit to compute queue, wait until complete
    void submit_and_wait();

    // Upload CPU data to a GPU-only storage buffer via staging + copy command.
    // Caller must call begin_commands() before, submit_and_wait() after.
    Buffer upload_to_gpu(VkCommandBuffer cmd, const void* data, VkDeviceSize size);

    // Copy GPU buffer contents to a CPU-readable readback buffer.
    // Caller must call begin_commands() before, submit_and_wait() after.
    Buffer readback_from_gpu(VkCommandBuffer cmd, const Buffer& gpu_buf, VkDeviceSize size);

private:
    VkContext ctx_;
    VkCommandPool cmd_pool_ = VK_NULL_HANDLE;
    VkCommandBuffer cmd_ = VK_NULL_HANDLE;
    VkFence fence_ = VK_NULL_HANDLE;

    // Staging buffers kept alive until submit_and_wait completes
    std::vector<Buffer> temp_buffers_;
};

}  // namespace gseurat
