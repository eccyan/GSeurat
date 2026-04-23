#pragma once
#include <glm/glm.hpp>
#include <cstdint>
#include <vector>

namespace gseurat {

struct StemFadeAction {
    uint32_t group_id = 0;
    uint32_t stem_index = 0;
    float    target_volume = 0.0f;
    float    fade_ms = 0.0f;
};

struct AudioZoneComponent {
    glm::vec3 bounds_min{0};
    glm::vec3 bounds_max{0};
    uint32_t  track_group_id = 0;

    enum class Action : uint8_t { Play, PlayOrTransition, Stop };
    Action action_on_enter = Action::Play;
    Action action_on_exit  = Action::Stop;
    float  enter_xfade_ms  = 1000.0f;
    float  exit_fade_ms    = 500.0f;
    bool   align_to_next_marker = true;

    std::vector<StemFadeAction> stem_fade_on_enter;
    std::vector<StemFadeAction> stem_fade_on_exit;

    bool   player_inside = false;  // hysteresis
};

}  // namespace gseurat
