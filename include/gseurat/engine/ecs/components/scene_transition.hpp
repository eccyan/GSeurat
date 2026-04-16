#pragma once

#include <glm/glm.hpp>

#include <cstdint>
#include <string>

namespace gseurat {

struct SceneTransition {
    enum class State : uint8_t { SceneOut, Loading, SceneIn };

    State       current_state       = State::SceneOut;
    float       timer               = 0.0f;
    float       transition_duration = 0.5f;
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    bool        load_dispatched = false;
};

}  // namespace gseurat
