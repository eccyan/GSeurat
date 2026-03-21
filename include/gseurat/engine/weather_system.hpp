#pragma once

#include "gseurat/engine/particle.hpp"

#include <glm/glm.hpp>

namespace gseurat {

class Scene;

enum class WeatherType { Clear, Rain, Snow };

struct WeatherConfig {
    WeatherType type = WeatherType::Clear;
    EmitterConfig emitter;
    glm::vec4 ambient_override{0.2f, 0.22f, 0.35f, 1.0f};
    float fog_density = 0.0f;
    glm::vec3 fog_color{0.3f, 0.35f, 0.45f};
    float transition_speed = 1.0f;
};

class WeatherSystem {
public:
    void init(ParticleSystem& particles, Scene& scene, const WeatherConfig& config);
    void update(float dt, Scene& scene, const glm::vec2& camera_target);
    void reset();
    bool active() const { return active_; }
    float fog_density() const;
    glm::vec3 fog_color() const;
    float intensity() const { return intensity_; }
    void set_base_ambient(const glm::vec4& a) { base_ambient_ = a; }

private:
    WeatherConfig config_;
    size_t emitter_id_ = 0;
    ParticleSystem* particles_ = nullptr;
    float intensity_ = 0.0f;
    glm::vec4 base_ambient_{};
    bool active_ = false;
};

}  // namespace gseurat
