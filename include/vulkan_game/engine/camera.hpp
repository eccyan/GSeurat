#pragma once

#include <glm/glm.hpp>

namespace vulkan_game {

class Camera {
public:
    Camera();

    void set_perspective(float fov_degrees, float aspect, float near_plane, float far_plane);
    void set_position(glm::vec3 position);
    void set_target(glm::vec3 target);

    glm::mat4 view_projection() const;
    glm::mat4 view() const;
    glm::mat4 projection() const;

private:
    glm::vec3 position_;
    glm::vec3 target_;
    glm::vec3 up_;

    float fov_;
    float aspect_;
    float near_;
    float far_;
};

}  // namespace vulkan_game
