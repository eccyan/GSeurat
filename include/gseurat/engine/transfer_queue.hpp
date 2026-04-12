#pragma once

#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <vector>
#include <vulkan/vulkan.h>
#include <vk_mem_alloc.h>
#include "gseurat/engine/buffer.hpp"

namespace gseurat {

struct TransferChunk {
    uint64_t staging_offset;
    uint64_t dest_offset;
    uint64_t size;
    std::function<void()> on_complete;
    bool is_completion_marker{false};
};

class TransferQueue {
public:
    TransferQueue(VkDevice device, VmaAllocator allocator,
                  VkQueue transfer_queue, uint32_t transfer_family,
                  bool dedicated, uint64_t staging_size,
                  uint32_t transfer_budget_mb,
                  VkBuffer dest_buffer);

    ~TransferQueue();

    // Not copyable or movable — owns Vulkan handles
    TransferQueue(const TransferQueue&) = delete;
    TransferQueue& operator=(const TransferQueue&) = delete;
    TransferQueue(TransferQueue&&) = delete;
    TransferQueue& operator=(TransferQueue&&) = delete;

    // Enqueue a copy from staging_offset -> dest_offset of the given size.
    // on_complete is called once the GPU copy has finished.
    void enqueue(uint64_t staging_offset, uint64_t dest_offset,
                 uint64_t size, std::function<void()> on_complete = nullptr);

    // Enqueue a callback with no associated copy (fires after all preceding copies finish).
    void enqueue_completion(std::function<void()> on_complete);

    // Called once per frame. Checks for completed transfers and fires callbacks.
    // frame_cmd is used on the fallback (graphics-queue) path only.
    void poll_completions(VkCommandBuffer frame_cmd);

    void* staging_mapped() const { return staging_buffer_.mapped(); }
    uint64_t staging_size() const { return staging_size_; }
    bool is_dedicated() const { return dedicated_; }

    void shutdown();

private:
    VkDevice device_;
    VmaAllocator allocator_;
    VkQueue transfer_queue_;
    uint32_t transfer_family_;
    bool dedicated_;
    uint64_t staging_size_;
    uint64_t transfer_budget_bytes_;
    VkBuffer dest_buffer_;  // not owned — reference to main Gaussian SSBO

    Buffer staging_buffer_;

    // Dedicated transfer path
    VkCommandPool transfer_cmd_pool_{VK_NULL_HANDLE};
    VkCommandBuffer transfer_cmd_{VK_NULL_HANDLE};
    VkFence transfer_fence_{VK_NULL_HANDLE};
    bool transfer_in_flight_{false};

    // Pending transfer queue (thread-safe)
    std::mutex queue_mutex_;
    std::deque<TransferChunk> pending_chunks_;

    struct InFlightBatch {
        VkFence fence;
        std::vector<std::function<void()>> callbacks;
    };
    std::deque<InFlightBatch> in_flight_;
};

}  // namespace gseurat
