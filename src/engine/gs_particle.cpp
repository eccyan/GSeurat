#include "gseurat/engine/gs_particle.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

// xorshift32 RNG (same pattern as existing ParticleSystem)
static uint32_t xorshift(uint32_t& state) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
}

float GaussianParticleEmitter::random_float(float min_val, float max_val) {
    float t = static_cast<float>(xorshift(rng_)) / static_cast<float>(0xFFFFFFFFu);
    return min_val + t * (max_val - min_val);
}

glm::vec3 GaussianParticleEmitter::random_vec3(const glm::vec3& min_val, const glm::vec3& max_val) {
    return {
        random_float(min_val.x, max_val.x),
        random_float(min_val.y, max_val.y),
        random_float(min_val.z, max_val.z),
    };
}

void GaussianParticleEmitter::configure(const GsEmitterConfig& config) {
    config_ = config;
}

void GaussianParticleEmitter::set_position(const glm::vec3& pos) {
    config_.position = pos;
}

void GaussianParticleEmitter::set_active(bool active) {
    active_ = active;
    if (active) {
        burst_elapsed_ = 0.0f;
    } else {
        spawn_accum_ = 0.0f;
    }
}

void GaussianParticleEmitter::spawn_particle() {
    auto& p = pool_[next_index_ % kMaxGsParticles];
    next_index_++;

    p.position = config_.position + random_vec3(config_.spawn_offset_min, config_.spawn_offset_max);
    p.velocity = random_vec3(config_.velocity_min, config_.velocity_max);
    p.acceleration = config_.acceleration;
    p.color_start = config_.color_start;
    p.color_end = config_.color_end;
    p.scale_start = random_vec3(config_.scale_min, config_.scale_max);
    p.scale_end = p.scale_start * config_.scale_end_factor;
    p.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    p.opacity_start = config_.opacity_start;
    p.opacity_end = config_.opacity_end;
    p.emission = config_.emission;
    p.lifetime = random_float(config_.lifetime_min, config_.lifetime_max);
    p.age = 0.0f;
    p.alive = true;
}

void GaussianParticleEmitter::update(float dt) {
    // Spawn new particles
    if (active_) {
        // Auto-deactivate after burst duration
        if (config_.burst_duration > 0.0f) {
            burst_elapsed_ += dt;
            if (burst_elapsed_ >= config_.burst_duration) {
                active_ = false;
            }
        }

        if (active_) {
            spawn_accum_ += config_.spawn_rate * dt;
            while (spawn_accum_ >= 1.0f) {
                spawn_particle();
                spawn_accum_ -= 1.0f;
            }
        }
    }

    // Update existing particles
    for (auto& p : pool_) {
        if (!p.alive) continue;

        p.age += dt;
        if (p.age >= p.lifetime) {
            p.alive = false;
            continue;
        }

        p.velocity += p.acceleration * dt;
        p.position += p.velocity * dt;
    }
}

uint32_t GaussianParticleEmitter::gather(std::vector<Gaussian>& out) const {
    uint32_t count = 0;
    for (const auto& p : pool_) {
        if (!p.alive) continue;

        float t = p.age / std::max(p.lifetime, 0.001f);
        t = std::clamp(t, 0.0f, 1.0f);

        Gaussian g{};
        g.position = p.position;
        g.scale = glm::mix(p.scale_start, p.scale_end, t);
        g.rotation = p.rotation;
        g.color = glm::mix(p.color_start, p.color_end, t);
        g.opacity = p.opacity_start + (p.opacity_end - p.opacity_start) * t;
        // Particles are always self-lit (bypass scene lighting).
        // Use at least a tiny emission so the shader skips lighting for them.
        g.emission = std::max(p.emission, 0.01f);
        g.bone_index = 0;
        g.importance = g.opacity * std::max({g.scale.x, g.scale.y, g.scale.z});

        out.push_back(g);
        count++;
    }
    return count;
}

void GaussianParticleEmitter::clear() {
    for (auto& p : pool_) p.alive = false;
    spawn_accum_ = 0.0f;
}

uint32_t GaussianParticleEmitter::alive_count() const {
    uint32_t n = 0;
    for (const auto& p : pool_) {
        if (p.alive) n++;
    }
    return n;
}

// --- Presets ---

GsEmitterConfig gs_preset_dust_puff() {
    GsEmitterConfig c;
    c.spawn_rate = 120.0f;
    c.lifetime_min = 1.0f;
    c.lifetime_max = 2.5f;
    c.velocity_min = {-3.0f, 1.0f, -3.0f};
    c.velocity_max = { 3.0f, 5.0f,  3.0f};
    c.acceleration = {0.0f, -2.0f, 0.0f};
    c.color_start = {0.6f, 0.55f, 0.45f};
    c.color_end = {0.5f, 0.48f, 0.4f};
    c.scale_min = {0.1f, 0.1f, 0.1f};
    c.scale_max = {0.3f, 0.3f, 0.3f};
    c.scale_end_factor = 0.1f;
    c.opacity_start = 0.4f;
    c.opacity_end = 0.0f;
    c.spawn_offset_min = {-2.0f, 0.0f, -2.0f};
    c.spawn_offset_max = { 2.0f, 1.0f,  2.0f};
    c.burst_duration = 0.3f;
    return c;
}

GsEmitterConfig gs_preset_spark_shower() {
    GsEmitterConfig c;
    c.spawn_rate = 40.0f;
    c.lifetime_min = 0.3f;
    c.lifetime_max = 0.8f;
    c.velocity_min = {-4.0f, 8.0f, -4.0f};
    c.velocity_max = { 4.0f, 15.0f, 4.0f};
    c.acceleration = {0.0f, -15.0f, 0.0f};
    c.color_start = {0.8f, 0.6f, 0.3f};
    c.color_end = {0.5f, 0.2f, 0.0f};
    c.scale_min = {0.05f, 0.05f, 0.05f};
    c.scale_max = {0.15f, 0.15f, 0.15f};
    c.scale_end_factor = 0.0f;
    c.opacity_start = 0.5f;
    c.opacity_end = 0.0f;
    c.emission = 0.8f;
    c.spawn_offset_min = {-1.0f, 0.0f, -1.0f};
    c.spawn_offset_max = { 1.0f, 1.0f,  1.0f};
    c.burst_duration = 0.5f;  // half-second burst then stop
    return c;
}

GsEmitterConfig gs_preset_magic_spiral() {
    GsEmitterConfig c;
    c.spawn_rate = 50.0f;
    c.lifetime_min = 1.5f;
    c.lifetime_max = 3.0f;
    c.velocity_min = {-2.0f, 3.0f, -2.0f};
    c.velocity_max = { 2.0f, 6.0f,  2.0f};
    c.acceleration = {0.0f, 0.5f, 0.0f};
    c.color_start = {0.4f, 0.6f, 1.0f};
    c.color_end = {0.8f, 0.3f, 1.0f};
    c.scale_min = {0.5f, 0.5f, 0.5f};
    c.scale_max = {1.0f, 1.0f, 1.0f};
    c.scale_end_factor = 0.3f;
    c.opacity_start = 0.9f;
    c.opacity_end = 0.0f;
    c.emission = 0.0f;
    c.spawn_offset_min = {-1.0f, -0.5f, -1.0f};
    c.spawn_offset_max = { 1.0f,  0.5f,  1.0f};
    c.burst_duration = 1.0f;
    return c;
}

}  // namespace gseurat
