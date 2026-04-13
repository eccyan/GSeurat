#pragma once

#include "gseurat/engine/camera_zone_system.hpp"
#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/game_state.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/types.hpp"
#include "gseurat/engine/world_streamer.hpp"
#include "gseurat/engine/ecs/types.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <array>
#include <chrono>
#include <memory>
#include <string>

namespace gseurat {

class Renderer;

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
    void step_pbd_chain(float dt);
    void gather_pbd_chain(Renderer& renderer);

    // Scene
    std::string scene_path_ = "assets/scenes/seurat_island.json";

    // Player entity
    ecs::Entity player_entity_ = ecs::kNullEntity;
    glm::vec3 player_velocity_{0.0f};
    float walk_anim_time_ = 0.0f;
    float env_anim_time_ = 0.0f;
    float facing_angle_ = 0.0f;  // character facing direction (independent of camera)
    glm::quat character_rotation_{1.0f, 0.0f, 0.0f, 0.0f};

    // Jump state (parabolic Y arc)
    bool jumping_ = false;
    float jump_time_ = 0.0f;
    static constexpr float kJumpDuration = 0.8f;  // matches jump clip duration
    static constexpr float kJumpHeight = 4.0f;    // peak height in world units

    // Character Gaussians (for walk animation bone transforms)
    bool character_spawned_ = false;
    uint32_t debug_frame_ = 0;
    glm::vec3 character_spawn_pos_{0.0f};  // where Gaussians were placed
    glm::vec3 character_origin_{0.0f};     // current player position
    float gs_scale_ = 1.0f;               // scene scale_multiplier (for bone coord conversion)
    std::vector<Gaussian> map_gaussians_;  // original map data before character merge

    // Player animation (managed via BoneAnimationRegistry)
    uint32_t player_registry_id_ = 0;

    // Base scene lights (saved at init, used as base for dynamic emissive lights)
    std::vector<PointLight> scene_lights_;

    // Collision grid (loaded from scene JSON)
    CollisionGrid collision_grid_;
    glm::vec2 grid_origin_{0.0f};  // world XZ origin

    // Northern Forest collision grid (separate zone, Z < 10)
    CollisionGrid forest_collision_grid_;
    glm::vec2 forest_grid_origin_{0.0f};
    bool forest_grid_loaded_ = false;

    // Camera zone system (data-driven camera volumes/triggers/rails)
    std::unique_ptr<CameraZoneSystem> camera_zone_system_;

    // World streaming
    std::unique_ptr<WorldStreamer> world_streamer_;

    // Orbit camera (third-person around player)
    float azimuth_ = 0.0f;
    float elevation_ = 0.6f;    // ~34 deg — higher angle reduces foreground Gaussian blobs
    float distance_ = 20.0f;   // pulled back for isometric overview
    glm::vec3 camera_target_{0.0f};  // smoothed target

    // Mouse drag state
    glm::vec2 last_mouse_{0.0f};
    bool dragging_ = false;

    // Debug HUD: OFF → COMPACT → FULL (Tab cycles)
    enum class HudMode { kOff, kCompact, kFull };
    HudMode hud_mode_ = HudMode::kOff;

    // Toggle flags (P = particles, N = animation, J = PBD chain)
    bool anim_enabled_ = true;
    bool pbd_chain_active_ = false;

    // CPU-side PBD chain simulation (J key demo)
    struct PbdNode {
        glm::vec3 position{0.0f};
        glm::vec3 prev_position{0.0f};
        glm::vec3 velocity{0.0f};
        float inv_mass = 0.0f;
    };
    struct PbdLink {
        uint32_t a = 0, b = 0;
        float rest_length = 3.0f;
        float stiffness = 0.8f;
    };
    static constexpr int kPbdNodeCount = 3;
    static constexpr int kPbdLinkCount = 2;
    static constexpr int kPbdIterations = 4;
    static constexpr float kPbdDamping = 0.98f;
    static constexpr float kPbdGravity = -9.8f;
    std::array<PbdNode, kPbdNodeCount> pbd_nodes_;
    std::array<PbdLink, kPbdLinkCount> pbd_links_;

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
    static constexpr float kPlayerSpeed = 20.0f;   // faster for island-scale exploration
    static constexpr float kPlayerAccel = 20.0f;
    static constexpr float kCameraSmoothing = 8.0f;
    static constexpr float kCameraYOffset = 2.5f;  // above character head for TPS
    static constexpr float kCharScale = 0.45f;     // character model scale (shared with spawn + animation)
};

}  // namespace gseurat
