#pragma once

#include <glm/glm.hpp>

namespace gseurat {

struct ScreenFade {
    glm::vec3 color{1.0f};  // default white
    float     alpha{0.0f};  // 0 = transparent, 1 = fully covering
};

}  // namespace gseurat
