#pragma once

#include "gseurat/engine/collision_gen.hpp"

#include <cstdint>

namespace gseurat {

struct ProximityTrigger {
    float radius = 5.0f;
    bool one_shot = false;
    bool triggered = false;
    bool was_triggered = false;
};

struct EmitterToggle {
    uint32_t emitter_index = 0;
    bool active = false;
};

struct LightToggle {
    float color_r = 1.0f;
    float color_g = 1.0f;
    float color_b = 1.0f;
    float radius = 10.0f;
    float intensity = 1.0f;
    bool active = false;
};

struct EmissiveToggle {
    float emission = 2.0f;
    float color_r = 1.0f;
    float color_g = 1.0f;
    float color_b = 1.0f;
    float effect_radius = 3.0f;
    float current_emission = 0.0f;
    bool applied = false;
};

struct LinkedTrigger {
    uint32_t target_entity = 0;
    bool fired = false;
};

// Singleton: stores collision grid pointer for NPC systems.
struct CollisionGridRef {
    const CollisionGrid* grid = nullptr;
    float origin_x = 0.0f;
    float origin_z = 0.0f;
};

// Patrolling NPC — wanders randomly within patrol_radius of home position.
struct NpcWalker {
    float patrol_radius = 8.0f;
    float speed = 5.0f;
    float pause_duration = 2.0f;
    float home_x = 0.0f;
    float home_z = 0.0f;
    float target_x = 0.0f;
    float target_z = 0.0f;
    float pause_timer = 0.0f;
    bool initialized = false;
    bool paused = true;
};

// Marks the player entity for engine systems that need player position.
struct PlayerTag {};

}  // namespace gseurat
