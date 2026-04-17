#pragma once
// IAudioSource: wait-free abstraction over PCM data.
// Every method MUST be noexcept, allocation-free, and syscall-free.
//
// Implementations in Phase 1: MemoryAudioSource only (in-memory float PCM).
// Phase 3 adds binary-format mmap source; Phase 4 streaming source.
// The mixer NEVER changes when new sources are added.

#include <cstdint>
#include <span>

namespace gseurat::audio {

struct AudioFormat {
    uint32_t sample_rate;
    uint8_t  channels;   // 1 = mono, 2 = stereo
};

class IAudioSource {
public:
    virtual ~IAudioSource() = default;

    virtual AudioFormat format()       const noexcept = 0;
    virtual uint64_t    total_frames() const noexcept = 0;

    // Read `frame_count` frames starting at `start_frame` into `out`.
    // `out` is interleaved float32; out.size() == frame_count * channels.
    //
    // If start_frame + frame_count > total_frames, implementation reads up to
    // total_frames and zero-fills the remainder. (Defense-in-depth.)
    virtual void read_frames(uint64_t start_frame,
                             uint32_t frame_count,
                             std::span<float> out_interleaved) const noexcept = 0;
};

}  // namespace gseurat::audio
