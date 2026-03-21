#include "gseurat/engine/gs_parallax_camera.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <algorithm>
#include <cmath>

namespace gseurat {

void GsParallaxCamera::configure(const glm::vec3& home_position,
                                  const glm::vec3& home_target,
                                  float fov, uint32_t width, uint32_t height,
                                  const GsParallaxConfig& config) {
    home_target_ = home_target;
    home_fov_ = fov;
    render_width_ = width;
    render_height_ = height;
    config_ = config;

    // Decompose home_position to spherical coords relative to home_target
    glm::vec3 offset = home_position - home_target;
    home_distance_ = glm::length(offset);
    if (home_distance_ < 0.001f) {
        home_distance_ = 100.0f;
        home_azimuth_ = 0.0f;
        home_elevation_ = 0.7f;
    } else {
        glm::vec3 dir = offset / home_distance_;
        home_elevation_ = std::asin(std::clamp(dir.y, -1.0f, 1.0f));
        home_azimuth_ = std::atan2(dir.x, dir.z);
    }

    // Initialize current state to home
    current_azimuth_ = home_azimuth_;
    current_elevation_ = home_elevation_;
    current_distance_ = home_distance_;
    current_target_ = home_target_;
}

void GsParallaxCamera::update(const glm::vec2& player_offset, float dt) {
    // Map player offset to target camera angles
    float target_azimuth = home_azimuth_
        + player_offset.x * config_.parallax_strength * config_.azimuth_range;

    // Elevation: offset from home based on player depth (y component)
    float el_range = config_.elevation_max - config_.elevation_min;
    float el_center = (config_.elevation_max + config_.elevation_min) * 0.5f;
    float target_elevation = el_center
        + player_offset.y * config_.parallax_strength * el_range * 0.5f;

    // Distance: subtle zoom based on combined offset magnitude
    float offset_mag = std::clamp(glm::length(player_offset), 0.0f, 1.0f);
    float target_distance = home_distance_ * (1.0f + offset_mag * config_.distance_range * 0.3f);

    // Clamp to allowed ranges
    target_azimuth = std::clamp(target_azimuth,
        home_azimuth_ - config_.azimuth_range,
        home_azimuth_ + config_.azimuth_range);
    target_elevation = std::clamp(target_elevation,
        config_.elevation_min, config_.elevation_max);
    target_distance = std::clamp(target_distance,
        home_distance_ * (1.0f - config_.distance_range),
        home_distance_ * (1.0f + config_.distance_range));

    // Smooth via exponential decay (~10x/sec)
    float smooth = 1.0f - std::exp(-10.0f * dt);
    current_azimuth_ += (target_azimuth - current_azimuth_) * smooth;
    current_elevation_ += (target_elevation - current_elevation_) * smooth;
    current_distance_ += (target_distance - current_distance_) * smooth;
    current_target_ += (home_target_ - current_target_) * smooth;
}

glm::mat4 GsParallaxCamera::view() const {
    // Reconstruct eye from spherical coords
    float cos_elev = std::cos(current_elevation_);
    float sin_elev = std::sin(current_elevation_);
    float cos_azi = std::cos(current_azimuth_);
    float sin_azi = std::sin(current_azimuth_);

    glm::vec3 offset(
        current_distance_ * cos_elev * sin_azi,
        current_distance_ * sin_elev,
        current_distance_ * cos_elev * cos_azi
    );
    glm::vec3 eye = current_target_ + offset;

    return glm::lookAt(eye, current_target_, glm::vec3(0.0f, 1.0f, 0.0f));
}

glm::mat4 GsParallaxCamera::proj() const {
    float aspect = static_cast<float>(render_width_) / static_cast<float>(render_height_);
    glm::mat4 p = glm::perspective(glm::radians(home_fov_), aspect, 0.1f, 1000.0f);
    p[1][1] *= -1.0f;  // Vulkan Y-flip
    return p;
}

}  // namespace gseurat
