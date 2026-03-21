#include "gseurat/engine/day_night_system.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/weather_system.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

std::vector<DayNightKeyframe> DayNightConfig::default_keyframes() {
    return {
        // Midnight — deep blue, torches full
        {0.00f, {0.08f, 0.08f, 0.18f, 1.0f}, 1.0f},
        // Pre-dawn — slightly lighter blue
        {0.20f, {0.12f, 0.12f, 0.25f, 1.0f}, 0.9f},
        // Dawn — warm orange horizon
        {0.25f, {0.45f, 0.30f, 0.20f, 1.0f}, 0.5f},
        // Morning — brightening
        {0.30f, {0.55f, 0.50f, 0.40f, 1.0f}, 0.3f},
        // Noon — bright daylight
        {0.50f, {0.85f, 0.85f, 0.80f, 1.0f}, 0.15f},
        // Afternoon — warm
        {0.65f, {0.65f, 0.55f, 0.40f, 1.0f}, 0.3f},
        // Dusk — orange-red
        {0.75f, {0.50f, 0.25f, 0.15f, 1.0f}, 0.5f},
        // Twilight — deep blue-purple
        {0.85f, {0.15f, 0.12f, 0.25f, 1.0f}, 0.85f},
        // Night — back to dark (wraps to midnight)
        {1.00f, {0.08f, 0.08f, 0.18f, 1.0f}, 1.0f},
    };
}

void DayNightSystem::init(const DayNightConfig& config) {
    active_ = config.enabled;
    cycle_speed_ = config.cycle_speed;
    time_ = config.initial_time;
    paused_ = false;

    if (config.keyframes.empty()) {
        keyframes_ = DayNightConfig::default_keyframes();
    } else {
        keyframes_ = config.keyframes;
        std::sort(keyframes_.begin(), keyframes_.end(),
            [](const DayNightKeyframe& a, const DayNightKeyframe& b) {
                return a.time < b.time;
            });
    }

    if (active_) {
        auto result = evaluate(time_);
        current_torch_intensity_ = result.torch_intensity;
    } else {
        current_torch_intensity_ = 1.0f;
    }
}

void DayNightSystem::reset() {
    active_ = false;
    time_ = 0.0f;
    cycle_speed_ = 0.02f;
    current_torch_intensity_ = 1.0f;
    paused_ = false;
    keyframes_.clear();
}

void DayNightSystem::set_time_of_day(float t) {
    time_ = t - std::floor(t);  // wrap to [0,1)
    if (active_) {
        auto result = evaluate(time_);
        current_torch_intensity_ = result.torch_intensity;
    }
}

void DayNightSystem::update(float dt, Scene& scene, WeatherSystem* weather) {
    if (!active_ || paused_) return;

    // Advance time
    time_ += cycle_speed_ * dt;
    time_ -= std::floor(time_);  // wrap to [0,1)

    auto result = evaluate(time_);
    current_torch_intensity_ = result.torch_intensity;

    // Set scene ambient
    scene.set_ambient_color(result.ambient);

    // If weather is active, update its base ambient so it lerps from our value
    if (weather) {
        weather->set_base_ambient(result.ambient);
    }
}

DayNightSystem::EvalResult DayNightSystem::evaluate(float t) const {
    if (keyframes_.empty()) {
        return {{0.5f, 0.5f, 0.5f, 1.0f}, 1.0f};
    }
    if (keyframes_.size() == 1) {
        return {keyframes_[0].ambient, keyframes_[0].torch_intensity};
    }

    // Clamp t to [0,1]
    t = std::max(0.0f, std::min(1.0f, t));

    // Find surrounding keyframes via binary search
    // Find last keyframe with time <= t
    size_t lo = 0;
    size_t hi = keyframes_.size() - 1;

    for (size_t i = 0; i < keyframes_.size() - 1; ++i) {
        if (keyframes_[i].time <= t && keyframes_[i + 1].time >= t) {
            lo = i;
            hi = i + 1;
            break;
        }
    }

    const auto& kf_a = keyframes_[lo];
    const auto& kf_b = keyframes_[hi];

    float range = kf_b.time - kf_a.time;
    if (range <= 0.0f) {
        return {kf_a.ambient, kf_a.torch_intensity};
    }

    float local_t = (t - kf_a.time) / range;
    // Smoothstep interpolation
    local_t = local_t * local_t * (3.0f - 2.0f * local_t);

    EvalResult result;
    result.ambient = glm::mix(kf_a.ambient, kf_b.ambient, local_t);
    result.torch_intensity = kf_a.torch_intensity + (kf_b.torch_intensity - kf_a.torch_intensity) * local_t;

    return result;
}

}  // namespace gseurat
