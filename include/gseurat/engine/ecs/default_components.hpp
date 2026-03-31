#pragma once

#include "gseurat/engine/ecs/types.hpp"
#include "gseurat/engine/direction.hpp"

#include <glm/glm.hpp>

#include <string>

namespace gseurat::ecs {

struct Transform {
    glm::vec3 position{0.0f};
    glm::vec2 scale{1.0f, 1.0f};
};

struct Sprite {
    glm::vec4 tint{1.0f, 1.0f, 1.0f, 1.0f};
    glm::vec2 uv_min{0.0f, 0.0f};
    glm::vec2 uv_max{1.0f, 1.0f};
};

struct Facing {
    Direction dir = Direction::Down;
};


}  // namespace gseurat::ecs
