#pragma once

// camera_review_state.hpp — Virtual player + CameraZoneSystem for reviewing
// camera zones authored in Bricklayer.

#include "gseurat/engine/camera_volume.hpp"
#include "gseurat/engine/camera_zone_system.hpp"
#include "gseurat/engine/scene_loader.hpp"

#include <glm/glm.hpp>

#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

struct ImDrawList;  // Forward declare — avoid pulling in imgui.h

namespace gseurat {

class InputManager;

class CameraReviewState {
public:
    enum class MoveReference : uint8_t { camera_facing, world_axis };

    // Lifecycle
    bool activate(const SceneData& scene, glm::vec3 initial_pos);
    void deactivate();
    bool is_active() const { return active_; }

    // Per-frame update (mouse_dx/dy are raw cursor deltas from the app layer)
    void update(float dt, const InputManager& input, bool imgui_wants_mouse, bool imgui_wants_keyboard,
                float mouse_dx = 0.0f, float mouse_dy = 0.0f);

    // Teleport / injected movement
    void teleport(float x, float z);
    void inject_walk(const std::string& direction, float seconds);
    void reset_player();

    // Query
    CameraState camera_state() const;
    glm::vec3 player_position() const { return player_pos_; }
    std::string active_zone_name() const;
    CameraMode active_zone_mode() const;
    int active_zone_entity() const;
    bool is_transitioning() const;
    int volume_count() const;
    int trigger_count() const;
    int rail_count() const;

    // Movement reference
    MoveReference move_reference() const { return move_ref_; }
    void set_move_reference(MoveReference ref) { move_ref_ = ref; }

    // Gizmo rendering
    void draw_gizmos(const glm::mat4& vp, float screen_w, float screen_h, ImDrawList* draw_list,
                     bool (*proj_fn)(const glm::vec3&, const glm::mat4&, float, float, float&, float&, const void*),
                     const void* proj_self) const;

    // Speed (public for ImGui slider)
    float& player_speed() { return player_speed_; }

private:
    CameraZoneSystem zone_system_;

    // Virtual player
    glm::vec3 player_pos_{0.0f};
    glm::vec3 player_vel_{0.0f};
    float player_speed_ = 30.0f;

    // Movement reference
    MoveReference move_ref_ = MoveReference::camera_facing;

    // Injected walk (control server)
    glm::vec3 injected_dir_{0.0f};
    float injected_remaining_ = 0.0f;

    // State
    bool active_ = false;
    glm::vec3 initial_player_pos_{0.0f};

    // Zone metadata
    std::vector<std::pair<int, CameraVolume>> volumes_;
    std::vector<CameraTrigger> triggers_;
    std::vector<CameraRail> rails_;
    std::unordered_map<int, std::string> zone_names_;
};

}  // namespace gseurat
