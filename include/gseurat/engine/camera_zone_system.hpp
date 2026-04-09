#pragma once

// camera_zone_system.hpp — Camera pipeline: zone resolution, virtual camera
// evaluation (5 modes), smooth blending, and constraint clamping.
//
// Stages:
//   1. ZoneResolver  — pick the active CameraVolume from player position
//   2. VCamEvaluator — evaluate camera state for the active zone's mode
//   3. Blending      — smoothstep blend between old and new camera states
//   4. Constraints   — clamp camera within volume bounds (stub for now)

#include "gseurat/engine/camera_volume.hpp"
#include "gseurat/engine/gs_spline.hpp"

#include <glm/glm.hpp>
#include <vector>
#include <utility>

namespace gseurat {

/// A rail is a spline that the camera follows, optionally with a second spline
/// for the look-at target.
struct CameraRail {
    SplinePath path;
    SplinePath target_path;
    bool has_target_path = false;
};

/// Full camera zone pipeline: resolve zone, evaluate virtual camera, blend
/// transitions, and apply constraints.
class CameraZoneSystem {
public:
    /// Per-frame user input that affects orbit cameras.
    struct InputState {
        float mouse_dx = 0;
        float mouse_dy = 0;
        float scroll_delta = 0;
    };

    /// Load zone configuration. Call once (or on scene reload).
    void load_from_data(
        std::vector<std::pair<int, CameraVolume>> volumes,
        std::vector<CameraTrigger> triggers,
        std::vector<CameraRail> rails,
        CameraParams default_params);

    /// Advance one frame.
    void update(float dt, glm::vec3 player_pos, glm::vec3 player_vel,
                const InputState& input);

    /// Current blended + clamped camera state.
    CameraState current_state() const { return current_state_; }

    /// Entity ID of the active zone (-1 = world fallback).
    int active_zone_entity() const { return active_zone_entity_; }

    /// True while blending between two zones.
    bool is_transitioning() const { return transitioning_; }

    /// Set orbit azimuth/elevation from an existing camera position+target.
    /// Use before teleport to preserve the camera's current facing direction.
    void set_orbit_from_camera(glm::vec3 cam_pos, glm::vec3 cam_target);

private:
    // Stage 1: Zone resolution
    int resolve_zone(glm::vec3 player_pos);

    // Stage 2: Virtual camera evaluation
    CameraState evaluate_vcam(const CameraParams& params, glm::vec3 player_pos,
                              glm::vec3 player_vel, const InputState& input, float dt);

    // Stage 3: Blending
    CameraState blend_states(const CameraState& from, const CameraState& to, float t);

    // Stage 4: Constraints (stub — passthrough)
    CameraState clamp_state(const CameraState& state, const CameraVolume& vol);

    // Helpers
    float nearest_t_on_spline(const SplinePath& path, glm::vec3 pos, int samples = 64) const;
    static glm::vec3 spring_damp(glm::vec3 current, glm::vec3 target, float half_life, float dt);

    // ── Data ────────────────────────────────────────────────────────────────
    std::vector<std::pair<int, CameraVolume>> volumes_;
    std::vector<CameraTrigger> triggers_;
    std::vector<CameraRail> rails_;
    CameraParams default_params_;
    CameraVolume world_fallback_;

    // ── Stage 1 state ───────────────────────────────────────────────────────
    int active_zone_entity_ = -1;
    int prev_zone_entity_ = -1;
    std::vector<bool> prev_trigger_inside_;

    // ── Stage 2 state ───────────────────────────────────────────────────────
    float orbit_azimuth_ = 0.0f;
    float orbit_elevation_ = 0.3f;
    glm::vec3 spring_position_{0};
    glm::vec3 spring_target_{0};
    bool spring_initialized_ = false;
    float last_rail_t_ = -1.0f;  // previous t on rail spline (-1 = uninitialized)

    // ── Stage 3 state ───────────────────────────────────────────────────────
    bool transitioning_ = false;
    float blend_elapsed_ = 0.0f;
    float blend_duration_ = 1.0f;
    CameraState vcam_old_;

    // ── Output ──────────────────────────────────────────────────────────────
    CameraState current_state_;
};

}  // namespace gseurat
