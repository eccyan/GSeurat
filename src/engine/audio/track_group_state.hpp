#pragma once
#include "gseurat/engine/audio/audio_source.hpp"
#include "gseurat/engine/audio/dsp_effect.hpp"
#include "gseurat/engine/audio/slew_limiter.hpp"
#include "gseurat/engine/audio/track_group.hpp"

#include <array>
#include <cstdint>

namespace gseurat::audio {

inline constexpr uint32_t kMaxStemsPerGroup = 8;
inline constexpr uint32_t kMaxEffectsPerStem = 4;

struct StemRuntime {
    const IAudioSource* source = nullptr;
    SlewLimiter         volume;
    IDSPEffect*         effect_chain[kMaxEffectsPerStem]{};
    uint8_t             effect_count = 0;
};

struct TrackGroupState {
    enum class Status : uint8_t {
        Idle,
        Playing,
        CrossfadingOut,
        AwaitingTransition,
    };

    uint32_t       group_id   = 0;
    Status         status     = Status::Idle;
    uint64_t       play_cursor = 0;
    uint64_t       loop_start = 0;
    uint64_t       loop_end   = 0;

    SlewLimiter    group_volume;

    std::array<StemRuntime, kMaxStemsPerGroup> stems{};
    uint8_t        stem_count = 0;

    uint32_t pending_transition_target = 0;
    uint64_t pending_transition_xfade_frames = 0;

    const Marker* markers_begin = nullptr;
    const Marker* markers_end   = nullptr;
};

}  // namespace gseurat::audio
