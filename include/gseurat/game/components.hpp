#pragma once

#include "gseurat/engine/animation_state_machine.hpp"
#include "gseurat/engine/direction.hpp"
#include "gseurat/engine/ecs/types.hpp"

#include <glm/glm.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace gseurat::ecs {

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

struct NpcWaypoints {
    std::vector<glm::vec2> waypoints;       // target positions (world-space loop)
    uint32_t current_target = 0;
    std::vector<glm::vec2> path;            // computed A* path (tile centers)
    uint32_t path_index = 0;
    float pause_timer = 0.0f;
    float pause_duration = 1.0f;
    float speed = 1.5f;
    bool needs_repath = true;
};

struct ScriptRef {
    std::string module_name;
    std::string class_name;
};

}  // namespace gseurat::ecs
