#pragma once

#include <glm/glm.hpp>

namespace gseurat {

class ScreenEffects {
public:
    void trigger_flash(glm::vec3 color = {1.0f, 1.0f, 1.0f}, float duration = 0.15f);
    void trigger_chromatic_pulse(float intensity = 0.008f, float duration = 0.3f);
    void set_chromatic_aberration(float intensity);
    void update(float dt);

    glm::vec3 flash_color() const { return flash_color_; }
    float flash_alpha() const { return flash_alpha_; }
    float ca_intensity() const;

private:
    // Flash state
    glm::vec3 flash_color_{1.0f};
    float flash_alpha_ = 0.0f;
    float flash_duration_ = 0.0f;
    float flash_timer_ = 0.0f;

    // Chromatic aberration state
    float ca_persistent_ = 0.0f;
    float ca_pulse_ = 0.0f;
    float ca_pulse_decay_ = 10.0f;
};

}  // namespace gseurat
