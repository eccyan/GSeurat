#pragma once

#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/game_state.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/ecs/types.hpp"

#include <glm/glm.hpp>
#include <chrono>
#include <string>

namespace gseurat {

class IslandDemoState : public GameState {
public:
    /// Optionally override the scene path (default: seurat_island.json).
    void set_scene_path(const std::string& path) { scene_path_ = path; }

    void on_enter(AppBase& app) override;
    void on_exit(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;

private:
    void update_player(AppBase& app, float dt);
    void update_camera(AppBase& app, float dt);
    void update_effects(AppBase& app, float dt);
    void update_walk_animation(AppBase& app, float dt);
    void update_environment_animation(AppBase& app, float dt);

    // Scene
    std::string scene_path_ = "assets/scenes/seurat_island.json";

    // Player entity
    ecs::Entity player_entity_ = ecs::kNullEntity;
    glm::vec3 player_velocity_{0.0f};
    float walk_anim_time_ = 0.0f;
    float env_anim_time_ = 0.0f;

    // Character Gaussians (for walk animation bone transforms)
    bool character_spawned_ = false;
    uint32_t debug_frame_ = 0;
    glm::vec3 character_spawn_pos_{0.0f};  // where Gaussians were placed
    glm::vec3 character_origin_{0.0f};     // current player position
    std::vector<Gaussian> map_gaussians_;  // original map data before character merge

    // Collision grid (loaded from scene JSON)
    CollisionGrid collision_grid_;
    glm::vec2 grid_origin_{0.0f};  // world XZ origin

    // Orbit camera (third-person around player)
    float azimuth_ = 0.0f;
    float elevation_ = 0.25f;   // ~14 deg — TPS behind-and-slightly-above (per CEO sketch)
    float distance_ = 8.0f;    // close TPS — character fills ~1/4 screen height
    glm::vec3 camera_target_{0.0f};  // smoothed target

    // Mouse drag state
    glm::vec2 last_mouse_{0.0f};
    bool dragging_ = false;

    // Debug HUD
    bool show_hud_ = false;

    // Toggle flags (P = particles, N = animation)
    bool anim_enabled_ = true;

    // FPS tracking
    std::chrono::steady_clock::time_point fps_clock_{};
    int fps_frame_count_ = 0;
    float fps_ = 0.0f;

    // Hybrid re-render
    uint32_t gs_frame_counter_ = 0;
    uint32_t gs_render_interval_ = 1;  // render every frame (no cached blit = no flickering/ghosts)

    // Constants
    static constexpr float kMinElevation = 0.1f;
    static constexpr float kMaxElevation = 1.0f;
    static constexpr float kMinDistance = 5.0f;
    static constexpr float kMaxDistance = 40.0f;
    static constexpr float kOrbitSensitivity = 0.005f;
    static constexpr float kZoomSensitivity = 2.0f;
    static constexpr float kPlayerSpeed = 12.0f;
    static constexpr float kPlayerAccel = 12.0f;
    static constexpr float kCameraSmoothing = 8.0f;
    static constexpr float kCameraYOffset = 2.5f;  // above character head for TPS
};

}  // namespace gseurat
