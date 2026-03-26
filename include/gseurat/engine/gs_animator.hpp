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
};

struct GsAnimRegion {
    enum class Shape { Sphere, Box };
    Shape shape = Shape::Sphere;
    glm::vec3 center{0.0f};
    float radius = 5.0f;             // for Sphere
    glm::vec3 half_extents{5.0f};    // for Box
};

struct GsAnimParams {
    float speed = 1.0f;             // time multiplier (scales dt)
    glm::vec3 gravity{0.0f, -9.8f, 0.0f};  // gravity vector (Detach)
    float velocity_scale = 1.0f;    // scales initial velocity (Detach/Float)
    float noise_amplitude = 1.0f;   // horizontal wander scale (Float/Dissolve)
    float orbit_speed = 1.0f;       // rotation speed multiplier (Orbit)
    float expansion = 1.0f;         // radius growth scale (Orbit)
    float opacity_fade = 1.0f;      // 0=no fade, 1=full fade to 0
    float scale_shrink = 1.0f;      // 0=no shrink, 1=full shrink
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

    std::vector<AnimGroup> groups_;
    uint32_t next_group_id_ = 1;
    uint32_t rng_ = 0xDEADBEEFu;
};

}  // namespace gseurat
