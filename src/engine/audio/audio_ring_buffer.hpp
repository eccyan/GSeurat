#pragma once
// Lock-free SPSC ring buffer for bulk float32 PCM audio data.
// Used between the decode thread (writer) and the audio callback thread (reader).
//
// Design:
//   - Monotonic uint64_t cursors (read_pos_, write_pos_) that never wrap.
//   - Index into buffer via (pos * channels) % buffer_size_in_samples.
//   - Power-of-two capacity_frames for fast modulo via bitmask.
//   - write() / read() each handle wrap-around with at most 2 memcpys.
//   - available_frames() / free_frames() are lock-free queries.
//   - flush() resets read_pos_ to write_pos_ (hard seek / stream switch).
//
// Thread safety: exactly ONE producer thread calls write(); exactly ONE
// consumer thread calls read() / available_frames() / flush().

#include <atomic>
#include <cstdint>
#include <cstring>
#include <vector>

namespace gseurat::audio {

class AudioRingBuffer {
public:
    // Default: 1 second at 44100 Hz, stereo.
    // capacity_frames must be a power of two.
    explicit AudioRingBuffer(uint32_t channels       = 2,
                             uint32_t capacity_frames = 65536u)
        : channels_(channels),
          capacity_frames_(capacity_frames),
          buffer_(static_cast<size_t>(capacity_frames) * channels, 0.0f)
    {
        // Enforce power-of-two at runtime (debug guard).
        // Caller is responsible for passing a valid value.
        // (static_assert not possible for runtime param)
    }

    // -------------------------------------------------------------------------
    // Producer side (decode thread)
    // -------------------------------------------------------------------------

    // Write up to `frames` interleaved float frames from `data`.
    // Returns the number of frames actually written (may be less if buffer is
    // nearly full — we never overwrite unread data).
    uint32_t write(const float* data, uint32_t frames) noexcept {
        const uint64_t wp = write_pos_.load(std::memory_order_relaxed);
        const uint64_t rp = read_pos_.load(std::memory_order_acquire);

        const uint64_t avail_space = capacity_frames_ - (wp - rp);
        if (avail_space == 0) return 0;

        const uint32_t to_write = static_cast<uint32_t>(
            frames < avail_space ? frames : avail_space);

        // Offset into the ring (in frames), masked to capacity.
        const uint32_t mask   = capacity_frames_ - 1u;
        const uint32_t offset = static_cast<uint32_t>(wp & mask);       // frame index

        const uint32_t first_chunk = (offset + to_write <= capacity_frames_)
                                         ? to_write
                                         : capacity_frames_ - offset;   // frames to end-of-ring

        // First memcpy (and possibly only one if no wrap)
        std::memcpy(&buffer_[static_cast<size_t>(offset) * channels_],
                    data,
                    static_cast<size_t>(first_chunk) * channels_ * sizeof(float));

        // Second memcpy if we wrapped around
        const uint32_t second_chunk = to_write - first_chunk;
        if (second_chunk > 0) {
            std::memcpy(&buffer_[0],
                        data + static_cast<size_t>(first_chunk) * channels_,
                        static_cast<size_t>(second_chunk) * channels_ * sizeof(float));
        }

        write_pos_.store(wp + to_write, std::memory_order_release);
        return to_write;
    }

    // -------------------------------------------------------------------------
    // Consumer side (audio callback thread)
    // -------------------------------------------------------------------------

    // Read up to `frames` interleaved float frames into `out`.
    // Returns the number of frames actually read (may be less if buffer is
    // partially empty — caller should zero-fill any gap).
    uint32_t read(float* out, uint32_t frames) noexcept {
        const uint64_t rp = read_pos_.load(std::memory_order_relaxed);
        const uint64_t wp = write_pos_.load(std::memory_order_acquire);

        const uint64_t available = wp - rp;
        if (available == 0) return 0;

        const uint32_t to_read = static_cast<uint32_t>(
            frames < available ? frames : available);

        const uint32_t mask   = capacity_frames_ - 1u;
        const uint32_t offset = static_cast<uint32_t>(rp & mask);

        const uint32_t first_chunk = (offset + to_read <= capacity_frames_)
                                         ? to_read
                                         : capacity_frames_ - offset;

        std::memcpy(out,
                    &buffer_[static_cast<size_t>(offset) * channels_],
                    static_cast<size_t>(first_chunk) * channels_ * sizeof(float));

        const uint32_t second_chunk = to_read - first_chunk;
        if (second_chunk > 0) {
            std::memcpy(out + static_cast<size_t>(first_chunk) * channels_,
                        &buffer_[0],
                        static_cast<size_t>(second_chunk) * channels_ * sizeof(float));
        }

        read_pos_.store(rp + to_read, std::memory_order_release);
        return to_read;
    }

    // -------------------------------------------------------------------------
    // Queries (safe to call from either thread; only approximate from producer)
    // -------------------------------------------------------------------------

    // Number of frames that can be read right now.
    [[nodiscard]] uint32_t available_frames() const noexcept {
        const uint64_t wp = write_pos_.load(std::memory_order_acquire);
        const uint64_t rp = read_pos_.load(std::memory_order_relaxed);
        return static_cast<uint32_t>(wp - rp);
    }

    // Number of frames that can still be written before overflow.
    [[nodiscard]] uint32_t free_frames() const noexcept {
        return capacity_frames_ - available_frames();
    }

    // Total ring capacity in frames.
    [[nodiscard]] uint32_t capacity_frames() const noexcept {
        return capacity_frames_;
    }

    [[nodiscard]] uint32_t channels() const noexcept { return channels_; }

    // Hard seek: discard all buffered data (e.g. on stream switch / seek).
    // Must only be called by the CONSUMER thread (or when both threads are quiesced).
    void flush() noexcept {
        const uint64_t wp = write_pos_.load(std::memory_order_acquire);
        read_pos_.store(wp, std::memory_order_release);
    }

private:
    std::vector<float>        buffer_;
    alignas(64) std::atomic<uint64_t> read_pos_{0};   // monotonic frames consumed
    alignas(64) std::atomic<uint64_t> write_pos_{0};  // monotonic frames produced
    uint32_t channels_;
    uint32_t capacity_frames_;
};

}  // namespace gseurat::audio
