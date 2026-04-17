#pragma once
#include <cstdint>
#include <type_traits>

namespace gseurat::audio {

struct AudioCommand {
    enum class Type : uint8_t {
        PlayGroup,
        StopGroup,
        SetStemVolume,
        SetGroupVolume,
        RequestTransition,
        PlayOneshot,          // stem_index=sfx_id, value=volume
        PlayLoopingSpatial,   // stem_index=sfx_id, value=volume, pos[3], max_distance
        StopAllSfx,           // no parameters — clears all oneshot voices
    };
    Type     type;
    uint32_t group_id;
    uint32_t stem_index;
    uint32_t secondary_group_id;
    float    value;
    uint64_t frame_count;
    float    pos[3];          // world position for spatial commands
    float    max_distance;    // attenuation range
};

static_assert(std::is_trivially_copyable_v<AudioCommand>);
static_assert(sizeof(AudioCommand) <= 64);

}  // namespace gseurat::audio
