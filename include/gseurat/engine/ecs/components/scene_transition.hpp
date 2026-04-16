#pragma once

#include <glm/glm.hpp>

#include <cstdint>
#include <string>

namespace gseurat {

struct SceneTransition {
    enum class State : uint8_t { FadeOut, Loading, FadeIn };

    State       current_state   = State::FadeOut;
    float       timer           = 0.0f;
    float       fade_duration   = 0.5f;
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    bool        load_dispatched = false;
};

}  // namespace gseurat
