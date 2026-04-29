#pragma once

#include "gseurat/engine/buffer.hpp"

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <unordered_map>
#include <vector>

namespace gseurat {

// Asynchronous host→device transfers via a shared host-visible staging ring.
//
// Use:
//   1. `reserve_staging(bytes)`  → caller memcpys the payload into `host_ptr`
//   2. `submit(reservation, dest_buffer, dest_offset, on_complete?)` → Handle
//   3. main loop calls `poll_completions(frame_cmd)` once per frame; signaled
//      fences retire batches, fire callbacks, and (when the transfer queue is
//      a dedicated family) emit acquire barriers into `frame_cmd`.
//
// Threading: `reserve_staging` and `submit` are mutex-locked and safe to call
// from worker threads. `poll_completions` must run on the main thread (it
// manipulates the transfer command buffer and `frame_cmd`).
class TransferQueue {
public:
    // Opaque handle ECS components hold to track an in-flight transfer.
    // 0 is reserved for "invalid".
    struct Handle {
        std::uint64_t id = 0;
        explicit operator bool() const noexcept { return id != 0; }
        bool operator==(const Handle&) const = default;
    };

    enum class Status {
        Unknown,    // handle never seen (or already aged out of recent map)
        Pending,    // queued, not yet submitted to GPU
        InFlight,   // submitted, fence not yet signaled
        Complete,   // GPU finished, callback fired (cached briefly)
        Failed,     // staging reservation could not be fulfilled
    };

    // Slice of the host-visible staging ring leased to a producer.
    struct Reservation {
        std::byte*    host_ptr        = nullptr;
        std::uint64_t staging_offset  = 0;   // physical offset in staging buffer
        std::uint64_t size            = 0;
        std::uint64_t logical_end     = 0;   // monotonic ring offset for retirement
        std::uint64_t token           = 0;   // sanity-check tag

        explicit operator bool() const noexcept { return host_ptr != nullptr; }
    };

    TransferQueue(VkDevice device, VmaAllocator allocator,
                  VkQueue transfer_queue, std::uint32_t transfer_family,
                  std::uint32_t graphics_family,
                  bool dedicated, std::uint64_t staging_size,
                  std::uint32_t transfer_budget_mb);

    ~TransferQueue();

    TransferQueue(const TransferQueue&)            = delete;
    TransferQueue& operator=(const TransferQueue&) = delete;
    TransferQueue(TransferQueue&&)                 = delete;
    TransferQueue& operator=(TransferQueue&&)      = delete;

    // Carve out `bytes` of host-visible staging. Returns nullopt if the ring
    // is too full this frame — caller should retry next frame (after poll
    // has had a chance to retire in-flight batches).
    std::optional<Reservation> reserve_staging(std::uint64_t bytes);

    // Schedule a copy of the reservation into [dest_buffer + dest_offset].
    // The reservation is consumed; do not pass it to submit() twice.
    Handle submit(const Reservation& reservation,
                  VkBuffer dest_buffer, std::uint64_t dest_offset,
                  std::function<void()> on_complete = {});

    // Schedule a callback that fires after every preceding submit() in the
    // current pending batch finishes. Useful for "all chunks for asset X are
    // uploaded → register asset" without per-chunk handles.
    void enqueue_completion(std::function<void()> on_complete);

    // Per-frame: retire signaled fences, fire callbacks, emit acquire barriers
    // into `frame_cmd` (dedicated transfer family only), and submit the next
    // pending batch.
    void poll_completions(VkCommandBuffer frame_cmd);

    // O(1) lookup; returns Status::Unknown for handles whose record has aged
    // out of the retention map (~64 most recent retirements are kept).
    Status status(Handle handle) const;

    bool          is_dedicated()  const { return dedicated_; }
    std::uint64_t staging_size()  const { return staging_size_; }

    void shutdown();

private:
    struct PendingChunk {
        Handle                handle;
        VkBuffer              dest_buffer = VK_NULL_HANDLE;
        std::uint64_t         dest_offset = 0;
        std::uint64_t         staging_offset = 0;
        std::uint64_t         size = 0;
        std::uint64_t         logical_end = 0;          // for ring retirement
        std::function<void()> on_complete;
        bool                  is_completion_marker = false;
    };

    struct InFlightBatch {
        VkFence                              fence = VK_NULL_HANDLE;
        std::vector<Handle>                  handles;
        std::vector<std::function<void()>>   callbacks;
        // Per-buffer ranges for the graphics-side acquire barrier (dedicated
        // path only — empty when transfer_family_ == graphics_family_).
        struct AcquireRange { VkBuffer buffer; std::uint64_t offset; std::uint64_t size; };
        std::vector<AcquireRange>            acquire_ranges;
        std::uint64_t                        max_logical_end = 0;   // for ring retirement
    };

    void retire_batch(InFlightBatch& batch, VkCommandBuffer frame_cmd);
    Handle make_handle();

    VkDevice         device_;
    VmaAllocator     allocator_;
    VkQueue          transfer_queue_;
    std::uint32_t    transfer_family_;
    std::uint32_t    graphics_family_;
    bool             dedicated_;
    std::uint64_t    staging_size_;
    std::uint64_t    transfer_budget_bytes_;

    Buffer           staging_buffer_;

    // Dedicated path
    VkCommandPool    transfer_cmd_pool_ = VK_NULL_HANDLE;
    VkCommandBuffer  transfer_cmd_      = VK_NULL_HANDLE;
    VkFence          transfer_fence_    = VK_NULL_HANDLE;
    bool             transfer_in_flight_ = false;

    // Ring watermarks (linear, monotonic — physical offset = X % staging_size_).
    // Protected by `queue_mutex_`.
    std::uint64_t    ring_write_ = 0;   // next byte to allocate
    std::uint64_t    ring_read_  = 0;   // bytes up to this offset are free

    // Pending queue
    mutable std::mutex        queue_mutex_;
    std::deque<PendingChunk>  pending_chunks_;
    std::deque<InFlightBatch> in_flight_;

    // Status tracking
    std::unordered_map<std::uint64_t, Status> pending_status_;
    std::deque<std::uint64_t>                 recent_complete_order_;
    std::unordered_map<std::uint64_t, Status> recent_status_;
    static constexpr std::size_t              kRecentStatusCap = 64;

    std::uint64_t next_handle_id_ = 1;
    std::uint64_t next_token_     = 1;
};

}  // namespace gseurat
