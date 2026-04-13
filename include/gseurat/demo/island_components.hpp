#pragma once

#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/bone_animated_component.hpp"

#include <cstdint>

namespace gseurat {

struct PlayerController {
    float speed = 10.0f;
    float acceleration = 10.0f;
    float velocity_x = 0.0f;
    float velocity_z = 0.0f;
};

struct BurstEffect {
    uint32_t emitter_index = 0;
    bool fired = false;
};

struct ScatterEffect {
    float radius = 2.0f;
    float lifetime = 2.0f;
    bool fired = false;
};

// Triggers a GS animation effect on nearby Gaussians when player approaches.
struct AnimationTrigger {
    char effect_name[16] = "pulse";
    float anim_radius = 5.0f;
    float lifetime = 3.0f;
    bool loop = false;
    bool fired = false;
};

// Hidden discovery zone — rewards exploration with a celebration burst.
struct DiscoveryZone {
    float color_r = 1.0f;
    float color_g = 0.8f;
    float color_b = 0.2f;
    float burst_height = 8.0f;
    bool discovered = false;
};

// Triggers a VFX instance (multi-element composition) on proximity.
struct VfxTrigger {
    char vfx_path[64] = "";
    bool fired = false;
};

}  // namespace gseurat
