#pragma once

#include "gseurat/engine/game_state.hpp"

#include <glm/vec3.hpp>
#include <array>
#include <string>
#include <vector>

namespace gseurat {

class StagingState : public GameState {
public:
    void on_enter(AppBase& app) override;
    void on_exit(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;

private:
    void draw_imgui(AppBase& app);
    void draw_viewport_info(AppBase& app);
    void draw_render_settings(AppBase& app);
    void draw_gs_params(AppBase& app);
    void draw_feature_toggles(AppBase& app);
    void draw_lighting(AppBase& app);
    void draw_camera_panel(AppBase& app);
    void draw_scene_panel(AppBase& app);
    void draw_performance(AppBase& app);

    // Camera orbit state
    float azimuth_ = 0.0f;
    float elevation_ = 0.3f;
    float distance_ = 100.0f;
    glm::vec3 target_{0.0f};
    bool camera_initialized_ = false;

    // Performance tracking
    float fps_ = 0.0f;
    float fps_timer_ = 0.0f;
    uint32_t frame_count_ = 0;
    std::array<float, 300> frame_times_{};
    int frame_time_idx_ = 0;

    // Mouse interaction
    bool dragging_ = false;
    double last_mouse_x_ = 0.0;
    double last_mouse_y_ = 0.0;

    // Scene management
    std::vector<std::string> scene_files_;
    int selected_scene_ = -1;
    bool scenes_loaded_ = false;

    // Panel visibility
    bool show_viewport_info_ = true;
    bool show_render_settings_ = true;
    bool show_gs_params_ = true;
    bool show_feature_toggles_ = true;
    bool show_lighting_ = true;
    bool show_camera_ = true;
    bool show_performance_ = true;
};

}  // namespace gseurat
