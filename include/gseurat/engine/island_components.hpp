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

}  // namespace gseurat
