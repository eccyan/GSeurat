#pragma once
// StreamingAudioSource: IAudioSource backed by AudioRingBuffer + ma_decoder.
//
// Decoding happens on the AudioStreamManager's background thread.
// read_frames() is wait-free: pops from ring buffer or outputs silence on seek.

#include "gseurat/engine/audio/audio_source.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"  // LoadError
#include "audio_ring_buffer.hpp"

#include <miniaudio.h>

#include <atomic>
#include <expected>
#include <memory>
#include <string_view>

namespace gseurat::audio {

class AudioStreamManager;

class StreamingAudioSource final : public IAudioSource {
public:
    /// Create a streaming source from an audio file (WAV, OGG, FLAC, MP3).
    /// Returns LoadError on failure. Registers with manager for background decode.
    static std::expected<std::unique_ptr<StreamingAudioSource>, LoadError>
        create(std::string_view path, uint32_t sample_rate,
               uint64_t loop_start, uint64_t loop_end,
               AudioStreamManager* manager,
               uint32_t ring_capacity_frames = 44100);

    ~StreamingAudioSource() override;

    StreamingAudioSource(const StreamingAudioSource&) = delete;
    StreamingAudioSource& operator=(const StreamingAudioSource&) = delete;

    AudioFormat format() const noexcept override { return format_; }
    uint64_t total_frames() const noexcept override { return total_frames_; }

    void read_frames(uint64_t start_frame, uint32_t frame_count,
                     std::span<float> out) const noexcept override;

    // --- Called by AudioStreamManager worker thread ---

    /// Decode up to max_frames into the ring buffer.
    void refill(uint32_t max_frames);

    /// True if ring is less than half full.
    [[nodiscard]] bool needs_refill() const noexcept;

    /// True if the consumer requested a seek.
    [[nodiscard]] bool has_seek_request() const noexcept;

    /// Process a pending seek request (seek the decoder).
    void process_seek_request();

    /// Set by refill(), checked by remove_source() for safe removal.
    std::atomic<bool> refilling_{false};

private:
    StreamingAudioSource(AudioFormat fmt, uint64_t total,
                         uint64_t loop_start, uint64_t loop_end,
                         AudioStreamManager* manager, uint32_t ring_cap);

    ma_decoder decoder_;
    AudioRingBuffer ring_;
    AudioFormat format_;
    uint64_t total_frames_;
    uint64_t loop_start_;
    uint64_t loop_end_;
    uint64_t decode_cursor_{0};

    mutable std::atomic<uint64_t> expected_read_cursor_{0};
    mutable std::atomic<int64_t> seek_request_{-1};  // -1 = no request
    AudioStreamManager* manager_;
};

}  // namespace gseurat::audio
