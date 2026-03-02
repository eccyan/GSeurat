#include "vulkan_game/engine/camera.hpp"

#include <glm/gtc/matrix_transform.hpp>

namespace vulkan_game {

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

glm::mat4 Camera::view() const {
    return glm::lookAt(position_, target_, up_);
}

glm::mat4 Camera::projection() const {
    return glm::perspective(glm::radians(fov_), aspect_, near_, far_);
}

glm::mat4 Camera::view_projection() const {
    return projection() * view();
}

}  // namespace vulkan_game
