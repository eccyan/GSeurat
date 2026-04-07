#include "gseurat/engine/camera_zone_system.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

// ── Helpers ─────────────────────────────────────────────────────────────────

glm::vec3 CameraZoneSystem::spring_damp(glm::vec3 current, glm::vec3 target,
                                         float half_life, float dt) {
    // Exponential decay: each half_life seconds, error halves.
    float decay = std::exp(-0.6931472f * dt / std::max(half_life, 0.001f));
    return target + (current - target) * decay;
}

float CameraZoneSystem::nearest_t_on_spline(const SplinePath& path,
                                             glm::vec3 pos, int samples) const {
    if (!path.valid()) return 0.0f;

    float best_t = 0.0f;
    float best_dist2 = 1e30f;

    for (int i = 0; i <= samples; ++i) {
        float t = static_cast<float>(i) / static_cast<float>(samples);
        glm::vec3 p = path.evaluate(t);
        glm::vec3 d = p - pos;
        float dist2 = d.x * d.x + d.y * d.y + d.z * d.z;
        if (dist2 < best_dist2) {
            best_dist2 = dist2;
            best_t = t;
        }
    }
    return best_t;
}

// ── load_from_data ──────────────────────────────────────────────────────────

void CameraZoneSystem::load_from_data(
    std::vector<std::pair<int, CameraVolume>> volumes,
    std::vector<CameraTrigger> triggers,
    std::vector<CameraRail> rails,
    CameraParams default_params)
{
    volumes_ = std::move(volumes);
    triggers_ = std::move(triggers);
    rails_ = std::move(rails);
    default_params_ = default_params;

    // Precompute volume sizes for priority resolution.
    for (auto& [id, vol] : volumes_) {
        vol.cached_volume_size = volume_size(vol.shape);
    }

    // World fallback: huge AABB, priority=-1, uses default params.
    world_fallback_.shape = AABB{{0.0f, 0.0f, 0.0f}, {1e6f, 1e6f, 1e6f}};
    world_fallback_.params = default_params_;
    world_fallback_.params.priority = -1;
    world_fallback_.cached_volume_size = volume_size(world_fallback_.shape);

    // Reset trigger state.
    prev_trigger_inside_.assign(triggers_.size(), false);

    // Reset runtime state.
    active_zone_entity_ = -1;
    prev_zone_entity_ = -1;
    transitioning_ = false;
    blend_elapsed_ = 0.0f;
    spring_initialized_ = false;
}

// ── Stage 1: Zone Resolution ────────────────────────────────────────────────

int CameraZoneSystem::resolve_zone(glm::vec3 player_pos) {
    // 1. Collect all volumes the player is inside.
    std::vector<std::pair<int, const CameraVolume*>> candidates;
    for (const auto& [id, vol] : volumes_) {
        if (contains(vol.shape, player_pos)) {
            candidates.push_back({id, &vol});
        }
    }

    // 2. Check triggers for enter events.
    for (size_t i = 0; i < triggers_.size(); ++i) {
        bool inside_now = contains(triggers_[i].shape, player_pos);
        bool was_inside = prev_trigger_inside_[i];
        prev_trigger_inside_[i] = inside_now;

        if (inside_now && !was_inside) {
            // Enter event — check from_zone constraint.
            int from = triggers_[i].from_zone_entity;
            if (from == -1 || from == active_zone_entity_) {
                // Trigger fires: override blend duration and jump to target zone.
                if (triggers_[i].blend_override >= 0.0f) {
                    blend_duration_ = triggers_[i].blend_override;
                } else {
                    // Use destination zone's blend_time.
                    for (const auto& [vid, vol] : volumes_) {
                        if (vid == triggers_[i].to_zone_entity) {
                            blend_duration_ = vol.params.blend_time;
                            break;
                        }
                    }
                }
                return triggers_[i].to_zone_entity;
            }
        }
    }

    // 3. Priority resolution among contained volumes.
    auto [best_id, best_vol] = resolve_zone_priority(candidates);

    // 4. Return entity ID (-1 = world fallback).
    return best_id;
}

// ── Stage 2: Virtual Camera Evaluation ──────────────────────────────────────

CameraState CameraZoneSystem::evaluate_vcam(const CameraParams& params,
                                             glm::vec3 player_pos,
                                             glm::vec3 player_vel,
                                             const InputState& input,
                                             float dt) {
    // Spring-damp the target toward the player.
    if (!spring_initialized_) {
        spring_position_ = player_pos + params.offset;
        spring_target_ = player_pos;
        spring_initialized_ = true;
    }
    spring_target_ = spring_damp(spring_target_, player_pos, 0.15f, dt);

    CameraState state;
    state.fov = params.fov;
    state.up = {0.0f, 1.0f, 0.0f};

    switch (params.mode) {
    case CameraMode::free_look: {
        // Apply mouse input to orbit angles (if allowed).
        if (params.allow_user_orbit) {
            orbit_azimuth_ += input.mouse_dx * 0.005f;
            orbit_elevation_ += input.mouse_dy * 0.005f;
        }

        // Clamp elevation to configured pitch range (converted to radians).
        float elev_min = glm::radians(params.pitch_min);
        float elev_max = glm::radians(params.pitch_max);
        orbit_elevation_ = glm::clamp(orbit_elevation_, elev_min, elev_max);

        // Spherical-to-cartesian for orbit offset.
        float cos_el = std::cos(orbit_elevation_);
        float sin_el = std::sin(orbit_elevation_);
        float cos_az = std::cos(orbit_azimuth_);
        float sin_az = std::sin(orbit_azimuth_);

        glm::vec3 orbit_offset{
            params.orbit_distance * cos_el * sin_az,
            params.orbit_distance * sin_el,
            params.orbit_distance * cos_el * cos_az
        };

        glm::vec3 desired = spring_target_ + orbit_offset;
        spring_position_ = spring_damp(spring_position_, desired, 0.15f, dt);

        state.position = spring_position_;
        state.target = spring_target_;
        break;
    }

    case CameraMode::rail_follow: {
        int ri = params.rail_index;
        if (ri >= 0 && ri < static_cast<int>(rails_.size()) && rails_[ri].path.valid()) {
            float t = nearest_t_on_spline(rails_[ri].path, player_pos);
            glm::vec3 rail_pos = rails_[ri].path.evaluate(t);

            spring_position_ = spring_damp(spring_position_, rail_pos, 0.15f, dt);
            state.position = spring_position_;

            if (rails_[ri].has_target_path && rails_[ri].target_path.valid()) {
                state.target = rails_[ri].target_path.evaluate(t);
            } else {
                state.target = spring_target_;
            }
        } else {
            // Fallback: treat as free_look.
            state.position = spring_target_ + params.offset;
            state.target = spring_target_;
        }
        break;
    }

    case CameraMode::cinematic_rail: {
        // Stub: evaluate at t=0 (timer added in later task).
        int ri = params.rail_index;
        if (ri >= 0 && ri < static_cast<int>(rails_.size()) && rails_[ri].path.valid()) {
            state.position = rails_[ri].path.evaluate(0.0f);
            if (rails_[ri].has_target_path && rails_[ri].target_path.valid()) {
                state.target = rails_[ri].target_path.evaluate(0.0f);
            } else {
                state.target = spring_target_;
            }
        } else {
            state.position = params.fixed_position;
            state.target = spring_target_;
        }
        break;
    }

    case CameraMode::fixed_point: {
        state.position = params.fixed_position;
        state.target = spring_damp(spring_target_, player_pos, 0.15f, dt);
        // Override: spring_target_ already tracks player, use it directly.
        state.target = spring_target_;
        break;
    }

    case CameraMode::side_scroll: {
        // X follows player, Y/Z from offset.
        glm::vec3 desired{
            player_pos.x,
            player_pos.y + params.offset.y,
            player_pos.z + params.offset.z
        };
        spring_position_ = spring_damp(spring_position_, desired, 0.15f, dt);

        state.position = spring_position_;
        state.target = glm::vec3{spring_position_.x, spring_position_.y, spring_position_.z - 1.0f};
        // Look at where the player is on the XY plane.
        state.target = glm::vec3{spring_position_.x, player_pos.y, player_pos.z};
        break;
    }
    }

    return state;
}

// ── Stage 3: Blending ───────────────────────────────────────────────────────

CameraState CameraZoneSystem::blend_states(const CameraState& from,
                                            const CameraState& to, float t) {
    CameraState result;
    result.position = glm::mix(from.position, to.position, t);
    result.target = glm::mix(from.target, to.target, t);
    result.fov = glm::mix(from.fov, to.fov, t);

    // Blend up vectors and renormalize.
    glm::vec3 blended_up = glm::mix(from.up, to.up, t);
    float len = glm::length(blended_up);
    result.up = (len > 0.0001f) ? blended_up / len : glm::vec3{0.0f, 1.0f, 0.0f};

    return result;
}

// ── Stage 4: Constraints ────────────────────────────────────────────────────

CameraState CameraZoneSystem::clamp_state(const CameraState& state,
                                           const CameraVolume& vol) {
    CameraState result = state;

    // Position clamping: push camera inside volume.
    result.position = clamp_to(vol.shape, result.position);

    // Pitch/Yaw clamping.
    glm::vec3 dir = result.position - result.target;
    float dist = glm::length(dir);
    if (dist < 0.001f) return result;
    dir /= dist;

    float pitch = std::asin(glm::clamp(dir.y, -1.0f, 1.0f));
    float yaw   = std::atan2(dir.x, dir.z);

    float pitch_deg = glm::degrees(pitch);
    float yaw_deg   = glm::degrees(yaw);

    pitch_deg = glm::clamp(pitch_deg, vol.params.pitch_min, vol.params.pitch_max);

    if (vol.params.yaw_min > -180.0f || vol.params.yaw_max < 180.0f) {
        yaw_deg = glm::clamp(yaw_deg, vol.params.yaw_min, vol.params.yaw_max);
    }

    float p = glm::radians(pitch_deg);
    float y = glm::radians(yaw_deg);
    glm::vec3 new_dir(
        std::cos(p) * std::sin(y),
        std::sin(p),
        std::cos(p) * std::cos(y)
    );
    result.position = result.target + new_dir * dist;

    return result;
}

// ── update ──────────────────────────────────────────────────────────────────

void CameraZoneSystem::update(float dt, glm::vec3 player_pos,
                               glm::vec3 player_vel, const InputState& input) {
    // Stage 1: Resolve zone.
    int new_zone = resolve_zone(player_pos);

    // Detect zone transition.
    if (new_zone != active_zone_entity_ && spring_initialized_) {
        // Save current state for blending from.
        vcam_old_ = current_state_;
        transitioning_ = true;
        blend_elapsed_ = 0.0f;

        // Determine blend duration from the new zone's params (unless trigger
        // already set it above in resolve_zone).
        if (new_zone != -1) {
            for (const auto& [id, vol] : volumes_) {
                if (id == new_zone) {
                    blend_duration_ = vol.params.blend_time;
                    break;
                }
            }
        } else {
            blend_duration_ = default_params_.blend_time;
        }
    }

    prev_zone_entity_ = active_zone_entity_;
    active_zone_entity_ = new_zone;

    // Look up active zone's params.
    const CameraParams* active_params = &default_params_;
    const CameraVolume* active_vol = &world_fallback_;
    for (const auto& [id, vol] : volumes_) {
        if (id == active_zone_entity_) {
            active_params = &vol.params;
            active_vol = &vol;
            break;
        }
    }

    // Stage 2: Evaluate virtual camera.
    CameraState vcam_new = evaluate_vcam(*active_params, player_pos, player_vel,
                                         input, dt);

    // Stage 3: Blend.
    if (transitioning_) {
        blend_elapsed_ += dt;
        float raw_t = (blend_duration_ > 0.0f)
                       ? std::clamp(blend_elapsed_ / blend_duration_, 0.0f, 1.0f)
                       : 1.0f;
        // Smoothstep: 3t^2 - 2t^3.
        float t = raw_t * raw_t * (3.0f - 2.0f * raw_t);

        current_state_ = blend_states(vcam_old_, vcam_new, t);

        if (blend_elapsed_ >= blend_duration_) {
            transitioning_ = false;
        }
    } else {
        current_state_ = vcam_new;
    }

    // Stage 4: Constraints.
    current_state_ = clamp_state(current_state_, *active_vol);
}

}  // namespace gseurat
