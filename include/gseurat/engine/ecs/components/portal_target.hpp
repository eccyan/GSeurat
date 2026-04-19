#pragma once

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

struct PortalTarget {
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    glm::vec3   transition_color{1.0f};
    float       transition_duration{0.5f};
    int         effect_type{0};
    bool        require_interact{false};  // When true, player must press interact key
};

}  // namespace gseurat
