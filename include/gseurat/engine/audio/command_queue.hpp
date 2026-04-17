#pragma once
// Lock-free SPSC ring buffer for audio-thread command messaging.
// Exactly ONE producer (game thread) calls try_push; exactly ONE consumer (audio thread) calls try_pop.
// Power-of-two capacity; wrap is a mask. Cache-line-aligned head/tail to eliminate false sharing.
// Standard Lamport SPSC — uses one slot as sentinel, so capacity N holds up to N-1 items.

#include <array>
#include <atomic>
#include <cstdint>
#include <type_traits>

namespace gseurat::audio {

template <typename T, uint32_t CapacityPow2>
class SpscRingBuffer {
    static_assert(CapacityPow2 >= 2, "capacity must be >= 2");
    static_assert((CapacityPow2 & (CapacityPow2 - 1)) == 0, "capacity must be a power of two");
    static_assert(std::is_trivially_copyable_v<T>, "T must be trivially copyable");

    static constexpr uint32_t kMask = CapacityPow2 - 1;

    alignas(64) std::atomic<uint32_t> head_{0};
    alignas(64) std::atomic<uint32_t> tail_{0};
    alignas(64) std::array<T, CapacityPow2> slots_{};

public:
    [[nodiscard]] bool try_push(const T& v) noexcept {
        const uint32_t h = head_.load(std::memory_order_relaxed);
        const uint32_t t = tail_.load(std::memory_order_acquire);
        const uint32_t next = (h + 1) & kMask;
        if (next == t) return false;
        slots_[h] = v;
        head_.store(next, std::memory_order_release);
        return true;
    }

    [[nodiscard]] bool try_pop(T& out) noexcept {
        const uint32_t t = tail_.load(std::memory_order_relaxed);
        const uint32_t h = head_.load(std::memory_order_acquire);
        if (t == h) return false;
        out = slots_[t];
        tail_.store((t + 1) & kMask, std::memory_order_release);
        return true;
    }

    uint32_t approx_size() const noexcept {
        const uint32_t h = head_.load(std::memory_order_relaxed);
        const uint32_t t = tail_.load(std::memory_order_relaxed);
        return (h - t) & kMask;
    }
};

}  // namespace gseurat::audio
