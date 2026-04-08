// camera_review_state.cpp — Virtual player + CameraZoneSystem for camera
// review mode in Staging.

#include "gseurat/staging/camera_review_state.hpp"
#include "gseurat/engine/input_manager.hpp"

#include <cmath>

namespace gseurat {

// ── Lifecycle ────────────────────────────────────────────────────────────────

bool CameraReviewState::activate(const SceneData& scene, glm::vec3 initial_pos) {
    // Must have camera_zones with at least one volume.
    if (!scene.camera_zones || scene.camera_zones->volumes.empty()) {
        return false;
    }

    const auto& cz = *scene.camera_zones;

    // Convert string-keyed volumes to int-keyed (sequential IDs starting at 0).
    volumes_.clear();
    zone_names_.clear();
    std::unordered_map<std::string, int> name_to_id;

    int next_id = 0;
    for (const auto& [name, vol] : cz.volumes) {
        int id = next_id++;
        volumes_.emplace_back(id, vol);
        zone_names_[id] = name;
        name_to_id[name] = id;
    }

    // Resolve trigger zone references: map string IDs to int IDs.
    triggers_ = cz.triggers;
    for (size_t i = 0; i < cz.trigger_zone_refs.size() && i < triggers_.size(); ++i) {
        const auto& [from_name, to_name] = cz.trigger_zone_refs[i];
        auto from_it = name_to_id.find(from_name);
        auto to_it = name_to_id.find(to_name);
        if (from_it != name_to_id.end()) {
            triggers_[i].from_zone_entity = from_it->second;
        }
        if (to_it != name_to_id.end()) {
            triggers_[i].to_zone_entity = to_it->second;
        }
    }

    // Extract rails.
    rails_.clear();
    for (const auto& [name, rail] : cz.rails) {
        rails_.push_back(rail);
    }

    // Load into the zone system.
    zone_system_.load_from_data(volumes_, triggers_, rails_, cz.default_params);

    // Set player position and activate.
    player_pos_ = initial_pos;
    initial_player_pos_ = initial_pos;
    player_vel_ = glm::vec3{0.0f};
    injected_dir_ = glm::vec3{0.0f};
    injected_remaining_ = 0.0f;
    active_ = true;

    return true;
}

void CameraReviewState::deactivate() {
    active_ = false;
    player_pos_ = glm::vec3{0.0f};
    player_vel_ = glm::vec3{0.0f};
    injected_dir_ = glm::vec3{0.0f};
    injected_remaining_ = 0.0f;
    volumes_.clear();
    triggers_.clear();
    rails_.clear();
    zone_names_.clear();
}

// ── Per-frame update ─────────────────────────────────────────────────────────

void CameraReviewState::update(float /*dt*/, const InputManager& /*input*/,
                               bool /*imgui_wants_mouse*/, bool /*imgui_wants_keyboard*/) {
    // Stub — Task 2 will implement WASD movement and input handling.
}

// ── Teleport / injected movement ─────────────────────────────────────────────

void CameraReviewState::teleport(float x, float z) {
    player_pos_.x = x;
    player_pos_.z = z;
    player_vel_ = glm::vec3{0.0f};
}

void CameraReviewState::inject_walk(const std::string& /*direction*/, float /*seconds*/) {
    // Stub — Task 2 will implement.
}

void CameraReviewState::reset_player() {
    player_pos_ = initial_player_pos_;
    player_vel_ = glm::vec3{0.0f};
    injected_dir_ = glm::vec3{0.0f};
    injected_remaining_ = 0.0f;
}

// ── Query ────────────────────────────────────────────────────────────────────

CameraState CameraReviewState::camera_state() const {
    return zone_system_.current_state();
}

std::string CameraReviewState::active_zone_name() const {
    int entity = zone_system_.active_zone_entity();
    auto it = zone_names_.find(entity);
    if (it != zone_names_.end()) {
        return it->second;
    }
    return "world_fallback";
}

CameraMode CameraReviewState::active_zone_mode() const {
    // Return the mode of the active zone, or the default (free_look).
    int entity = zone_system_.active_zone_entity();
    for (const auto& [id, vol] : volumes_) {
        if (id == entity) {
            return vol.params.mode;
        }
    }
    return CameraMode::free_look;
}

int CameraReviewState::active_zone_entity() const {
    return zone_system_.active_zone_entity();
}

bool CameraReviewState::is_transitioning() const {
    return zone_system_.is_transitioning();
}

int CameraReviewState::volume_count() const {
    return static_cast<int>(volumes_.size());
}

int CameraReviewState::trigger_count() const {
    return static_cast<int>(triggers_.size());
}

int CameraReviewState::rail_count() const {
    return static_cast<int>(rails_.size());
}

// ── Gizmo rendering ─────────────────────────────────────────────────────────

void CameraReviewState::draw_gizmos(const glm::mat4& /*vp*/, float /*screen_w*/,
                                    float /*screen_h*/, ImDrawList* /*draw_list*/,
                                    bool (*/*proj_fn*/)(const glm::vec3&, const glm::mat4&, float, float, float&, float&, const void*),
                                    const void* /*proj_self*/) const {
    // Stub — Task 4 will implement gizmo rendering.
}

}  // namespace gseurat
