#pragma once

#include "vulkan_game/engine/game_state.hpp"

#include <glm/glm.hpp>

namespace vulkan_game {

class GsDemoState : public GameState {
public:
    void on_enter(App& app) override;
    void on_exit(App& app) override;
    void update(App& app, float dt) override;
    void build_draw_lists(App& app) override;

private:
    void update_camera(App& app, float dt);
    void reset_camera();

    // Orbit camera parameters
    float azimuth_ = 0.0f;          // horizontal angle (radians)
    float elevation_ = 0.7f;        // vertical angle (radians), ~40 degrees
    float distance_ = 250.0f;       // distance from target (sized for 256×224 maps)
    glm::vec3 target_{0.0f, 0.0f, 0.0f};

    // Mouse drag state
    glm::vec2 last_mouse_{0.0f};
    bool dragging_ = false;

    // Camera limits
    static constexpr float kMinElevation = 0.175f;  // ~10 degrees
    static constexpr float kMaxElevation = 1.396f;   // ~80 degrees
    static constexpr float kMinDistance = 10.0f;
    static constexpr float kMaxDistance = 500.0f;
    static constexpr float kPanSpeed = 80.0f;
    static constexpr float kOrbitSensitivity = 0.005f;
    static constexpr float kZoomSensitivity = 10.0f;
};

}  // namespace vulkan_game
