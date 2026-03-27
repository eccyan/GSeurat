#pragma once

#include "gseurat/engine/gaussian_cloud.hpp"

#include <cstdint>
#include <glm/glm.hpp>
#include <vector>

namespace gseurat {

enum class GsAnimEffect {
    Detach,    // break free, scatter outward + gravity, fade opacity
    Float,     // drift upward with horizontal noise, shrink scale
    Orbit,     // swirl around region center, stretch along velocity
    Dissolve,  // shrink to zero, fade opacity, slight drift
    Reform,    // reverse of dissolve — lerp back to original position
    Pulse,     // scale oscillates rhythmically (crystals, magic)
    Vortex,    // spiral inward/upward with tightening radius (tornado)
    Wave,      // sinusoidal ripple propagating from center (shockwave)
    Scatter,   // explosive outward burst (impacts, shattering)
};

struct GsAnimRegion {
    enum class Shape { Sphere, Box };
    Shape shape = Shape::Sphere;
    glm::vec3 center{0.0f};
    float radius = 5.0f;             // for Sphere
    glm::vec3 half_extents{5.0f};    // for Box
};

enum class GsEasing { Linear, EaseIn, EaseOut, EaseInOut };

float apply_easing(float t, GsEasing easing);

struct GsAnimParams {
    // Rotation (Orbit, Vortex)
    float rotations = 1.0f;                          // full rotations over lifetime
    GsEasing rotations_easing = GsEasing::Linear;

    // Spatial (Orbit, Vortex)
    float expansion = 1.0f;                           // radius multiplier at end (1=no change)
    GsEasing expansion_easing = GsEasing::Linear;
    float height_rise = 0.0f;                         // total Y offset at end (units)
    GsEasing height_easing = GsEasing::Linear;

    // Appearance (most effects)
    float opacity_end = 0.0f;                         // opacity at end (0=gone, 1=unchanged)
    GsEasing opacity_easing = GsEasing::Linear;
    float scale_end = 0.0f;                           // scale at end (0=vanish, 1=unchanged)
    GsEasing scale_easing = GsEasing::Linear;

    // Physics (Detach, Float, Scatter)
    float velocity = 1.0f;                            // initial velocity magnitude
    glm::vec3 gravity{0.0f, -9.8f, 0.0f};

    // Noise (Float, Dissolve, Wave)
    float noise = 1.0f;                               // wander/drift amplitude
    float wave_speed = 5.0f;                          // wave propagation speed

    // Pulse
    float pulse_frequency = 4.0f;                     // oscillation frequency
};

struct GsParticleState {
    glm::vec3 velocity{0.0f};
    glm::vec3 original_position{0.0f};
    glm::vec3 original_color{0.0f};
    glm::vec3 original_scale{0.0f};
    float original_opacity = 0.0f;
    float age = 0.0f;
    float lifetime = 3.0f;
    float phase = 0.0f;               // random per-Gaussian for variation
    bool active = false;
};

class GaussianAnimator {
public:
    // Tag Gaussians within a region for animation. Returns group ID.
    uint32_t tag_region(const std::vector<Gaussian>& gaussians,
                        const GsAnimRegion& region,
                        GsAnimEffect effect,
                        float lifetime = 3.0f,
                        const GsAnimParams& params = {});

    // Apply animations to the Gaussian buffer (modifies in place).
    // Indices refer to the active buffer provided.
    void update(float dt, std::vector<Gaussian>& gaussians);

    // Remove a specific group
    void remove_group(uint32_t group_id);

    // Clear all animation groups, restoring original state
    void clear(std::vector<Gaussian>& gaussians);

    bool has_active_groups() const;
    bool has_group(uint32_t group_id) const;

private:
    struct AnimGroup {
        uint32_t id = 0;
        GsAnimEffect effect;
        GsAnimParams params;
        std::vector<uint32_t> indices;       // indices into the Gaussian array
        std::vector<GsParticleState> states;
        float global_time = 0.0f;
        bool finished = false;
    };

    void apply_detach(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);
    void apply_float(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);
    void apply_orbit(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);
    void apply_dissolve(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);
    void apply_reform(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);
    void apply_pulse(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);
    void apply_vortex(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);
    void apply_wave(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);
    void apply_scatter(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt);

    std::vector<AnimGroup> groups_;
    uint32_t next_group_id_ = 1;
    uint32_t rng_ = 0xDEADBEEFu;
};

}  // namespace gseurat
