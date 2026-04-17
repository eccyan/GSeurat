#pragma once
#include <glm/glm.hpp>
#include <cstdint>

namespace gseurat {

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

    bool   player_inside = false;  // hysteresis
};

}  // namespace gseurat
