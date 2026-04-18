// StreamingAudioSource implementation — Ogg/WAV/FLAC/MP3 streaming via ma_decoder.
// NOTE: MINIAUDIO_IMPLEMENTATION is in memory_audio_source.cpp.

#include "streaming_audio_source.hpp"
#include "audio_stream_manager.hpp"

#include <algorithm>
#include <cstring>
#include <string>

namespace gseurat::audio {

// Round up to the next power of two.
static uint32_t next_power_of_two(uint32_t v) {
    v--;
    v |= v >> 1; v |= v >> 2; v |= v >> 4;
    v |= v >> 8; v |= v >> 16;
    return v + 1;
}

StreamingAudioSource::StreamingAudioSource(AudioFormat fmt, uint64_t total,
                                           uint64_t loop_start, uint64_t loop_end,
                                           AudioStreamManager* manager,
                                           uint32_t ring_cap)
    : ring_(fmt.channels, next_power_of_two(ring_cap)),
      format_(fmt),
      total_frames_(total),
      loop_start_(loop_start),
      loop_end_(loop_end),
      manager_(manager)
{
    // decoder_ is initialized in-place by create().
    std::memset(&decoder_, 0, sizeof(decoder_));
}

std::expected<std::unique_ptr<StreamingAudioSource>, LoadError>
StreamingAudioSource::create(std::string_view path, uint32_t sample_rate,
                             uint64_t loop_start, uint64_t loop_end,
                             AudioStreamManager* manager,
                             uint32_t ring_capacity_frames) {
    std::string path_str(path);

    // Probe the file first to get format info before constructing the source.
    ma_decoder probe{};
    ma_decoder_config cfg = ma_decoder_config_init(ma_format_f32, 0, 0);
    if (ma_decoder_init_file(path_str.c_str(), &cfg, &probe) != MA_SUCCESS) {
        return std::unexpected(LoadError::FileNotFound);
    }

    const uint32_t file_sr = probe.outputSampleRate;
    const uint32_t file_ch = probe.outputChannels;

    if (file_sr != sample_rate) {
        ma_decoder_uninit(&probe);
        return std::unexpected(LoadError::SampleRateMismatch);
    }
    if (file_ch != 1 && file_ch != 2) {
        ma_decoder_uninit(&probe);
        return std::unexpected(LoadError::ChannelCountUnsupported);
    }

    // Query total frames (0 = unknown for some formats, that's OK for streaming).
    ma_uint64 total_frames = 0;
    ma_decoder_get_length_in_pcm_frames(&probe, &total_frames);

    AudioFormat fmt{file_sr, static_cast<uint8_t>(file_ch)};

    // Construct source with correct format. Move probe decoder in via memcpy
    // (ma_decoder is a C struct, memcpy is safe).
    auto source = std::unique_ptr<StreamingAudioSource>(
        new StreamingAudioSource(fmt, total_frames, loop_start, loop_end,
                                 manager, ring_capacity_frames));
    std::memcpy(&source->decoder_, &probe, sizeof(ma_decoder));
    std::memset(&probe, 0, sizeof(probe));  // prevent double-uninit

    // Pre-fill the ring buffer before registering with manager.
    source->refill(source->ring_.capacity_frames());

    // Register with the stream manager for background refill.
    if (manager) {
        manager->add_source(source.get());
    }

    return source;
}

StreamingAudioSource::~StreamingAudioSource() {
    if (manager_) {
        manager_->remove_source(this);
    }
    ma_decoder_uninit(&decoder_);
}

void StreamingAudioSource::read_frames(uint64_t start_frame, uint32_t frame_count,
                                       std::span<float> out) const noexcept {
    const uint32_t ch = format_.channels;
    const uint64_t expected = expected_read_cursor_.load(std::memory_order_relaxed);

    if (start_frame == expected) {
        // Sequential read — pop from ring buffer.
        auto& ring = const_cast<AudioRingBuffer&>(ring_);
        const uint32_t got = ring.read(out.data(), frame_count);

        // Zero-fill any underrun.
        if (got < frame_count) {
            std::memset(out.data() + static_cast<size_t>(got) * ch, 0,
                        static_cast<size_t>(frame_count - got) * ch * sizeof(float));
        }

        expected_read_cursor_.store(expected + frame_count, std::memory_order_relaxed);

        // Wake the decode thread — we consumed data.
        if (manager_) {
            manager_->notify_consumption();
        }
    } else {
        // Non-sequential read (seek). Flush ring, request seek, output silence.
        const_cast<AudioRingBuffer&>(ring_).flush();
        seek_request_.store(static_cast<int64_t>(start_frame), std::memory_order_release);
        expected_read_cursor_.store(start_frame + frame_count, std::memory_order_relaxed);

        std::memset(out.data(), 0,
                    static_cast<size_t>(frame_count) * ch * sizeof(float));

        if (manager_) {
            manager_->notify_consumption();
        }
    }
}

void StreamingAudioSource::refill(uint32_t max_frames) {
    refilling_.store(true, std::memory_order_relaxed);

    // Process any pending seek request first.
    if (has_seek_request()) {
        process_seek_request();
    }

    const uint32_t ch = format_.channels;
    uint32_t remaining = max_frames;

    // Decode in chunks to avoid huge stack allocations.
    constexpr uint32_t kChunkFrames = 4096;
    float chunk_buf[kChunkFrames * 2];  // max stereo

    while (remaining > 0) {
        // Check if ring is full.
        if (ring_.free_frames() == 0) break;

        const uint32_t to_decode = std::min({remaining, kChunkFrames,
                                              ring_.free_frames()});

        // Handle loop_end boundary.
        uint32_t actual_decode = to_decode;
        if (loop_end_ > 0 && decode_cursor_ + to_decode > loop_end_) {
            actual_decode = static_cast<uint32_t>(loop_end_ - decode_cursor_);
            if (actual_decode == 0) {
                // At loop end — seek back to loop_start.
                ma_decoder_seek_to_pcm_frame(&decoder_, loop_start_);
                decode_cursor_ = loop_start_;
                continue;
            }
        }

        ma_uint64 frames_read = 0;
        ma_result result = ma_decoder_read_pcm_frames(
            &decoder_, chunk_buf, actual_decode, &frames_read);

        if (frames_read > 0) {
            ring_.write(chunk_buf, static_cast<uint32_t>(frames_read));
            decode_cursor_ += frames_read;
            remaining -= static_cast<uint32_t>(frames_read);
        }

        if (result != MA_SUCCESS || frames_read == 0) {
            // EOF for non-looping sources.
            if (loop_end_ > 0 || loop_start_ > 0) {
                // Looping: seek back.
                ma_decoder_seek_to_pcm_frame(&decoder_, loop_start_);
                decode_cursor_ = loop_start_;
            } else {
                break;  // Non-looping EOF.
            }
        }

        // If we hit loop_end exactly, loop back.
        if (loop_end_ > 0 && decode_cursor_ >= loop_end_) {
            ma_decoder_seek_to_pcm_frame(&decoder_, loop_start_);
            decode_cursor_ = loop_start_;
        }
    }

    refilling_.store(false, std::memory_order_release);
}

bool StreamingAudioSource::needs_refill() const noexcept {
    return ring_.available_frames() < ring_.capacity_frames() / 2;
}

bool StreamingAudioSource::has_seek_request() const noexcept {
    return seek_request_.load(std::memory_order_acquire) >= 0;
}

void StreamingAudioSource::process_seek_request() {
    const int64_t target = seek_request_.load(std::memory_order_acquire);
    if (target < 0) return;

    ma_decoder_seek_to_pcm_frame(&decoder_, static_cast<ma_uint64>(target));
    decode_cursor_ = static_cast<uint64_t>(target);
    seek_request_.store(-1, std::memory_order_release);
}

}  // namespace gseurat::audio
