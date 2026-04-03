#pragma once
#include <cstdint>

namespace gseurat {

struct PlayerController {
    float speed = 10.0f;
    float acceleration = 10.0f;
    float velocity_x = 0.0f;
    float velocity_z = 0.0f;
};

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
    bool applied = false;  // one-shot: add point light once triggered
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

struct LinkedTrigger {
    uint32_t target_entity = 0;
    bool fired = false;
};

// Triggers a GS animation effect on nearby Gaussians when player approaches.
// effect_name: "float", "orbit", "dissolve", "pulse", "vortex", "wave", "scatter"
struct AnimationTrigger {
    // Which effect to apply (matches GsAnimEffect names)
    // Stored as char array for trivially-copyable ECS requirement
    char effect_name[16] = "pulse";
    float anim_radius = 5.0f;   // radius of affected Gaussian region
    float lifetime = 3.0f;      // animation duration
    bool loop = false;           // restart when done
    bool fired = false;          // runtime state
};

// Hidden discovery zone — rewards exploration with a celebration burst.
// Places a multi-color fireworks particle effect + bright point light.
struct DiscoveryZone {
    float color_r = 1.0f;
    float color_g = 0.8f;
    float color_b = 0.2f;
    float burst_height = 8.0f;  // how high particles shoot
    bool discovered = false;
};

// Triggers a VFX instance (multi-element composition) on proximity.
struct VfxTrigger {
    char vfx_path[64] = "";
    bool fired = false;
};

}  // namespace gseurat
