#include "gseurat/engine/weather_system.hpp"
#include "gseurat/engine/scene.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

void WeatherSystem::init(ParticleSystem& particles, Scene& scene, const WeatherConfig& config) {
    config_ = config;
    particles_ = &particles;
    active_ = (config_.type != WeatherType::Clear);
    intensity_ = 0.0f;
    base_ambient_ = scene.ambient_color();

    if (active_) {
        emitter_id_ = particles_->add_emitter(config_.emitter, {0.0f, 0.0f});
        particles_->set_emitter_active(emitter_id_, true);
    }
}

void WeatherSystem::update(float dt, Scene& scene, const glm::vec2& camera_target) {
    if (!active_) return;

    // Ramp intensity 0→1 over transition period
    if (intensity_ < 1.0f) {
        intensity_ += dt * config_.transition_speed;
        intensity_ = std::min(intensity_, 1.0f);
    }

    // Sync emitter position to camera so particles cover visible area
    particles_->set_emitter_position(emitter_id_, camera_target);

    // Lerp ambient color between base and weather override
    glm::vec4 ambient = glm::mix(base_ambient_, config_.ambient_override, intensity_);
    scene.set_ambient_color(ambient);

    // Update fog on scene
    scene.set_fog_density(config_.fog_density * intensity_);
    scene.set_fog_color(config_.fog_color);
}

void WeatherSystem::reset() {
    active_ = false;
    intensity_ = 0.0f;
    particles_ = nullptr;
    emitter_id_ = 0;
    base_ambient_ = {};
}

float WeatherSystem::fog_density() const {
    return active_ ? config_.fog_density * intensity_ : 0.0f;
}

glm::vec3 WeatherSystem::fog_color() const {
    return config_.fog_color;
}

}  // namespace gseurat
