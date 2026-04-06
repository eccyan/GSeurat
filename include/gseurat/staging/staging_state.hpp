#pragma once

#include "gseurat/engine/game_state.hpp"
#include "gseurat/character/character_manifest.hpp"
#include "gseurat/character/bone_animation_player.hpp"

#include <glm/vec3.hpp>
#include <glm/mat4x4.hpp>
#include <array>
#include <memory>
#include <string>
#include <vector>

namespace gseurat {

struct CameraBookmark {
    std::string name;
    float azimuth;
    float elevation;
    float distance;
    glm::vec3 target;
};

class StagingState : public GameState {
public:
    void on_enter(AppBase& app) override;
    void on_exit(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;

    // Load character manifest for animation preview
    void load_character(const std::string& manifest_path, AppBase& app);

    // 3D → 2D projection (public for gizmo helpers)
    bool project_to_screen(const glm::vec3& world_pos, const glm::mat4& vp,
                           float screen_w, float screen_h,
                           float& out_x, float& out_y) const;

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
    void draw_gizmos(AppBase& app);
    void draw_character_panel(AppBase& app);

    // Camera orbit state
    float azimuth_ = 0.0f;
    float elevation_ = 0.3f;
    float distance_ = 100.0f;
    glm::vec3 target_{0.0f};
    bool camera_initialized_ = false;
    glm::mat4 gs_vp_{1.0f};  // cached view-projection matrix (computed in update)

    // Animation time (drives PBD wind sway)
    float anim_time_ = 0.0f;

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

    // Camera bookmarks
    std::vector<CameraBookmark> bookmarks_;

    // Panel visibility
    bool show_viewport_info_ = true;
    bool show_render_settings_ = true;
    bool show_gs_params_ = true;
    bool show_feature_toggles_ = true;
    bool show_lighting_ = true;
    bool show_camera_ = true;
    bool show_performance_ = true;

    // Gizmo visibility
    bool show_gizmo_lights_ = true;
    bool show_gizmo_emitters_ = true;
    bool show_gizmo_vfx_ = true;
    bool show_gizmo_game_objects_ = true;

    // Hide all UI (Tab key toggle)
    bool hide_ui_ = false;

    // Track scene path for auto-recentering camera on load_scene_json
    std::string last_scene_path_;

    // Character animation (unique_ptr so we can leak on exit — macOS allocator workaround)
    std::unique_ptr<CharacterData> character_data_;
    std::unique_ptr<BoneAnimationPlayer> anim_player_;
    int selected_clip_ = 0;
    bool anim_playing_ = false;
    float anim_speed_ = 1.0f;
    bool show_character_ = true;
};

}  // namespace gseurat
