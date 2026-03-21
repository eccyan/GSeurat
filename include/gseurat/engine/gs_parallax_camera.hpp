#pragma once

#include "gseurat/engine/scene_loader.hpp"

#include <glm/glm.hpp>
#include <cstdint>

namespace gseurat {

class GsParallaxCamera {
public:
    void configure(const glm::vec3& home_position, const glm::vec3& home_target,
                   float fov, uint32_t width, uint32_t height,
                   const GsParallaxConfig& config);

    // player_offset is normalized [-1,1] from map center
    void update(const glm::vec2& player_offset, float dt);

    glm::mat4 view() const;
    glm::mat4 proj() const;

private:
    // Home pose (decomposed to spherical)
    glm::vec3 home_target_{0.0f};
    float home_azimuth_ = 0.0f;
    float home_elevation_ = 0.7f;
    float home_distance_ = 100.0f;
    float home_fov_ = 45.0f;
    uint32_t render_width_ = 320;
    uint32_t render_height_ = 240;
    GsParallaxConfig config_;

    // Smoothed current state
    float current_azimuth_ = 0.0f;
    float current_elevation_ = 0.7f;
    float current_distance_ = 100.0f;
    glm::vec3 current_target_{0.0f};
};

}  // namespace gseurat
