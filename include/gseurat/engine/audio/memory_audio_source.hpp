#pragma once
#include "gseurat/engine/audio/audio_source.hpp"

#include <expected>
#include <memory>
#include <string_view>
#include <vector>

namespace gseurat::audio {

enum class LoadError : uint32_t {
    FileNotFound,
    DecodeFailed,
    SampleRateMismatch,
    ChannelCountUnsupported,
    TooLarge,
};

class MemoryAudioSource final : public IAudioSource {
public:
    static std::expected<std::unique_ptr<MemoryAudioSource>, LoadError>
        from_wav_file(std::string_view path, uint32_t target_sample_rate);

    AudioFormat format()       const noexcept override { return format_; }
    uint64_t    total_frames() const noexcept override { return frame_count_; }

    void read_frames(uint64_t start_frame,
                     uint32_t frame_count,
                     std::span<float> out_interleaved) const noexcept override;

private:
    MemoryAudioSource(std::vector<float>&& pcm, AudioFormat fmt, uint64_t frames)
        : pcm_(std::move(pcm)), format_(fmt), frame_count_(frames) {}

    std::vector<float> pcm_;
    AudioFormat        format_;
    uint64_t           frame_count_;
};

}  // namespace gseurat::audio
