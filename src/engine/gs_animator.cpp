#include "gseurat/engine/gs_animator.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

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
                                       float lifetime) {
    AnimGroup group;
    group.id = next_group_id_++;
    group.effect = effect;
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

        if (effect == GsAnimEffect::Detach) {
            state.velocity = dir * rand_float(rng_, 3.0f, 8.0f);
            state.velocity.y += rand_float(rng_, 2.0f, 5.0f);
        } else if (effect == GsAnimEffect::Float) {
            state.velocity = glm::vec3(
                rand_float(rng_, -0.5f, 0.5f),
                rand_float(rng_, 1.0f, 3.0f),
                rand_float(rng_, -0.5f, 0.5f));
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
    const glm::vec3 gravity{0.0f, -9.8f, 0.0f};
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        s.velocity += gravity * dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);

        auto& g = gaussians[idx];
        g.position = s.original_position + s.velocity * s.age;
        g.opacity = s.original_opacity * (1.0f - t);
        g.scale = s.original_scale * (1.0f - t * 0.5f);
        g.emission = 0.01f;  // self-lit: prevent scene lights from amplifying scattered Gaussians
    }
}

void GaussianAnimator::apply_float(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);

        auto& g = gaussians[idx];
        g.position = s.original_position + s.velocity * s.age;
        // Add gentle horizontal noise
        g.position.x += std::sin(s.age * 2.0f + s.phase) * 0.5f;
        g.position.z += std::cos(s.age * 1.5f + s.phase) * 0.5f;
        g.opacity = s.original_opacity * (1.0f - t);
        g.scale = s.original_scale * (1.0f - t * 0.7f);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::apply_orbit(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    // Find region center from first Gaussian's original position average
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

        // Rotate around center
        glm::vec3 rel = s.original_position - center;
        float angle = group.global_time * (2.0f + s.phase * 0.5f);
        float cs = std::cos(angle), sn = std::sin(angle);
        glm::vec3 rotated{rel.x * cs - rel.z * sn, rel.y + t * 5.0f, rel.x * sn + rel.z * cs};

        auto& g = gaussians[idx];
        g.position = center + rotated * (1.0f + t * 0.5f);
        g.opacity = s.original_opacity * (1.0f - t * 0.3f);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::apply_dissolve(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);

        auto& g = gaussians[idx];
        // Slight drift
        g.position = s.original_position + glm::vec3(
            std::sin(s.phase + s.age) * t * 2.0f,
            t * 1.0f,
            std::cos(s.phase + s.age) * t * 2.0f);
        g.scale = s.original_scale * (1.0f - t);
        g.opacity = s.original_opacity * (1.0f - t);
        g.emission = 0.01f;
    }
}

void GaussianAnimator::apply_reform(AnimGroup& group, std::vector<Gaussian>& gaussians, float dt) {
    for (size_t i = 0; i < group.indices.size(); ++i) {
        auto& s = group.states[i];
        if (!s.active || s.age >= s.lifetime) continue;
        uint32_t idx = group.indices[i];
        if (idx >= gaussians.size()) continue;

        s.age += dt;
        float t = std::clamp(s.age / s.lifetime, 0.0f, 1.0f);
        // Smooth ease-in-out
        float smooth_t = t * t * (3.0f - 2.0f * t);

        auto& g = gaussians[idx];
        g.position = glm::mix(g.position, s.original_position, smooth_t * dt * 3.0f);
        g.scale = glm::mix(g.scale, s.original_scale, smooth_t * dt * 3.0f);
        g.opacity = s.original_opacity * std::min(1.0f, t * 2.0f);
        g.color = glm::mix(g.color, s.original_color, smooth_t);
        // Reform restores emission to 0 gradually (back to scene-lit)
        g.emission = 0.01f * (1.0f - smooth_t);
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

}  // namespace gseurat
