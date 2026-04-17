#pragma once
#include "gseurat/engine/audio/audio_source.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"  // for LoadError
#include "gseurat/platform/memory_mapped_file.hpp"

#include <expected>
#include <memory>
#include <string_view>

namespace gseurat::audio {

class MmapAudioSource final : public IAudioSource {
public:
    static std::expected<std::unique_ptr<MmapAudioSource>, LoadError>
        from_gsaudio_file(std::string_view path, uint32_t target_sample_rate);

    AudioFormat format()       const noexcept override { return format_; }
    uint64_t    total_frames() const noexcept override { return frame_count_; }

    void read_frames(uint64_t start_frame,
                     uint32_t frame_count,
                     std::span<float> out_interleaved) const noexcept override;

private:
    MmapAudioSource(platform::MemoryMappedFile&& file, AudioFormat fmt,
                     uint64_t frames, const float* pcm_start)
        : file_(std::move(file)), format_(fmt),
          frame_count_(frames), pcm_start_(pcm_start) {}

    platform::MemoryMappedFile file_;
    AudioFormat                format_;
    uint64_t                   frame_count_;
    const float*               pcm_start_;
};

}  // namespace gseurat::audio
