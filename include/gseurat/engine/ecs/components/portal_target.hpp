#pragma once

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

struct PortalTarget {
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    glm::vec3   fade_color{1.0f};
    float       fade_duration{0.5f};
};

}  // namespace gseurat
