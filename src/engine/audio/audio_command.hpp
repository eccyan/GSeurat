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
    };
    Type     type;
    uint32_t group_id;
    uint32_t stem_index;
    uint32_t secondary_group_id;
    float    value;
    uint64_t frame_count;
};

static_assert(std::is_trivially_copyable_v<AudioCommand>);
static_assert(sizeof(AudioCommand) <= 64);

}  // namespace gseurat::audio
