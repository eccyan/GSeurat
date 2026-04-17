#include "gseurat/engine/audio/mmap_audio_source.hpp"

#include <algorithm>
#include <cstring>

namespace gseurat::audio {

std::expected<std::unique_ptr<MmapAudioSource>, LoadError>
MmapAudioSource::from_gsaudio_file(std::string_view path, uint32_t target_sample_rate) {
    platform::MemoryMappedFile file;
    if (!file.open(path))
        return std::unexpected(LoadError::FileNotFound);

    auto span = file.data();
    if (span.size() < 32)
        return std::unexpected(LoadError::DecodeFailed);

    // Validate magic
    if (span[0] != 'G' || span[1] != 'S' || span[2] != 'A' || span[3] != 'U')
        return std::unexpected(LoadError::DecodeFailed);

    // Parse header (little-endian, safe on LE platforms)
    uint32_t version;
    std::memcpy(&version, span.data() + 4, 4);
    if (version != 1)
        return std::unexpected(LoadError::DecodeFailed);

    uint32_t sample_rate;
    std::memcpy(&sample_rate, span.data() + 8, 4);
    if (sample_rate != target_sample_rate)
        return std::unexpected(LoadError::SampleRateMismatch);

    uint8_t channels = span[12];
    if (channels != 1 && channels != 2)
        return std::unexpected(LoadError::ChannelCountUnsupported);

    uint64_t frame_count;
    std::memcpy(&frame_count, span.data() + 16, 8);

    // Validate file size
    const size_t expected_size = 32 + static_cast<size_t>(frame_count) * channels * sizeof(float);
    if (span.size() != expected_size)
        return std::unexpected(LoadError::DecodeFailed);

    const float* pcm_start = reinterpret_cast<const float*>(span.data() + 32);

    AudioFormat fmt{sample_rate, channels};
    return std::unique_ptr<MmapAudioSource>(
        new MmapAudioSource(std::move(file), fmt, frame_count, pcm_start));
}

void MmapAudioSource::read_frames(uint64_t start_frame,
                                    uint32_t frame_count,
                                    std::span<float> out) const noexcept {
    const uint32_t ch = format_.channels;
    const uint64_t available = (start_frame >= frame_count_)
                                 ? 0
                                 : (frame_count_ - start_frame);
    const uint32_t copy = static_cast<uint32_t>(std::min<uint64_t>(frame_count, available));
    if (copy > 0) {
        std::memcpy(out.data(),
                    pcm_start_ + start_frame * ch,
                    static_cast<size_t>(copy) * ch * sizeof(float));
    }
    if (copy < frame_count) {
        std::memset(out.data() + copy * ch, 0,
                    static_cast<size_t>(frame_count - copy) * ch * sizeof(float));
    }
}

}  // namespace gseurat::audio
