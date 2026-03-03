#pragma once

#include <glm/glm.hpp>

namespace vulkan_game {

class Camera {
public:
    Camera();

    void set_perspective(float fov_degrees, float aspect, float near_plane, float far_plane);
    void set_position(glm::vec3 position);
    void set_target(glm::vec3 target);

    // HD-2D preset: 35° elevation, dist=12, perspective fov
    void configure_hd2d(float aspect);

    // Smooth camera follow
    void set_follow_target(glm::vec3 target);
    void set_follow_speed(float speed);
    void update(float dt);

    glm::mat4 view_projection() const;
    glm::mat4 view() const;
    glm::mat4 projection() const;

    glm::vec3 position() const { return position_; }
    glm::vec3 target() const { return target_; }

private:
    glm::vec3 position_;
    glm::vec3 target_;
    glm::vec3 up_;

    float fov_;
    float aspect_;
    float near_;
    float far_;

    glm::vec3 follow_target_{0.0f};
    float follow_speed_ = 5.0f;
    bool has_follow_target_ = false;
};

}  // namespace vulkan_game
