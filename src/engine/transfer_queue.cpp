#include "gseurat/engine/transfer_queue.hpp"

#include <stdexcept>

namespace gseurat {

TransferQueue::TransferQueue(VkDevice device, VmaAllocator allocator,
                             VkQueue transfer_queue, uint32_t transfer_family,
                             bool dedicated, uint64_t staging_size,
                             uint32_t transfer_budget_mb,
                             VkBuffer dest_buffer)
    : device_(device),
      allocator_(allocator),
      transfer_queue_(transfer_queue),
      transfer_family_(transfer_family),
      dedicated_(dedicated),
      staging_size_(staging_size),
      transfer_budget_bytes_(static_cast<uint64_t>(transfer_budget_mb) * 1024u * 1024u),
      dest_buffer_(dest_buffer) {
    staging_buffer_ = Buffer::create_staging(allocator_, staging_size_);

    if (dedicated_) {
        VkCommandPoolCreateInfo pool_info{};
        pool_info.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
        pool_info.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        pool_info.queueFamilyIndex = transfer_family_;
        if (vkCreateCommandPool(device_, &pool_info, nullptr, &transfer_cmd_pool_) != VK_SUCCESS) {
            throw std::runtime_error("TransferQueue: failed to create transfer command pool");
        }

        VkCommandBufferAllocateInfo alloc_info{};
        alloc_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        alloc_info.commandPool = transfer_cmd_pool_;
        alloc_info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        alloc_info.commandBufferCount = 1;
        if (vkAllocateCommandBuffers(device_, &alloc_info, &transfer_cmd_) != VK_SUCCESS) {
            throw std::runtime_error("TransferQueue: failed to allocate transfer command buffer");
        }

        VkFenceCreateInfo fence_info{};
        fence_info.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
        // Do not pre-signal — we check transfer_in_flight_ before polling
        if (vkCreateFence(device_, &fence_info, nullptr, &transfer_fence_) != VK_SUCCESS) {
            throw std::runtime_error("TransferQueue: failed to create transfer fence");
        }
    }
}

TransferQueue::~TransferQueue() {
    shutdown();
}

void TransferQueue::enqueue(uint64_t staging_offset, uint64_t dest_offset,
                            uint64_t size, std::function<void()> on_complete) {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    pending_chunks_.push_back({staging_offset, dest_offset, size, std::move(on_complete), false});
}

void TransferQueue::enqueue_completion(std::function<void()> on_complete) {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    TransferChunk marker{};
    marker.on_complete = std::move(on_complete);
    marker.is_completion_marker = true;
    pending_chunks_.push_back(std::move(marker));
}

void TransferQueue::poll_completions(VkCommandBuffer frame_cmd) {
    if (dedicated_) {
        // --- Dedicated transfer queue path ---

        // 1. Check if current in-flight batch has finished
        if (transfer_in_flight_) {
            VkResult status = vkGetFenceStatus(device_, transfer_fence_);
            if (status == VK_SUCCESS) {
                vkResetFences(device_, 1, &transfer_fence_);
                // Fire all callbacks from the completed batch
                if (!in_flight_.empty()) {
                    for (auto& cb : in_flight_.front().callbacks) {
                        if (cb) cb();
                    }
                    in_flight_.pop_front();
                }
                transfer_in_flight_ = false;
            }
            // If still pending, do not submit a new batch this frame
            if (transfer_in_flight_) return;
        }

        // 2. Drain pending_chunks_ and record a new batch
        std::deque<TransferChunk> local_chunks;
        {
            std::lock_guard<std::mutex> lock(queue_mutex_);
            local_chunks.swap(pending_chunks_);
        }
        if (local_chunks.empty()) return;

        InFlightBatch batch;
        batch.fence = transfer_fence_;

        vkResetCommandBuffer(transfer_cmd_, 0);
        VkCommandBufferBeginInfo begin_info{};
        begin_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        begin_info.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        vkBeginCommandBuffer(transfer_cmd_, &begin_info);

        for (auto& chunk : local_chunks) {
            if (chunk.is_completion_marker) {
                if (chunk.on_complete) batch.callbacks.push_back(chunk.on_complete);
                continue;
            }
            VkBufferCopy region{};
            region.srcOffset = chunk.staging_offset;
            region.dstOffset = chunk.dest_offset;
            region.size = chunk.size;
            vkCmdCopyBuffer(transfer_cmd_, staging_buffer_.buffer(), dest_buffer_, 1, &region);
            if (chunk.on_complete) batch.callbacks.push_back(chunk.on_complete);
        }

        vkEndCommandBuffer(transfer_cmd_);

        VkSubmitInfo submit_info{};
        submit_info.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        submit_info.commandBufferCount = 1;
        submit_info.pCommandBuffers = &transfer_cmd_;
        vkQueueSubmit(transfer_queue_, 1, &submit_info, transfer_fence_);

        in_flight_.push_back(std::move(batch));
        transfer_in_flight_ = true;

    } else {
        // --- Fallback graphics-queue path ---

        // 1. Fire any completed in-flight fences (FIFO)
        while (!in_flight_.empty()) {
            auto& front = in_flight_.front();
            if (vkGetFenceStatus(device_, front.fence) == VK_SUCCESS) {
                vkDestroyFence(device_, front.fence, nullptr);
                for (auto& cb : front.callbacks) {
                    if (cb) cb();
                }
                in_flight_.pop_front();
            } else {
                break;
            }
        }

        // 2. Drain up to transfer_budget_bytes_ into frame_cmd
        std::deque<TransferChunk> local_chunks;
        {
            std::lock_guard<std::mutex> lock(queue_mutex_);
            local_chunks.swap(pending_chunks_);
        }
        if (local_chunks.empty()) return;

        uint64_t bytes_this_frame = 0;
        std::deque<TransferChunk> deferred;

        for (auto& chunk : local_chunks) {
            if (chunk.is_completion_marker) {
                // Fire completion markers inline after copies already recorded
                if (chunk.on_complete) chunk.on_complete();
                continue;
            }
            if (bytes_this_frame + chunk.size > transfer_budget_bytes_) {
                deferred.push_back(std::move(chunk));
                continue;
            }
            VkBufferCopy region{};
            region.srcOffset = chunk.staging_offset;
            region.dstOffset = chunk.dest_offset;
            region.size = chunk.size;
            vkCmdCopyBuffer(frame_cmd, staging_buffer_.buffer(), dest_buffer_, 1, &region);
            bytes_this_frame += chunk.size;
            // Callbacks fire immediately for the graphics-queue path — the copy
            // executes before the queue submission that contains frame_cmd.
            if (chunk.on_complete) chunk.on_complete();
        }

        // Re-queue anything that didn't fit this frame
        if (!deferred.empty()) {
            std::lock_guard<std::mutex> lock(queue_mutex_);
            for (auto& chunk : deferred) {
                pending_chunks_.push_front(std::move(chunk));
            }
        }
    }
}

void TransferQueue::shutdown() {
    if (device_ == VK_NULL_HANDLE) return;

    vkDeviceWaitIdle(device_);

    // Fire any remaining callbacks before destroying resources
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        for (auto& chunk : pending_chunks_) {
            if (chunk.on_complete) chunk.on_complete();
        }
        pending_chunks_.clear();
    }
    for (auto& batch : in_flight_) {
        for (auto& cb : batch.callbacks) {
            if (cb) cb();
        }
        // Destroy per-batch fences from the fallback path
        if (!dedicated_ && batch.fence != VK_NULL_HANDLE) {
            vkDestroyFence(device_, batch.fence, nullptr);
        }
    }
    in_flight_.clear();

    if (staging_buffer_.buffer() != VK_NULL_HANDLE) {
        staging_buffer_.destroy(allocator_);
    }

    if (transfer_cmd_pool_ != VK_NULL_HANDLE) {
        vkDestroyCommandPool(device_, transfer_cmd_pool_, nullptr);
        transfer_cmd_pool_ = VK_NULL_HANDLE;
        transfer_cmd_ = VK_NULL_HANDLE;
    }

    if (transfer_fence_ != VK_NULL_HANDLE) {
        vkDestroyFence(device_, transfer_fence_, nullptr);
        transfer_fence_ = VK_NULL_HANDLE;
    }

    transfer_in_flight_ = false;
    device_ = VK_NULL_HANDLE;
}

}  // namespace gseurat
