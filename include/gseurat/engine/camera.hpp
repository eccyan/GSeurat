#pragma once

#include <glm/glm.hpp>

namespace gseurat {

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

    // Camera shake
    void trigger_shake(float amplitude, float frequency = 15.0f, float duration = 0.4f);
    bool shake_active() const { return shake_.timer > 0.0f; }

    // Zoom control
    void set_target_zoom(float z);
    float zoom() const { return zoom_; }

    glm::mat4 view_projection() const;
    glm::mat4 view() const;
    glm::mat4 projection() const;

    glm::vec3 position() const { return position_; }
    glm::vec3 target() const { return target_; }
    float near_plane() const { return near_; }
    float far_plane() const { return far_; }

private:
    glm::vec3 position_;
    glm::vec3 target_;
    glm::vec3 up_;

    float fov_;
    float base_fov_ = 45.0f;
    float aspect_;
    float near_;
    float far_;

    glm::vec3 follow_target_{0.0f};
    float follow_speed_ = 5.0f;
    bool has_follow_target_ = false;

    // Shake state
    struct ShakeState {
        float amplitude = 0.0f;
        float frequency = 15.0f;
        float decay_rate = 8.0f;
        float timer = 0.0f;
        float phase_x = 0.0f;
        float phase_y = 0.0f;
    };
    ShakeState shake_;

    // Zoom state
    float zoom_ = 1.0f;
    float target_zoom_ = 1.0f;
};

}  // namespace gseurat
