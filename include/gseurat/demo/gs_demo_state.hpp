#pragma once

#include "gseurat/engine/game_state.hpp"
#include "gseurat/engine/gs_chunk_streamer.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"

#include <glm/glm.hpp>
#include <chrono>

namespace gseurat {

class GsDemoState : public GameState {
public:
    void on_enter(AppBase& app) override;
    void on_exit(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;

private:
    void update_camera(AppBase& app, float dt);
    void update_shadow_box_camera(AppBase& app, float dt);
    void reset_camera();
    void enter_streaming_mode(AppBase& app);
    void update_streaming(AppBase& app);

    // Orbit camera parameters
    float azimuth_ = 0.0f;          // horizontal angle (radians)
    float elevation_ = 0.7f;        // vertical angle (radians), ~40 degrees
    float distance_ = 250.0f;       // distance from target (sized for 256x224 maps)
    glm::vec3 target_{0.0f, 0.0f, 0.0f};

    // Mouse drag state
    glm::vec2 last_mouse_{0.0f};
    bool dragging_ = false;

    // Shadow box mode
    bool shadow_box_mode_ = false;
    GsParallaxCamera parallax_cam_;

    // Hybrid re-render: full GS compute every N frames, cached blit in between
    uint32_t gs_frame_counter_ = 0;
    uint32_t gs_render_interval_ = 8;
    glm::vec2 last_compute_offset_{0.0f};

    // Adaptive interval tuning
    static constexpr float kTargetFps = 30.0f;
    static constexpr uint32_t kMinInterval = 1;
    static constexpr uint32_t kMaxInterval = 16;

    // Scale multiplier (adjusted with +/- keys)
    float scale_multiplier_ = 1.0f;

    // Visual effects
    float effect_time_ = 0.0f;
    bool fire_active_ = false;
    bool water_active_ = false;
    float touch_timer_ = 0.0f;       // seconds since touch, 0 = inactive
    static constexpr float kTouchDecay = 3.0f;  // seconds until touch fades

    // Wave 2 effects
    float explode_timer_ = 0.0f;     // 0=off, animates 0->1 over 3s
    bool voxel_active_ = false;
    float voxel_blend_ = 0.0f;       // smooth 0->1
    bool pulse_active_ = false;
    float xray_depth_ = 0.0f;        // 0=off, +20 per press, wraps at 300
    bool swirl_active_ = false;
    float swirl_blend_ = 0.0f;       // smooth 0->1
    float burn_timer_ = 0.0f;        // 0=off, animates 0->1 over 5s
    bool burn_fire_was_active_ = false;  // restore fire state after burn

    // FPS tracking (wall clock for accuracy despite dt clamping)
    std::chrono::steady_clock::time_point fps_clock_{};
    int fps_frame_count_ = 0;
    float fps_ = 0.0f;

    // Camera limits
    static constexpr float kMinElevation = 0.175f;  // ~10 degrees
    static constexpr float kMaxElevation = 1.396f;   // ~80 degrees
    static constexpr float kMinDistance = 10.0f;
    static constexpr float kMaxDistance = 500.0f;
    static constexpr float kPanSpeed = 80.0f;
    static constexpr float kOrbitSensitivity = 0.005f;
    static constexpr float kZoomSensitivity = 10.0f;

    // Streaming mode (M key)
    bool streaming_mode_ = false;
    GsChunkStreamer chunk_streamer_;
    std::string chunk_dir_;  // directory where chunk PLYs are written
};

}  // namespace gseurat
