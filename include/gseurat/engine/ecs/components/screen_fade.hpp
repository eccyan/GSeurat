#pragma once

#include <glm/glm.hpp>

namespace gseurat {

struct ScreenFade {
    glm::vec3 transition_color{1.0f};  // default white
    float     alpha{0.0f};             // 0 = transparent, 1 = fully covering
    int       effect_type{0};          // 0 = solid fade, 1 = left-to-right wipe
};

}  // namespace gseurat
