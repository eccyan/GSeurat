#pragma once

#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <unordered_map>

namespace gseurat {

struct PanelInfo {
    std::string name;
    bool visible = false;
    float pos_x = 0, pos_y = 0;
    float size_w = 0, size_h = 0;
    float display_w = 1280, display_h = 720;

    bool is_on_screen() const {
        return visible
            && (pos_x >= 0) && (pos_x + size_w <= display_w)
            && (pos_y >= 0) && (pos_y + size_h <= display_h);
    }
};

struct GizmoInfo {
    std::string name;
    bool enabled = false;
    int count = 0;
};

struct SceneInfo {
    int gaussians_visible = 0;
    int gaussians_total = 0;
    int game_objects_loaded = 0;
    bool terrain_loaded = false;
    bool character_visible = false;
};

struct CameraReviewInfo {
    bool active = false;
    float player_x = 0, player_y = 0, player_z = 0;
    std::string active_zone;
};

struct VisualState {
    std::vector<PanelInfo> panels;
    std::vector<GizmoInfo> gizmos;
    SceneInfo scene;
    std::unordered_map<std::string, bool> features;
    CameraReviewInfo camera_review;

    nlohmann::json to_json() const;
};

/// Compute flat diff between two visual_state JSONs.
nlohmann::json visual_state_diff(const nlohmann::json& before,
                                  const nlohmann::json& after);

} // namespace gseurat
