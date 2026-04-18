#include "gseurat/engine/audio/memory_audio_source.hpp"

// Enable Ogg Vorbis decoding in miniaudio via stb_vorbis.
// stb_vorbis header must be included before MINIAUDIO_IMPLEMENTATION.
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-function"
#endif
#define STB_VORBIS_HEADER_ONLY
#include "stb_vorbis.c"
#if defined(__clang__)
#pragma clang diagnostic pop
#endif

#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

// stb_vorbis implementation (after miniaudio implementation).
#undef STB_VORBIS_HEADER_ONLY
#include "stb_vorbis.c"

#include <algorithm>
#include <cstring>
#include <string>

namespace gseurat::audio {

std::expected<std::unique_ptr<MemoryAudioSource>, LoadError>
MemoryAudioSource::from_wav_file(std::string_view path, uint32_t target_sample_rate) {
    std::string path_str(path);

    ma_decoder_config cfg = ma_decoder_config_init(ma_format_f32, 0, 0);
    ma_decoder decoder{};
    if (ma_decoder_init_file(path_str.c_str(), &cfg, &decoder) != MA_SUCCESS) {
        return std::unexpected(LoadError::FileNotFound);
    }

    const uint32_t file_sr = decoder.outputSampleRate;
    const uint32_t file_ch = decoder.outputChannels;

    if (file_sr != target_sample_rate) {
        ma_decoder_uninit(&decoder);
        return std::unexpected(LoadError::SampleRateMismatch);
    }
    if (file_ch != 1 && file_ch != 2) {
        ma_decoder_uninit(&decoder);
        return std::unexpected(LoadError::ChannelCountUnsupported);
    }

    ma_uint64 frames_in_file = 0;
    if (ma_decoder_get_length_in_pcm_frames(&decoder, &frames_in_file) != MA_SUCCESS || frames_in_file == 0) {
        ma_decoder_uninit(&decoder);
        return std::unexpected(LoadError::DecodeFailed);
    }
    constexpr uint64_t kMaxFrames = 48000ULL * 60 * 10;
    if (frames_in_file > kMaxFrames) {
        ma_decoder_uninit(&decoder);
        return std::unexpected(LoadError::TooLarge);
    }

    std::vector<float> pcm(static_cast<size_t>(frames_in_file) * file_ch);
    ma_uint64 frames_read = 0;
    if (ma_decoder_read_pcm_frames(&decoder, pcm.data(), frames_in_file, &frames_read) != MA_SUCCESS
        || frames_read != frames_in_file) {
        ma_decoder_uninit(&decoder);
        return std::unexpected(LoadError::DecodeFailed);
    }
    ma_decoder_uninit(&decoder);

    AudioFormat fmt{file_sr, static_cast<uint8_t>(file_ch)};
    return std::unique_ptr<MemoryAudioSource>(
        new MemoryAudioSource(std::move(pcm), fmt, frames_in_file));
}

void MemoryAudioSource::read_frames(uint64_t start_frame,
                                     uint32_t frame_count,
                                     std::span<float> out) const noexcept {
    const uint32_t ch = format_.channels;
    const uint64_t available = (start_frame >= frame_count_) ? 0 : (frame_count_ - start_frame);
    const uint32_t copy = static_cast<uint32_t>(std::min<uint64_t>(frame_count, available));
    if (copy > 0) {
        std::memcpy(out.data(),
                    pcm_.data() + start_frame * ch,
                    static_cast<size_t>(copy) * ch * sizeof(float));
    }
    if (copy < frame_count) {
        std::memset(out.data() + copy * ch, 0,
                    static_cast<size_t>(frame_count - copy) * ch * sizeof(float));
    }
}

}  // namespace gseurat::audio
