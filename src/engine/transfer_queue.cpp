#include "gseurat/engine/transfer_queue.hpp"

#include <algorithm>
#include <cassert>
#include <cstdio>
#include <stdexcept>

namespace gseurat {

namespace {
inline std::uint64_t physical_offset(std::uint64_t logical, std::uint64_t capacity) {
    return logical % capacity;
}
}  // namespace

TransferQueue::TransferQueue(VkDevice device, VmaAllocator allocator,
                             VkQueue transfer_queue, std::uint32_t transfer_family,
                             bool dedicated, std::uint64_t staging_size,
                             std::uint32_t transfer_budget_mb)
    : device_(device),
      allocator_(allocator),
      transfer_queue_(transfer_queue),
      transfer_family_(transfer_family),
      dedicated_(dedicated),
      staging_size_(staging_size),
      transfer_budget_bytes_(static_cast<std::uint64_t>(transfer_budget_mb) * 1024u * 1024u) {
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
        // Not pre-signaled — `transfer_in_flight_` gates polling.
        if (vkCreateFence(device_, &fence_info, nullptr, &transfer_fence_) != VK_SUCCESS) {
            throw std::runtime_error("TransferQueue: failed to create transfer fence");
        }
    }
}

TransferQueue::~TransferQueue() {
    shutdown();
}

TransferQueue::Handle TransferQueue::make_handle() {
    Handle h{ next_handle_id_++ };
    pending_status_[h.id] = Status::Pending;
    return h;
}

std::optional<TransferQueue::Reservation>
TransferQueue::reserve_staging(std::uint64_t bytes) {
    if (bytes == 0 || bytes > staging_size_) {
        return std::nullopt;
    }

    std::lock_guard<std::mutex> lock(queue_mutex_);

    // Determine the candidate write offset. If the request would straddle the
    // ring boundary (physical offset + bytes > capacity), pad to the next
    // wrap to keep each reservation contiguous.
    std::uint64_t candidate = ring_write_;
    const std::uint64_t phys = physical_offset(candidate, staging_size_);
    if (phys + bytes > staging_size_) {
        candidate += (staging_size_ - phys);   // skip the tail
    }

    // Refuse if the new high-water mark would lap the read watermark.
    if (candidate + bytes - ring_read_ > staging_size_) {
        return std::nullopt;
    }

    Reservation res{};
    res.host_ptr       = static_cast<std::byte*>(staging_buffer_.mapped())
                       + physical_offset(candidate, staging_size_);
    res.staging_offset = physical_offset(candidate, staging_size_);
    res.size           = bytes;
    res.logical_end    = candidate + bytes;
    res.token          = next_token_++;

    ring_write_ = candidate + bytes;
    return res;
}

TransferQueue::Handle
TransferQueue::submit(const Reservation& reservation,
                      VkBuffer dest_buffer, std::uint64_t dest_offset,
                      std::function<void()> on_complete) {
    if (!reservation || dest_buffer == VK_NULL_HANDLE) {
        return Handle{};
    }

    std::lock_guard<std::mutex> lock(queue_mutex_);

    Handle h{ next_handle_id_++ };
    pending_status_[h.id] = Status::Pending;

    PendingChunk chunk{};
    chunk.handle         = h;
    chunk.dest_buffer    = dest_buffer;
    chunk.dest_offset    = dest_offset;
    chunk.staging_offset = reservation.staging_offset;
    chunk.size           = reservation.size;
    chunk.logical_end    = reservation.logical_end;
    chunk.on_complete    = std::move(on_complete);
    pending_chunks_.push_back(std::move(chunk));
    return h;
}

void TransferQueue::enqueue_completion(std::function<void()> on_complete) {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    PendingChunk marker{};
    marker.is_completion_marker = true;
    marker.on_complete = std::move(on_complete);
    pending_chunks_.push_back(std::move(marker));
}

TransferQueue::Status TransferQueue::status(Handle h) const {
    if (!h) return Status::Unknown;

    std::lock_guard<std::mutex> lock(queue_mutex_);
    if (auto it = pending_status_.find(h.id); it != pending_status_.end()) {
        return it->second;
    }
    if (auto it = recent_status_.find(h.id); it != recent_status_.end()) {
        return it->second;
    }
    return Status::Unknown;
}

void TransferQueue::retire_batch(InFlightBatch& batch, VkCommandBuffer frame_cmd) {
    // Move handle status: Pending/InFlight -> Complete (kept briefly).
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        for (Handle h : batch.handles) {
            pending_status_.erase(h.id);
            recent_status_[h.id] = Status::Complete;
            recent_complete_order_.push_back(h.id);
            while (recent_complete_order_.size() > kRecentStatusCap) {
                std::uint64_t old = recent_complete_order_.front();
                recent_complete_order_.pop_front();
                recent_status_.erase(old);
            }
        }
        ring_read_ = std::max(ring_read_, batch.max_logical_end);
    }

    (void)frame_cmd;  // unused in single-family path; cross-queue barriers
                      // arrive in a follow-up commit.

    for (auto& cb : batch.callbacks) {
        if (cb) cb();
    }
}

void TransferQueue::poll_completions(VkCommandBuffer frame_cmd) {
    if (dedicated_) {
        // ── Dedicated transfer queue path ──

        // 1. Retire the in-flight batch (if any) when its fence signals.
        if (transfer_in_flight_) {
            VkResult fs = vkGetFenceStatus(device_, transfer_fence_);
            if (fs == VK_SUCCESS) {
                vkResetFences(device_, 1, &transfer_fence_);
                if (!in_flight_.empty()) {
                    auto batch = std::move(in_flight_.front());
                    in_flight_.pop_front();
                    retire_batch(batch, frame_cmd);
                }
                transfer_in_flight_ = false;
            } else {
                return;  // still pending; new batch waits its turn
            }
        }

        // 2. Drain pending chunks into a new batch.
        std::deque<PendingChunk> local;
        {
            std::lock_guard<std::mutex> lock(queue_mutex_);
            local.swap(pending_chunks_);
        }
        if (local.empty()) return;

        InFlightBatch batch{};
        batch.fence = transfer_fence_;

        vkResetCommandBuffer(transfer_cmd_, 0);
        VkCommandBufferBeginInfo begin{};
        begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        vkBeginCommandBuffer(transfer_cmd_, &begin);

        for (auto& ch : local) {
            if (ch.is_completion_marker) {
                if (ch.on_complete) batch.callbacks.push_back(std::move(ch.on_complete));
                continue;
            }
            VkBufferCopy region{};
            region.srcOffset = ch.staging_offset;
            region.dstOffset = ch.dest_offset;
            region.size      = ch.size;
            vkCmdCopyBuffer(transfer_cmd_, staging_buffer_.buffer(),
                            ch.dest_buffer, 1, &region);

            batch.handles.push_back(ch.handle);
            if (ch.on_complete) batch.callbacks.push_back(std::move(ch.on_complete));
            batch.max_logical_end = std::max(batch.max_logical_end, ch.logical_end);

            // Cross-queue ownership transfer (release on transfer queue,
            // acquire on graphics queue) is added in a follow-up commit.

            std::lock_guard<std::mutex> lock(queue_mutex_);
            pending_status_[ch.handle.id] = Status::InFlight;
        }

        vkEndCommandBuffer(transfer_cmd_);

        VkSubmitInfo submit{};
        submit.sType              = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        submit.commandBufferCount = 1;
        submit.pCommandBuffers    = &transfer_cmd_;
        vkQueueSubmit(transfer_queue_, 1, &submit, transfer_fence_);

        in_flight_.push_back(std::move(batch));
        transfer_in_flight_ = true;
        return;
    }

    // ── Graphics-queue fallback path ──
    // No cross-queue ownership transfer needed (single family). Copies record
    // directly into `frame_cmd`; callbacks fire inline since the recorded copy
    // executes before the same submission's later commands.

    // 1. Retire any per-batch fences that have signaled (fallback path uses
    //    one fence per submitted batch).
    while (!in_flight_.empty()) {
        auto& front = in_flight_.front();
        if (vkGetFenceStatus(device_, front.fence) == VK_SUCCESS) {
            vkDestroyFence(device_, front.fence, nullptr);
            front.fence = VK_NULL_HANDLE;
            auto batch = std::move(front);
            in_flight_.pop_front();
            retire_batch(batch, frame_cmd);  // no acquire barriers in fallback
        } else {
            break;
        }
    }

    // 2. Drain pending chunks into `frame_cmd` up to the per-frame budget.
    std::deque<PendingChunk> local;
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        local.swap(pending_chunks_);
    }
    if (local.empty() || frame_cmd == VK_NULL_HANDLE) return;

    std::uint64_t bytes_recorded = 0;
    std::deque<PendingChunk> deferred;
    InFlightBatch frame_batch{};

    for (auto& ch : local) {
        if (ch.is_completion_marker) {
            if (ch.on_complete) frame_batch.callbacks.push_back(std::move(ch.on_complete));
            continue;
        }
        if (transfer_budget_bytes_ > 0 &&
            bytes_recorded + ch.size > transfer_budget_bytes_) {
            deferred.push_back(std::move(ch));
            continue;
        }

        VkBufferCopy region{};
        region.srcOffset = ch.staging_offset;
        region.dstOffset = ch.dest_offset;
        region.size      = ch.size;
        vkCmdCopyBuffer(frame_cmd, staging_buffer_.buffer(),
                        ch.dest_buffer, 1, &region);

        frame_batch.handles.push_back(ch.handle);
        if (ch.on_complete) frame_batch.callbacks.push_back(std::move(ch.on_complete));
        frame_batch.max_logical_end =
            std::max(frame_batch.max_logical_end, ch.logical_end);
        bytes_recorded += ch.size;

        std::lock_guard<std::mutex> lock(queue_mutex_);
        pending_status_[ch.handle.id] = Status::InFlight;
    }

    if (!deferred.empty()) {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        for (auto it = deferred.rbegin(); it != deferred.rend(); ++it) {
            pending_chunks_.push_front(std::move(*it));
        }
    }

    // Fallback path retires synchronously — the same `frame_cmd` will execute
    // the copy before any later use, so we can fire callbacks immediately
    // without waiting on a fence. Ring read also advances right away (the
    // staging memcpy is a CPU write that's already visible).
    if (!frame_batch.handles.empty() || !frame_batch.callbacks.empty()) {
        retire_batch(frame_batch, /*frame_cmd=*/VK_NULL_HANDLE);
    }
}

void TransferQueue::shutdown() {
    if (device_ == VK_NULL_HANDLE) return;

    vkDeviceWaitIdle(device_);

    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        for (auto& ch : pending_chunks_) {
            if (ch.on_complete) ch.on_complete();
        }
        pending_chunks_.clear();
    }
    for (auto& batch : in_flight_) {
        for (auto& cb : batch.callbacks) if (cb) cb();
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
