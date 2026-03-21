#include "gseurat/engine/camera.hpp"

#include <cmath>
#include <random>

#include <glm/gtc/matrix_transform.hpp>

namespace gseurat {

Camera::Camera()
    : position_(0.0f, 5.0f, 5.0f),
      target_(0.0f, 0.0f, 0.0f),
      up_(0.0f, 1.0f, 0.0f),
      fov_(45.0f),
      aspect_(16.0f / 9.0f),
      near_(0.1f),
      far_(100.0f) {}

void Camera::set_perspective(float fov_degrees, float aspect, float near_plane, float far_plane) {
    fov_ = fov_degrees;
    aspect_ = aspect;
    near_ = near_plane;
    far_ = far_plane;
}

void Camera::set_position(glm::vec3 position) {
    position_ = position;
}

void Camera::set_target(glm::vec3 target) {
    target_ = target;
}

void Camera::configure_hd2d(float aspect) {
    // 35° elevation, dist=12
    // sin(35°) ≈ 0.574 → y offset = 6.88
    // cos(35°) ≈ 0.819 → z offset = 9.83
    constexpr float kDist = 12.0f;
    constexpr float kElevDeg = 35.0f;
    const float elev_rad = glm::radians(kElevDeg);
    const float y_off = std::sin(elev_rad) * kDist;
    const float z_off = std::cos(elev_rad) * kDist;

    // Camera offset relative to target
    glm::vec3 offset(0.0f, y_off, z_off);
    target_ = glm::vec3(0.0f);
    position_ = target_ + offset;

    base_fov_ = 45.0f;
    set_perspective(45.0f, aspect, 0.1f, 100.0f);
}

void Camera::set_follow_target(glm::vec3 target) {
    follow_target_ = target;
    has_follow_target_ = true;
}

void Camera::set_follow_speed(float speed) {
    follow_speed_ = speed;
}

void Camera::trigger_shake(float amplitude, float frequency, float duration) {
    shake_.amplitude = amplitude;
    shake_.frequency = frequency;
    // Compute decay rate so amplitude reaches ~1% at end of duration
    shake_.decay_rate = (duration > 0.0f) ? (4.6f / duration) : 10.0f;
    shake_.timer = 0.0f;
    // Random phase offsets for natural feel
    static std::mt19937 rng{std::random_device{}()};
    std::uniform_real_distribution<float> dist(0.0f, 6.2831853f);
    shake_.phase_x = dist(rng);
    shake_.phase_y = dist(rng);
}

void Camera::set_target_zoom(float z) {
    target_zoom_ = z;
}

void Camera::update(float dt) {
    if (!has_follow_target_) return;

    // Compute current offset (camera pos relative to look target)
    glm::vec3 offset = position_ - target_;

    // Lerp target_ toward follow_target_ (frame-rate independent)
    float t = 1.0f - std::exp(-follow_speed_ * dt);
    target_ = glm::mix(target_, follow_target_, t);
    position_ = target_ + offset;

    // Camera shake
    if (shake_.amplitude > 0.0f) {
        shake_.timer += dt;
        constexpr float kTwoPi = 6.2831853f;
        float decay = std::exp(-shake_.decay_rate * shake_.timer);
        float shake_x = std::sin(shake_.timer * shake_.frequency * kTwoPi + shake_.phase_x)
                        * shake_.amplitude * decay;
        float shake_y = std::sin(shake_.timer * shake_.frequency * kTwoPi + shake_.phase_y)
                        * shake_.amplitude * decay;
        position_.x += shake_x;
        target_.x += shake_x;
        position_.y += shake_y;
        target_.y += shake_y;

        // Stop when amplitude is negligible
        if (decay < 0.01f) {
            shake_.amplitude = 0.0f;
        }
    }

    // Smooth zoom
    if (std::abs(zoom_ - target_zoom_) > 0.001f) {
        float zt = 1.0f - std::exp(-5.0f * dt);
        zoom_ = zoom_ + (target_zoom_ - zoom_) * zt;
        fov_ = base_fov_ / zoom_;
    }
}

glm::mat4 Camera::view() const {
    return glm::lookAt(position_, target_, up_);
}

glm::mat4 Camera::projection() const {
    return glm::perspective(glm::radians(fov_), aspect_, near_, far_);
}

glm::mat4 Camera::view_projection() const {
    return projection() * view();
}

}  // namespace gseurat
