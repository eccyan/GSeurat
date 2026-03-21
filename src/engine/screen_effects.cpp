#include "gseurat/engine/screen_effects.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

void ScreenEffects::trigger_flash(glm::vec3 color, float duration) {
    flash_color_ = color;
    flash_alpha_ = 1.0f;
    flash_duration_ = duration;
    flash_timer_ = 0.0f;
}

void ScreenEffects::trigger_chromatic_pulse(float intensity, float duration) {
    ca_pulse_ = intensity;
    ca_pulse_decay_ = (duration > 0.0f) ? (4.6f / duration) : 15.0f;
}

void ScreenEffects::set_chromatic_aberration(float intensity) {
    ca_persistent_ = intensity;
}

void ScreenEffects::update(float dt) {
    // Flash: linear fade-out
    if (flash_alpha_ > 0.0f) {
        flash_timer_ += dt;
        if (flash_duration_ > 0.0f) {
            flash_alpha_ = std::max(0.0f, 1.0f - flash_timer_ / flash_duration_);
        } else {
            flash_alpha_ = 0.0f;
        }
    }

    // CA pulse: exponential decay
    if (ca_pulse_ > 0.0001f) {
        ca_pulse_ *= std::exp(-ca_pulse_decay_ * dt);
        if (ca_pulse_ < 0.0001f) {
            ca_pulse_ = 0.0f;
        }
    }
}

float ScreenEffects::ca_intensity() const {
    return ca_persistent_ + ca_pulse_;
}

}  // namespace gseurat
