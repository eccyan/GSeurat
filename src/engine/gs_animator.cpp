#include "gseurat/engine/gs_animator.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

float apply_easing(float t, GsEasing easing) {
    t = std::clamp(t, 0.0f, 1.0f);
    switch (easing) {
        case GsEasing::EaseIn:    return t * t;
        case GsEasing::EaseOut:   return 1.0f - (1.0f - t) * (1.0f - t);
        case GsEasing::EaseInOut: return t * t * (3.0f - 2.0f * t);
        default:                  return t;
    }
}

static uint32_t xorshift(uint32_t& state) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
}

static float rand_float(uint32_t& rng, float lo, float hi) {
    float t = static_cast<float>(xorshift(rng)) / static_cast<float>(0xFFFFFFFFu);
    return lo + t * (hi - lo);
}

static bool in_sphere(const glm::vec3& pos, const glm::vec3& center, float radius) {
    return glm::length(pos - center) <= radius;
}

static bool in_box(const glm::vec3& pos, const glm::vec3& center, const glm::vec3& half) {
    glm::vec3 d = glm::abs(pos - center);
    return d.x <= half.x && d.y <= half.y && d.z <= half.z;
}

uint32_t GaussianAnimator::tag_region(const std::vector<Gaussian>& gaussians,
                                       const GsAnimRegion& region,
                                       GsAnimEffect effect,
                                       float lifetime,
                                       const GsAnimParams& params) {
    AnimGroup group;
    group.id = next_group_id_++;
    group.effect = effect;
    group.params = params;
    group.global_time = 0.0f;

    for (uint32_t i = 0; i < static_cast<uint32_t>(gaussians.size()); ++i) {
        const auto& g = gaussians[i];
        bool hit = (region.shape == GsAnimRegion::Shape::Sphere)
                       ? in_sphere(g.position, region.center, region.radius)
                       : in_box(g.position, region.center, region.half_extents);
        if (!hit) continue;

        GsParticleState state;
        state.original_position = g.position;
        state.original_color = g.color;
        state.original_scale = g.scale;
        state.original_opacity = g.opacity;
        state.age = 0.0f;
        state.lifetime = lifetime;
        state.phase = rand_float(rng_, 0.0f, 6.2831f);
        state.active = true;

        // Initialize velocity for Detach/Float
        glm::vec3 dir = g.position - region.center;
        float len = glm::length(dir);
        if (len > 0.001f) dir /= len;
        else dir = glm::vec3(0.0f, 1.0f, 0.0f);

        float v = params.velocity;
        if (effect == GsAnimEffect::Scatter) {
            state.velocity = dir * rand_float(rng_, 10.0f * v, 25.0f * v);
            state.velocity += glm::vec3(
                rand_float(rng_, -5.0f * v, 5.0f * v),
                rand_float(rng_, 5.0f * v, 15.0f * v),
                rand_float(rng_, -5.0f * v, 5.0f * v));
        } else if (effect == GsAnimEffect::Detach) {
            state.velocity = dir * rand_float(rng_, 3.0f * v, 8.0f * v);
            state.velocity.y += rand_float(rng_, 2.0f * v, 5.0f * v);
        } else if (effect == GsAnimEffect::Float) {
            state.velocity = glm::vec3(
                rand_float(rng_, -0.5f * v, 0.5f * v),
                rand_float(rng_, 1.0f * v, 3.0f * v),
                rand_float(rng_, -0.5f * v, 0.5f * v));
        } else {
            state.velocity = glm::vec3(0.0f);
        }

        group.indices.push_back(i);
        group.states.push_back(state);
    }

    if (group.indices.empty()) return 0;

    uint32_t id = group.id;
    groups_.push_back(std::move(group));
    return id;
}

void GaussianAnimator::update(float dt, std::vector<Gaussian>& gaussians) {
    for (auto& group : groups_) {
        if (group.finished) continue;
        group.global_time += dt;

        switch (group.effect) {
            case GsAnimEffect::Detach:  apply_detach(group, gaussians, dt); break;
            case GsAnimEffect::Float:   apply_float(group, gaussians, dt); break;
            case GsAnimEffect::Orbit:   apply_orbit(group, gaussians, dt); break;
            case GsAnimEffect::Dissolve: apply_dissolve(group, gaussians, dt); break;
            case GsAnimEffect::Reform:  apply_reform(group, gaussians, dt); break;
            case GsAnimEffect::Pulse:   apply_pulse(group, gaussians, dt); break;
            case GsAnimEffect::Vortex:  apply_vortex(group, gaussians, dt); break;
            case GsAnimEffect::Wave:    apply_wave(group, gaussians, dt); break;
            case GsAnimEffect::Scatter: apply_scatter(group, gaussians, dt); break;
        }

        // Check if all states have expired
        bool all_done = true;
        for (const auto& s : group.states) {
            if (s.active && s.age < s.lifetime) { all_done = false; break; }
        }
        if (all_done) group.finished = true;
    }

    // Remove finished groups
    groups_.erase(
        std::remove_if(groups_.begin(), groups_.end(),
                        [](const AnimGroup& g) { return g.finished; }),
        groups_.end());
}

void GaussianAnimator::apply_detach(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        s.velocity += p.gravity * dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);
        float t_opacity = apply_easing(t, p.opacity_easing);
        float t_scale = apply_easing(t, p.scale_easing);

        auto& g = gaussians[idx];
        g.position = s.original_position + s.velocity * s.age;
        g.opacity = s.original_opacity * glm::mix(1.0f, p.opacity_end, t_opacity);
        g.scale = s.original_scale * glm::mix(1.0f, p.scale_end, t_scale);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::apply_float(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);
        float t_opacity = apply_easing(t, p.opacity_easing);
        float t_scale = apply_easing(t, p.scale_easing);

        auto& g = gaussians[idx];
        g.position = s.original_position + s.velocity * s.age;
        float na = 0.5f * p.noise;
        g.position.x += std::sin(s.age * 2.0f + s.phase) * na;
        g.position.z += std::cos(s.age * 1.5f + s.phase) * na;
        g.opacity = s.original_opacity * glm::mix(1.0f, p.opacity_end, t_opacity);
        g.scale = s.original_scale * glm::mix(1.0f, p.scale_end, t_scale);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::apply_orbit(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    glm::vec3 center{0.0f};
    for (const auto& s : group.states) center += s.original_position;
    if (!group.states.empty()) center /= static_cast<float>(group.states.size());

    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);
        float t_rot = apply_easing(t, p.rotations_easing);
        float t_exp = apply_easing(t, p.expansion_easing);
        float t_height = apply_easing(t, p.height_easing);
        float t_opacity = apply_easing(t, p.opacity_easing);

        glm::vec3 rel = s.original_position - center;
        float angle = t_rot * p.rotations * 6.2831853f + s.phase;  // 2*PI * rotations
        float cs = std::cos(angle), sn = std::sin(angle);
        float radius_scale = glm::mix(1.0f, p.expansion, t_exp);
        float y_offset = t_height * p.height_rise;

        auto& g = gaussians[idx];
        g.position = center + glm::vec3(
            (rel.x * cs - rel.z * sn) * radius_scale,
            rel.y + y_offset,
            (rel.x * sn + rel.z * cs) * radius_scale);
        g.opacity = s.original_opacity * glm::mix(1.0f, p.opacity_end, t_opacity);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::apply_dissolve(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);
        float t_opacity = apply_easing(t, p.opacity_easing);
        float t_scale = apply_easing(t, p.scale_easing);

        auto& g = gaussians[idx];
        float na = p.noise;
        g.position = s.original_position + glm::vec3(
            std::sin(s.phase + s.age) * t * 2.0f * na,
            t * 1.0f * na,
            std::cos(s.phase + s.age) * t * 2.0f * na);
        g.scale = s.original_scale * glm::mix(1.0f, p.scale_end, t_scale);
        g.opacity = s.original_opacity * glm::mix(1.0f, p.opacity_end, t_opacity);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::apply_reform(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);
        float smooth_t = t * t * (3.0f - 2.0f * t);

        auto& g = gaussians[idx];
        float lerp_rate = smooth_t * dt * 3.0f * p.velocity;
        g.position = glm::mix(g.position, s.original_position, lerp_rate);
        g.scale = glm::mix(g.scale, s.original_scale, lerp_rate);
        g.opacity = s.original_opacity * std::min(1.0f, t * 2.0f);
        g.color = glm::mix(g.color, s.original_color, smooth_t);
        g.emission = 0.01f * (1.0f - smooth_t);
    }
}

void GaussianAnimator::apply_pulse(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float wave = std::sin(s.age * p.pulse_frequency + s.phase) * 0.5f + 0.5f;  // 0..1
        float scale_factor = glm::mix(1.0f, p.scale_end, wave);

        auto& g = gaussians[idx];
        g.position = s.original_position;
        g.scale = s.original_scale * std::max(scale_factor, 0.01f);
        g.opacity = s.original_opacity * glm::mix(1.0f, p.opacity_end, wave);
        g.color = s.original_color;
    }
}

void GaussianAnimator::apply_vortex(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    glm::vec3 center{0.0f};
    for (const auto& s : group.states) center += s.original_position;
    if (!group.states.empty()) center /= static_cast<float>(group.states.size());

    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);
        float t_rot = apply_easing(t, p.rotations_easing);
        float t_exp = apply_easing(t, p.expansion_easing);
        float t_height = apply_easing(t, p.height_easing);
        float t_opacity = apply_easing(t, p.opacity_easing);
        float t_scale = apply_easing(t, p.scale_easing);

        glm::vec3 rel = s.original_position - center;
        float angle = t_rot * p.rotations * 6.2831853f + s.phase;
        float cs = std::cos(angle), sn = std::sin(angle);
        // Vortex contracts inward (expansion < 1 contracts)
        float contract = glm::mix(1.0f, p.expansion, t_exp);

        auto& g = gaussians[idx];
        g.position = center + glm::vec3(
            (rel.x * cs - rel.z * sn) * contract,
            rel.y + t_height * p.height_rise,
            (rel.x * sn + rel.z * cs) * contract);
        g.opacity = s.original_opacity * glm::mix(1.0f, p.opacity_end, t_opacity);
        g.scale = s.original_scale * glm::mix(1.0f, p.scale_end, t_scale);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::apply_wave(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    glm::vec3 center{0.0f};
    for (const auto& s : group.states) center += s.original_position;
    if (!group.states.empty()) center /= static_cast<float>(group.states.size());

    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        glm::vec3 rel = s.original_position - center;
        float dist = std::sqrt(rel.x * rel.x + rel.z * rel.z);
        float freq = 3.0f;
        float y_offset = std::sin(dist * freq - group.global_time * p.wave_speed + s.phase * 0.2f) * p.noise;

        auto& g = gaussians[idx];
        g.position = s.original_position + glm::vec3(0.0f, y_offset, 0.0f);
        g.scale = s.original_scale;
        g.opacity = s.original_opacity;
        g.color = s.original_color;
    }
}

void GaussianAnimator::apply_scatter(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    const auto& p = group.params;
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        s.velocity += p.gravity * dt * 0.3f;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);
        float t_opacity = apply_easing(t, p.opacity_easing);
        float t_scale = apply_easing(t, p.scale_easing);

        auto& g = gaussians[idx];
        g.position = s.original_position + s.velocity * s.age;
        g.opacity = s.original_opacity * glm::mix(1.0f, p.opacity_end, t_opacity);
        g.scale = s.original_scale * glm::mix(1.0f, p.scale_end, t_scale);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::remove_group(uint32_t group_id) {
    groups_.erase(
        std::remove_if(groups_.begin(), groups_.end(),
                        [group_id](const AnimGroup& g) { return g.id == group_id; }),
        groups_.end());
}

void GaussianAnimator::clear(std::vector<Gaussian>& gaussians) {
    // Restore original state for all active groups
    for (auto& group : groups_) {
        for (size_t i = 0; i < group.indices.size(); ++i) {
            uint32_t idx = group.indices[i];
            if (idx >= gaussians.size()) continue;
            const auto& s = group.states[i];
            gaussians[idx].position = s.original_position;
            gaussians[idx].color = s.original_color;
            gaussians[idx].scale = s.original_scale;
            gaussians[idx].opacity = s.original_opacity;
        }
    }
    groups_.clear();
}

bool GaussianAnimator::has_active_groups() const {
    return !groups_.empty();
}

bool GaussianAnimator::has_group(uint32_t group_id) const {
    for (const auto& g : groups_) {
        if (g.id == group_id) return true;
    }
    return false;
}

}  // namespace gseurat
