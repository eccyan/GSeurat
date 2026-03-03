#pragma once

#include "vulkan_game/engine/animation_state_machine.hpp"
#include "vulkan_game/engine/direction.hpp"
#include "vulkan_game/engine/ecs/types.hpp"

#include <glm/glm.hpp>

namespace vulkan_game::ecs {

struct Transform {
    glm::vec3 position{0.0f};
    glm::vec2 scale{1.0f, 1.0f};
};

struct Sprite {
    glm::vec4 tint{1.0f, 1.0f, 1.0f, 1.0f};
    glm::vec2 uv_min{0.0f, 0.0f};
    glm::vec2 uv_max{1.0f, 1.0f};
};

struct PlayerTag {};

struct Facing {
    Direction dir = Direction::Down;
};

struct Animation {
    AnimationStateMachine state_machine;
};

struct NpcPatrol {
    Direction dir = Direction::Right;
    Direction reverse_dir = Direction::Left;
    float timer = 0.0f;
    float interval = 2.0f;
    float speed = 1.5f;
};

struct DialogRef {
    size_t dialog_index = 0;
};

struct DynamicLight {
    glm::vec4 color{1.0f, 1.0f, 1.0f, 0.8f};
    float radius = 3.0f;
};

struct ParticleEmitterRef {
    size_t emitter_id = 0;
};

struct FootstepEmitterRef {
    size_t emitter_id = 0;
};

}  // namespace vulkan_game::ecs
