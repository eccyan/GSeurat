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
    base_position_ = config.position;
    spline_time_ = 0.0f;
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

glm::vec3 GaussianParticleEmitter::sample_point_in_region(const GsAnimRegion& region) {
    if (region.shape == GsAnimRegion::Shape::Box) {
        return region.center + random_vec3(-region.half_extents, region.half_extents);
    }
    // Sphere: uniform volume sampling via cbrt for radial component
    float u = random_float(0.0f, 1.0f);
    float r = region.radius * std::cbrt(u);  // uniform volume distribution
    float theta = random_float(0.0f, 6.2831853f);
    float phi = std::acos(random_float(-1.0f, 1.0f));
    return region.center + glm::vec3(
        r * std::sin(phi) * std::cos(theta),
        r * std::cos(phi),
        r * std::sin(phi) * std::sin(theta));
}

void GaussianParticleEmitter::spawn_particle() {
    auto& p = pool_[next_index_ % kMaxGsParticles];
    next_index_++;

    p.position = config_.position + sample_point_in_region(config_.spawn_region);
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
    p.spline_t_offset = 0.0f;
    p.alive = true;

    // ParticlePath: particles spawn with region offset, then follow spline.
    // velocity stores the spawn region offset (reused each frame since v/a unused).
    if (config_.spline && config_.spline->mode == SplineMode::ParticlePath
        && config_.spline->path.valid()) {
        glm::vec3 region_offset = sample_point_in_region(config_.spawn_region);
        p.position = base_position_ + config_.spline->path.evaluate(0.0f) + region_offset;
        p.velocity = region_offset;  // stash region offset for per-frame use
        p.acceleration = glm::vec3(0.0f);
        if (config_.spline->path_spread > 0.0f) {
            p.spline_t_offset = random_float(-config_.spline->path_spread,
                                              config_.spline->path_spread);
        }
    }
}

void GaussianParticleEmitter::update(float dt) {
    // EmitterPath: move emitter position along spline
    if (config_.spline && config_.spline->mode == SplineMode::EmitterPath
        && config_.spline->path.valid()) {
        spline_time_ += config_.spline->emitter_speed * dt;
        spline_time_ = std::fmod(spline_time_, 1.0f);
        if (spline_time_ < 0.0f) spline_time_ += 1.0f;
        config_.position = base_position_ + config_.spline->path.evaluate(spline_time_);
    }

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
    bool particle_path = config_.spline
        && config_.spline->mode == SplineMode::ParticlePath
        && config_.spline->path.valid();

    for (auto& p : pool_) {
        if (!p.alive) continue;

        p.age += dt;
        if (p.age >= p.lifetime) {
            p.alive = false;
            continue;
        }

        if (particle_path) {
            // Particle follows spline: t maps age to full curve
            float t = p.age / std::max(p.lifetime, 0.001f);
            t = std::clamp(t, 0.0f, 1.0f);
            // p.velocity stores the spawn region offset (set at spawn time)
            glm::vec3 spline_pos = base_position_ + config_.spline->path.evaluate(t) + p.velocity;

            // Optional lateral spread perpendicular to tangent
            if (p.spline_t_offset != 0.0f) {
                glm::vec3 tan = config_.spline->path.tangent(t);
                float tan_len = glm::length(tan);
                if (tan_len > 0.001f) {
                    tan /= tan_len;
                    glm::vec3 up(0.0f, 1.0f, 0.0f);
                    glm::vec3 right = glm::cross(tan, up);
                    float right_len = glm::length(right);
                    if (right_len > 0.001f) {
                        right /= right_len;
                        spline_pos += right * p.spline_t_offset;
                    }
                }
            }
            p.position = spline_pos;
        } else {
            // Standard kinematic update
            p.velocity += p.acceleration * dt;
            p.position += p.velocity * dt;
        }
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

// Helper: convert old min/max offset to box region
static GsAnimRegion box_region_from_offsets(const glm::vec3& min, const glm::vec3& max) {
    GsAnimRegion r;
    r.shape = GsAnimRegion::Shape::Box;
    r.center = (min + max) * 0.5f;
    r.half_extents = (max - min) * 0.5f;
    return r;
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
    c.spawn_region = box_region_from_offsets({-2.0f, 0.0f, -2.0f}, {2.0f, 1.0f, 2.0f});
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
    c.spawn_region = box_region_from_offsets({-1.0f, 0.0f, -1.0f}, {1.0f, 1.0f, 1.0f});
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
    c.spawn_region = box_region_from_offsets({-1.0f, -0.5f, -1.0f}, {1.0f, 0.5f, 1.0f});
    c.burst_duration = 1.0f;
    return c;
}

GsEmitterConfig gs_preset_fire() {
    GsEmitterConfig c;
    c.spawn_rate = 80.0f;
    c.lifetime_min = 0.4f;
    c.lifetime_max = 1.2f;
    c.velocity_min = {-1.5f, 3.0f, -1.5f};
    c.velocity_max = { 1.5f, 8.0f,  1.5f};
    c.acceleration = {0.0f, 1.0f, 0.0f};
    c.color_start = {1.0f, 0.6f, 0.1f};
    c.color_end = {0.8f, 0.1f, 0.0f};
    c.scale_min = {0.2f, 0.2f, 0.2f};
    c.scale_max = {0.5f, 0.5f, 0.5f};
    c.scale_end_factor = 0.0f;
    c.opacity_start = 0.8f;
    c.opacity_end = 0.0f;
    c.emission = 1.5f;
    c.spawn_region = box_region_from_offsets({-0.5f, 0.0f, -0.5f}, {0.5f, 0.5f, 0.5f});
    c.burst_duration = 0.0f;
    return c;
}

GsEmitterConfig gs_preset_smoke() {
    GsEmitterConfig c;
    c.spawn_rate = 30.0f;
    c.lifetime_min = 2.0f;
    c.lifetime_max = 4.0f;
    c.velocity_min = {-0.5f, 1.0f, -0.5f};
    c.velocity_max = { 0.5f, 3.0f,  0.5f};
    c.acceleration = {0.0f, 0.3f, 0.0f};
    c.color_start = {0.4f, 0.4f, 0.42f};
    c.color_end = {0.3f, 0.3f, 0.32f};
    c.scale_min = {0.3f, 0.3f, 0.3f};
    c.scale_max = {0.8f, 0.8f, 0.8f};
    c.scale_end_factor = 2.0f;
    c.opacity_start = 0.5f;
    c.opacity_end = 0.0f;
    c.emission = 0.0f;
    c.spawn_region = box_region_from_offsets({-1.0f, 0.0f, -1.0f}, {1.0f, 0.5f, 1.0f});
    c.burst_duration = 0.0f;
    return c;
}

GsEmitterConfig gs_preset_rain() {
    GsEmitterConfig c;
    c.spawn_rate = 200.0f;
    c.lifetime_min = 0.5f;
    c.lifetime_max = 1.0f;
    c.velocity_min = {-0.5f, -20.0f, -0.5f};
    c.velocity_max = { 0.5f, -15.0f,  0.5f};
    c.acceleration = {0.0f, 0.0f, 0.0f};
    c.color_start = {0.7f, 0.75f, 0.9f};
    c.color_end = {0.5f, 0.55f, 0.8f};
    c.scale_min = {0.02f, 0.15f, 0.02f};
    c.scale_max = {0.03f, 0.25f, 0.03f};
    c.scale_end_factor = 1.0f;
    c.opacity_start = 0.4f;
    c.opacity_end = 0.1f;
    c.emission = 0.0f;
    c.spawn_region = box_region_from_offsets({-15.0f, 10.0f, -15.0f}, {15.0f, 15.0f, 15.0f});
    c.burst_duration = 0.0f;
    return c;
}

GsEmitterConfig gs_preset_snow() {
    GsEmitterConfig c;
    c.spawn_rate = 60.0f;
    c.lifetime_min = 3.0f;
    c.lifetime_max = 6.0f;
    c.velocity_min = {-1.0f, -2.0f, -1.0f};
    c.velocity_max = { 1.0f, -0.5f,  1.0f};
    c.acceleration = {0.0f, -0.1f, 0.0f};
    c.color_start = {0.95f, 0.95f, 1.0f};
    c.color_end = {0.9f, 0.9f, 0.95f};
    c.scale_min = {0.05f, 0.05f, 0.05f};
    c.scale_max = {0.15f, 0.15f, 0.15f};
    c.scale_end_factor = 0.5f;
    c.opacity_start = 0.7f;
    c.opacity_end = 0.0f;
    c.emission = 0.0f;
    c.spawn_region = box_region_from_offsets({-12.0f, 8.0f, -12.0f}, {12.0f, 12.0f, 12.0f});
    c.burst_duration = 0.0f;
    return c;
}

GsEmitterConfig gs_preset_leaves() {
    GsEmitterConfig c;
    c.spawn_rate = 15.0f;
    c.lifetime_min = 3.0f;
    c.lifetime_max = 6.0f;
    c.velocity_min = {-2.0f, -1.5f, -2.0f};
    c.velocity_max = { 2.0f, -0.5f,  2.0f};
    c.acceleration = {0.0f, -0.3f, 0.0f};
    c.color_start = {0.4f, 0.6f, 0.15f};
    c.color_end = {0.5f, 0.35f, 0.1f};
    c.scale_min = {0.1f, 0.02f, 0.1f};
    c.scale_max = {0.2f, 0.04f, 0.2f};
    c.scale_end_factor = 0.8f;
    c.opacity_start = 0.9f;
    c.opacity_end = 0.2f;
    c.emission = 0.0f;
    c.spawn_region = box_region_from_offsets({-8.0f, 5.0f, -8.0f}, {8.0f, 10.0f, 8.0f});
    c.burst_duration = 0.0f;
    return c;
}

GsEmitterConfig gs_preset_fireflies() {
    GsEmitterConfig c;
    c.spawn_rate = 8.0f;
    c.lifetime_min = 3.0f;
    c.lifetime_max = 7.0f;
    c.velocity_min = {-0.5f, -0.3f, -0.5f};
    c.velocity_max = { 0.5f,  0.5f,  0.5f};
    c.acceleration = {0.0f, 0.0f, 0.0f};
    c.color_start = {0.8f, 1.0f, 0.3f};
    c.color_end = {0.6f, 0.9f, 0.2f};
    c.scale_min = {0.03f, 0.03f, 0.03f};
    c.scale_max = {0.06f, 0.06f, 0.06f};
    c.scale_end_factor = 0.5f;
    c.opacity_start = 0.8f;
    c.opacity_end = 0.0f;
    c.emission = 1.0f;
    c.spawn_region = box_region_from_offsets({-6.0f, 0.5f, -6.0f}, {6.0f, 4.0f, 6.0f});
    c.burst_duration = 0.0f;
    return c;
}

GsEmitterConfig gs_preset_steam() {
    GsEmitterConfig c;
    c.spawn_rate = 40.0f;
    c.lifetime_min = 0.5f;
    c.lifetime_max = 1.5f;
    c.velocity_min = {-0.8f, 2.0f, -0.8f};
    c.velocity_max = { 0.8f, 5.0f,  0.8f};
    c.acceleration = {0.0f, 0.5f, 0.0f};
    c.color_start = {0.9f, 0.9f, 0.92f};
    c.color_end = {0.85f, 0.85f, 0.88f};
    c.scale_min = {0.15f, 0.15f, 0.15f};
    c.scale_max = {0.4f, 0.4f, 0.4f};
    c.scale_end_factor = 2.5f;
    c.opacity_start = 0.4f;
    c.opacity_end = 0.0f;
    c.emission = 0.0f;
    c.spawn_region = box_region_from_offsets({-0.5f, 0.0f, -0.5f}, {0.5f, 0.3f, 0.5f});
    c.burst_duration = 0.0f;
    return c;
}

GsEmitterConfig gs_preset_waterfall_mist() {
    GsEmitterConfig c;
    c.spawn_rate = 100.0f;
    c.lifetime_min = 1.0f;
    c.lifetime_max = 2.5f;
    c.velocity_min = {-4.0f, 0.5f, -4.0f};
    c.velocity_max = { 4.0f, 3.0f,  4.0f};
    c.acceleration = {0.0f, -1.0f, 0.0f};
    c.color_start = {0.75f, 0.8f, 0.95f};
    c.color_end = {0.7f, 0.75f, 0.9f};
    c.scale_min = {0.1f, 0.1f, 0.1f};
    c.scale_max = {0.3f, 0.3f, 0.3f};
    c.scale_end_factor = 1.5f;
    c.opacity_start = 0.35f;
    c.opacity_end = 0.0f;
    c.emission = 0.0f;
    c.spawn_region = box_region_from_offsets({-3.0f, -0.5f, -3.0f}, {3.0f, 1.0f, 3.0f});
    c.burst_duration = 0.0f;
    return c;
}

std::optional<GsEmitterConfig> gs_resolve_preset(const std::string& name) {
    if (name == "dust_puff")       return gs_preset_dust_puff();
    if (name == "spark_shower")    return gs_preset_spark_shower();
    if (name == "magic_spiral")    return gs_preset_magic_spiral();
    if (name == "fire")            return gs_preset_fire();
    if (name == "smoke")           return gs_preset_smoke();
    if (name == "rain")            return gs_preset_rain();
    if (name == "snow")            return gs_preset_snow();
    if (name == "leaves")          return gs_preset_leaves();
    if (name == "fireflies")       return gs_preset_fireflies();
    if (name == "steam")           return gs_preset_steam();
    if (name == "waterfall_mist")  return gs_preset_waterfall_mist();
    return std::nullopt;
}

}  // namespace gseurat
