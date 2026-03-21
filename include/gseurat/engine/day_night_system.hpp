#pragma once

#include <glm/glm.hpp>

#include <vector>

namespace gseurat {

class Scene;
class WeatherSystem;

struct DayNightKeyframe {
    float time;           // normalized [0,1]
    glm::vec4 ambient;    // ambient color at this time
    float torch_intensity; // torch light multiplier
};

struct DayNightConfig {
    bool enabled = false;
    float cycle_speed = 0.02f;  // cycles per second
    float initial_time = 0.35f; // start at mid-morning
    std::vector<DayNightKeyframe> keyframes;

    static std::vector<DayNightKeyframe> default_keyframes();
};

class DayNightSystem {
public:
    void init(const DayNightConfig& config);
    void reset();
    void update(float dt, Scene& scene, WeatherSystem* weather);

    float time_of_day() const { return time_; }
    void set_time_of_day(float t);
    float torch_intensity() const { return current_torch_intensity_; }
    bool active() const { return active_; }
    void set_paused(bool p) { paused_ = p; }
    void set_cycle_speed(float s) { cycle_speed_ = s; }

private:
    struct EvalResult {
        glm::vec4 ambient;
        float torch_intensity;
    };

    EvalResult evaluate(float t) const;

    std::vector<DayNightKeyframe> keyframes_;
    float time_ = 0.0f;
    float cycle_speed_ = 0.02f;
    float current_torch_intensity_ = 1.0f;
    bool active_ = false;
    bool paused_ = false;
};

}  // namespace gseurat
