// camera_review_state.cpp — Virtual player + CameraZoneSystem for camera
// review mode in Staging.

#include "gseurat/staging/camera_review_state.hpp"
#include "gseurat/engine/input_manager.hpp"

#include <algorithm>
#include <cmath>

// GLFW key constants (avoid pulling in glfw3.h).
constexpr int kGlfwKeyW = 87;
constexpr int kGlfwKeyA = 65;
constexpr int kGlfwKeyS = 83;
constexpr int kGlfwKeyD = 68;
constexpr int kGlfwKeyLeftShift = 340;

namespace gseurat {

// ── Lifecycle ────────────────────────────────────────────────────────────────

// Convert a VolumeShape from Grid space to World space.
static VolumeShape shape_to_world(const VolumeShape& shape, const AABB& aabb) {
    return std::visit([&](const auto& s) -> VolumeShape {
        using T = std::decay_t<decltype(s)>;
        T out = s;
        out.center = coord::to_world(coord::GridPos(s.center), aabb).vec();
        return out;
    }, shape);
}

void CameraReviewState::load_zone_data(const SceneData& scene, const AABB& terrain_aabb) {
    if (!scene.camera_zones) return;
    const auto& cz = *scene.camera_zones;
    if (cz.volumes.empty() && cz.rails.empty() && cz.triggers.empty()) return;

    // Convert string-keyed volumes to int-keyed, converting Grid→World coords.
    volumes_.clear();
    zone_names_.clear();
    std::unordered_map<std::string, int> name_to_id;

    int next_id = 0;
    for (const auto& [name, vol] : cz.volumes) {
        int id = next_id++;
        CameraVolume world_vol = vol;
        world_vol.shape = shape_to_world(vol.shape, terrain_aabb);
        volumes_.emplace_back(id, world_vol);
        zone_names_[id] = name;
        name_to_id[name] = id;
    }

    // Resolve trigger zone references: map string IDs to int IDs, convert coords.
    triggers_ = cz.triggers;
    for (auto& trigger : triggers_) {
        trigger.shape = shape_to_world(trigger.shape, terrain_aabb);
    }
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

    // Extract rails, converting control/target points Grid→World.
    rails_.clear();
    for (const auto& [name, rail] : cz.rails) {
        CameraRail world_rail = rail;
        for (auto& pt : world_rail.path.control_points) {
            pt = coord::to_world(coord::GridPos(pt), terrain_aabb).vec();
        }
        if (world_rail.has_target_path) {
            for (auto& pt : world_rail.target_path.control_points) {
                pt = coord::to_world(coord::GridPos(pt), terrain_aabb).vec();
            }
        }
        rails_.push_back(world_rail);
    }
}

bool CameraReviewState::activate(const SceneData& scene, glm::vec3 initial_pos, const AABB& terrain_aabb) {
    // Must have camera_zones with at least one volume or rail.
    if (!scene.camera_zones) return false;
    const auto& check = *scene.camera_zones;
    if (check.volumes.empty() && check.rails.empty() && check.triggers.empty()) {
        return false;
    }

    // Load and convert zone data (Grid→World).
    load_zone_data(scene, terrain_aabb);

    // Load into the zone system.
    const auto& cz = *scene.camera_zones;
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
    // Keep volumes_, triggers_, rails_, zone_names_ so gizmos can still
    // render zone wireframes even when review mode is not active.
}

// ── Per-frame update ─────────────────────────────────────────────────────────

void CameraReviewState::update(float dt, const InputManager& input,
                               bool imgui_wants_mouse, bool imgui_wants_keyboard,
                               float mouse_dx_in, float mouse_dy_in) {
    if (!active_) return;

    // Save old position for velocity computation.
    glm::vec3 old_pos = player_pos_;

    // ── WASD movement ──────────────────────────────────────────────────────
    if (!imgui_wants_keyboard) {
        glm::vec3 dir{0.0f};

        if (move_ref_ == MoveReference::world_axis) {
            // World-axis: W=-Z, S=+Z, A=-X, D=+X
            if (input.is_key_down(kGlfwKeyW)) dir.z -= 1.0f;
            if (input.is_key_down(kGlfwKeyS)) dir.z += 1.0f;
            if (input.is_key_down(kGlfwKeyA)) dir.x -= 1.0f;
            if (input.is_key_down(kGlfwKeyD)) dir.x += 1.0f;
        } else {
            // Camera-facing: derive forward from camera target - position, projected to XZ.
            CameraState cam = zone_system_.current_state();
            glm::vec3 cam_fwd = cam.target - cam.position;
            cam_fwd.y = 0.0f;
            float len = std::sqrt(cam_fwd.x * cam_fwd.x + cam_fwd.z * cam_fwd.z);
            if (len > 1e-6f) {
                cam_fwd /= len;
            } else {
                cam_fwd = {0.0f, 0.0f, -1.0f};
            }
            glm::vec3 cam_right = {-cam_fwd.z, 0.0f, cam_fwd.x};  // cross(fwd, up) in XZ

            if (input.is_key_down(kGlfwKeyW)) dir += cam_fwd;
            if (input.is_key_down(kGlfwKeyS)) dir -= cam_fwd;
            if (input.is_key_down(kGlfwKeyA)) dir -= cam_right;
            if (input.is_key_down(kGlfwKeyD)) dir += cam_right;
        }

        // Normalize and apply speed.
        float dir_len = std::sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        if (dir_len > 1e-6f) {
            dir /= dir_len;
            float speed = player_speed_;
            if (input.is_key_down(kGlfwKeyLeftShift)) speed *= 2.0f;
            player_pos_ += dir * speed * dt;
        }
    }

    // ── Injected walk ──────────────────────────────────────────────────────
    if (injected_remaining_ > 0.0f) {
        float step = std::min(injected_remaining_, dt);
        player_pos_ += injected_dir_ * player_speed_ * step;
        injected_remaining_ -= step;
        if (injected_remaining_ <= 0.0f) {
            injected_remaining_ = 0.0f;
            injected_dir_ = glm::vec3{0.0f};
        }
    }

    // ── Velocity ───────────────────────────────────────────────────────────
    if (dt > 1e-6f) {
        player_vel_ = (player_pos_ - old_pos) / dt;
    }

    // ── Camera input ───────────────────────────────────────────────────────
    CameraZoneSystem::InputState cam_input;
    if (!imgui_wants_mouse) {
        cam_input.mouse_dx = mouse_dx_in;
        cam_input.mouse_dy = mouse_dy_in;
        cam_input.scroll_delta = input.scroll_y_delta();
    }

    // ── Zone system update ─────────────────────────────────────────────────
    // Skip if an external sync_camera override is active for this frame.
    if (camera_override_) {
        camera_override_ = false;
        return;
    }
    zone_system_.update(dt, player_pos_, player_vel_, cam_input);

    // ── Auto-switch MoveReference on zone change only ──────────────────────
    int cur_zone = zone_system_.active_zone_entity();
    if (cur_zone != last_zone_entity_) {
        last_zone_entity_ = cur_zone;
        CameraMode mode = active_zone_mode();
        if (mode == CameraMode::free_look) {
            move_ref_ = MoveReference::camera_facing;
        } else {
            move_ref_ = MoveReference::world_axis;
        }
    }
}

// ── Teleport / injected movement ─────────────────────────────────────────────

void CameraReviewState::teleport(float x, float z) {
    // Preserve camera facing direction before moving the player.
    CameraState cam = zone_system_.current_state();
    zone_system_.set_orbit_from_camera(cam.position, cam.target);

    player_pos_.x = x;
    player_pos_.z = z;
    player_vel_ = glm::vec3{0.0f};
}

void CameraReviewState::teleport(float x, float y, float z) {
    // Preserve camera facing direction before moving the player.
    CameraState cam = zone_system_.current_state();
    zone_system_.set_orbit_from_camera(cam.position, cam.target);

    player_pos_.x = x;
    player_pos_.y = y;
    player_pos_.z = z;
    player_vel_ = glm::vec3{0.0f};
}

void CameraReviewState::inject_walk(const std::string& direction, float seconds) {
    if (!active_) return;

    glm::vec3 dir{0.0f};

    if (move_ref_ == MoveReference::world_axis) {
        if (direction == "forward")      dir = {0.0f, 0.0f, -1.0f};
        else if (direction == "back")    dir = {0.0f, 0.0f,  1.0f};
        else if (direction == "left")    dir = {-1.0f, 0.0f, 0.0f};
        else if (direction == "right")   dir = { 1.0f, 0.0f, 0.0f};
    } else {
        // Camera-facing: derive from camera state.
        CameraState cam = zone_system_.current_state();
        glm::vec3 cam_fwd = cam.target - cam.position;
        cam_fwd.y = 0.0f;
        float len = std::sqrt(cam_fwd.x * cam_fwd.x + cam_fwd.z * cam_fwd.z);
        if (len > 1e-6f) {
            cam_fwd /= len;
        } else {
            cam_fwd = {0.0f, 0.0f, -1.0f};
        }
        glm::vec3 cam_right = {-cam_fwd.z, 0.0f, cam_fwd.x};

        if (direction == "forward")      dir = cam_fwd;
        else if (direction == "back")    dir = -cam_fwd;
        else if (direction == "left")    dir = -cam_right;
        else if (direction == "right")   dir = cam_right;
    }

    injected_dir_ = dir;
    injected_remaining_ = seconds;
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

}  // namespace gseurat (temporarily close for imgui include)

#ifdef GSEURAT_DEV_MODE
#include <imgui.h>

namespace gseurat {

// ── Gizmo rendering ─────────────────────────────────────────────────────────

void CameraReviewState::draw_gizmos(const glm::mat4& vp, float screen_w,
                                    float screen_h, ImDrawList* dl,
                                    bool (*proj_fn)(const glm::vec3&, const glm::mat4&, float, float, float&, float&, const void*),
                                    const void* proj_self) const {
    if (volumes_.empty() && triggers_.empty() && rails_.empty()) return;

    int active_entity = zone_system_.active_zone_entity();

    // ── Volume wireframes ────────────────────────────────────────────────────
    for (const auto& [id, vol] : volumes_) {
        bool is_active = (id == active_entity);
        ImU32 col = is_active ? IM_COL32(0, 255, 255, 255)
                              : IM_COL32(0, 204, 204, 180);
        float thickness = is_active ? 2.0f : 1.0f;

        std::visit([&](const auto& shape) {
            using T = std::decay_t<decltype(shape)>;
            if constexpr (std::is_same_v<T, CamAABB>) {
                // Draw AABB wireframe: 8 corners, 12 edges.
                const auto& c = shape.center;
                const auto& h = shape.half_extents;
                glm::vec3 corners[8] = {
                    c + glm::vec3(-h.x, -h.y, -h.z),
                    c + glm::vec3( h.x, -h.y, -h.z),
                    c + glm::vec3( h.x,  h.y, -h.z),
                    c + glm::vec3(-h.x,  h.y, -h.z),
                    c + glm::vec3(-h.x, -h.y,  h.z),
                    c + glm::vec3( h.x, -h.y,  h.z),
                    c + glm::vec3( h.x,  h.y,  h.z),
                    c + glm::vec3(-h.x,  h.y,  h.z),
                };
                ImVec2 pts[8];
                bool vis[8];
                for (int i = 0; i < 8; i++) {
                    vis[i] = proj_fn(corners[i], vp, screen_w, screen_h,
                                     pts[i].x, pts[i].y, proj_self);
                }
                constexpr int edges[12][2] = {
                    {0,1},{1,2},{2,3},{3,0},
                    {4,5},{5,6},{6,7},{7,4},
                    {0,4},{1,5},{2,6},{3,7}
                };
                for (const auto& e : edges) {
                    if (vis[e[0]] && vis[e[1]]) {
                        dl->AddLine(pts[e[0]], pts[e[1]], col, thickness);
                    }
                }
                // Label at top-center (average of top 4 corners).
                glm::vec3 top_center = c + glm::vec3(0.0f, h.y, 0.0f);
                float lx, ly;
                if (proj_fn(top_center, vp, screen_w, screen_h, lx, ly, proj_self)) {
                    auto name_it = zone_names_.find(id);
                    if (name_it != zone_names_.end()) {
                        dl->AddText(ImVec2(lx - 20, ly - 14), col,
                                    name_it->second.c_str());
                    }
                }
            } else if constexpr (std::is_same_v<T, CamSphere>) {
                // Draw sphere: project center and edge point.
                float cx, cy;
                if (!proj_fn(shape.center, vp, screen_w, screen_h, cx, cy, proj_self))
                    return;
                glm::vec3 edge = shape.center + glm::vec3(shape.radius, 0.0f, 0.0f);
                float ex, ey;
                float sr = 15.0f;
                if (proj_fn(edge, vp, screen_w, screen_h, ex, ey, proj_self)) {
                    sr = std::abs(ex - cx);
                    sr = std::clamp(sr, 3.0f, 300.0f);
                }
                dl->AddCircle(ImVec2(cx, cy), sr, col, 24, thickness);
                // Label above circle.
                auto name_it = zone_names_.find(id);
                if (name_it != zone_names_.end()) {
                    dl->AddText(ImVec2(cx - 20, cy - sr - 14), col,
                                name_it->second.c_str());
                }
            }
        }, vol.shape);
    }

    // ── Trigger wireframes ───────────────────────────────────────────────────
    for (const auto& trigger : triggers_) {
        bool inside = contains(trigger.shape, player_pos_);
        ImU32 col = inside ? IM_COL32(255, 0, 255, 255)
                           : IM_COL32(204, 0, 204, 180);
        float thickness = 1.0f;

        std::visit([&](const auto& shape) {
            using T = std::decay_t<decltype(shape)>;
            if constexpr (std::is_same_v<T, CamAABB>) {
                const auto& c = shape.center;
                const auto& h = shape.half_extents;
                glm::vec3 corners[8] = {
                    c + glm::vec3(-h.x, -h.y, -h.z),
                    c + glm::vec3( h.x, -h.y, -h.z),
                    c + glm::vec3( h.x,  h.y, -h.z),
                    c + glm::vec3(-h.x,  h.y, -h.z),
                    c + glm::vec3(-h.x, -h.y,  h.z),
                    c + glm::vec3( h.x, -h.y,  h.z),
                    c + glm::vec3( h.x,  h.y,  h.z),
                    c + glm::vec3(-h.x,  h.y,  h.z),
                };
                ImVec2 pts[8];
                bool vis[8];
                for (int i = 0; i < 8; i++) {
                    vis[i] = proj_fn(corners[i], vp, screen_w, screen_h,
                                     pts[i].x, pts[i].y, proj_self);
                }
                constexpr int edges[12][2] = {
                    {0,1},{1,2},{2,3},{3,0},
                    {4,5},{5,6},{6,7},{7,4},
                    {0,4},{1,5},{2,6},{3,7}
                };
                for (const auto& e : edges) {
                    if (vis[e[0]] && vis[e[1]]) {
                        dl->AddLine(pts[e[0]], pts[e[1]], col, thickness);
                    }
                }
                // Label at center
                float lx, ly;
                if (proj_fn(c, vp, screen_w, screen_h, lx, ly, proj_self)) {
                    auto to_it = zone_names_.find(trigger.to_zone_entity);
                    std::string label = "Trigger";
                    if (to_it != zone_names_.end()) {
                        label += " -> " + to_it->second;
                    }
                    dl->AddText(ImVec2(lx - 30, ly - 10), col, label.c_str());
                }
            } else if constexpr (std::is_same_v<T, CamSphere>) {
                float cx, cy;
                if (!proj_fn(shape.center, vp, screen_w, screen_h, cx, cy, proj_self))
                    return;
                glm::vec3 edge = shape.center + glm::vec3(shape.radius, 0.0f, 0.0f);
                float ex, ey;
                float sr = 15.0f;
                if (proj_fn(edge, vp, screen_w, screen_h, ex, ey, proj_self)) {
                    sr = std::abs(ex - cx);
                    sr = std::clamp(sr, 3.0f, 300.0f);
                }
                dl->AddCircle(ImVec2(cx, cy), sr, col, 24, thickness);
                // Label above circle
                auto to_it = zone_names_.find(trigger.to_zone_entity);
                std::string label = "Trigger";
                if (to_it != zone_names_.end()) {
                    label += " -> " + to_it->second;
                }
                dl->AddText(ImVec2(cx - 30, cy - sr - 14), col, label.c_str());
            }
        }, trigger.shape);
    }

    // ── Rail splines ─────────────────────────────────────────────────────────
    {
        ImU32 rail_col = IM_COL32(204, 204, 0, 200);
        for (const auto& rail : rails_) {
            if (!rail.path.valid()) continue;

            // Draw control points as filled circles.
            for (size_t i = 0; i < rail.path.control_points.size(); i++) {
                float px, py;
                if (proj_fn(rail.path.control_points[i], vp, screen_w, screen_h,
                            px, py, proj_self)) {
                    dl->AddCircleFilled(ImVec2(px, py), 4.0f, rail_col);
                }
            }

            // Sample spline at 10 segments per span.
            int num_spans = static_cast<int>(rail.path.control_points.size()) - 1;
            int total_segments = std::max(num_spans * 10, 10);
            float prev_sx = 0, prev_sy = 0;
            bool prev_vis = false;
            for (int s = 0; s <= total_segments; s++) {
                float t = static_cast<float>(s) / static_cast<float>(total_segments);
                glm::vec3 pt = rail.path.evaluate(t);
                float sx, sy;
                bool vis = proj_fn(pt, vp, screen_w, screen_h, sx, sy, proj_self);
                if (s > 0 && vis && prev_vis) {
                    dl->AddLine(ImVec2(prev_sx, prev_sy), ImVec2(sx, sy),
                                rail_col, 1.5f);
                }
                prev_sx = sx;
                prev_sy = sy;
                prev_vis = vis;
            }
        }
    }

    // ── Virtual player marker ────────────────────────────────────────────────
    if (active_) {
        float px, py;
        if (proj_fn(player_pos_, vp, screen_w, screen_h, px, py, proj_self)) {
            ImU32 green = IM_COL32(0, 255, 0, 255);
            dl->AddCircleFilled(ImVec2(px, py), 8.0f, green);

            // Direction arrow: 3-unit line toward camera facing direction.
            CameraState cam = zone_system_.current_state();
            glm::vec3 fwd = cam.target - cam.position;
            fwd.y = 0.0f;
            float len = std::sqrt(fwd.x * fwd.x + fwd.z * fwd.z);
            if (len > 1e-6f) {
                fwd /= len;
                glm::vec3 arrow_end = player_pos_ + fwd * 3.0f;
                float ax, ay;
                if (proj_fn(arrow_end, vp, screen_w, screen_h, ax, ay, proj_self)) {
                    dl->AddLine(ImVec2(px, py), ImVec2(ax, ay), green, 2.0f);
                    // Arrowhead.
                    float dx = ax - px;
                    float dy = ay - py;
                    float al = std::sqrt(dx * dx + dy * dy);
                    if (al > 1e-3f) {
                        dx /= al; dy /= al;
                        float hx = -dy, hy = dx;  // perpendicular
                        float hs = 5.0f;
                        dl->AddTriangleFilled(
                            ImVec2(ax, ay),
                            ImVec2(ax - dx * hs + hx * hs * 0.5f,
                                   ay - dy * hs + hy * hs * 0.5f),
                            ImVec2(ax - dx * hs - hx * hs * 0.5f,
                                   ay - dy * hs - hy * hs * 0.5f),
                            green);
                    }
                }
            }
        }
    }
}

}  // namespace gseurat

#endif  // GSEURAT_DEV_MODE
