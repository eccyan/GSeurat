#include "gseurat/engine/camera_zone_system.hpp"
#include "gseurat/engine/gs_animator.hpp"

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

    auto search_range = [&](float lo, float hi, int n) {
        float best_t = lo;
        float best_dist2 = 1e30f;
        for (int i = 0; i <= n; ++i) {
            float t = lo + (hi - lo) * static_cast<float>(i) / static_cast<float>(n);
            glm::vec3 p = path.evaluate(t);
            glm::vec3 d = p - pos;
            float dist2 = d.x * d.x + d.y * d.y + d.z * d.z;
            if (dist2 < best_dist2) {
                best_dist2 = dist2;
                best_t = t;
            }
        }
        return std::pair{best_t, best_dist2};
    };

    // Local search near previous t for frame-to-frame continuity.
    if (last_rail_t_ >= 0.0f) {
        float lo = std::max(0.0f, last_rail_t_ - 0.10f);
        float hi = std::min(1.0f, last_rail_t_ + 0.10f);
        auto [local_t, local_d2] = search_range(lo, hi, 32);
        // Accept if within reasonable distance (20 units).
        if (local_d2 < 400.0f) return local_t;
    }

    // Global search (first frame or after teleport).
    auto [global_t, global_d2] = search_range(0.0f, 1.0f, samples);
    return global_t;
}

// ── set_orbit_from_camera ────────────────────────────────────────────────────

void CameraZoneSystem::set_orbit_from_camera(glm::vec3 cam_pos, glm::vec3 cam_target) {
    // Inverse of the spherical-to-cartesian in evaluate_vcam (free_look):
    //   x = dist * cos(el) * sin(az)
    //   y = dist * sin(el)
    //   z = dist * cos(el) * cos(az)
    glm::vec3 offset = cam_pos - cam_target;
    float dist = std::sqrt(offset.x * offset.x + offset.y * offset.y + offset.z * offset.z);
    if (dist < 1e-6f) return;  // degenerate — keep current angles

    glm::vec3 dir = offset / dist;
    orbit_azimuth_ = std::atan2(dir.x, dir.z);
    orbit_elevation_ = std::asin(std::clamp(dir.y, -1.0f, 1.0f));
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
    world_fallback_.shape = CamAABB{{0.0f, 0.0f, 0.0f}, {1e6f, 1e6f, 1e6f}};
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
    last_rail_t_ = -1.0f;
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
    // Spring-damp the target toward the player, offset upward so the camera
    // orbits around chest/head height rather than the feet (prevents terrain clipping).
    glm::vec3 look_target = player_pos + glm::vec3(0.0f, params.target_y_offset, 0.0f);
    if (!spring_initialized_) {
        spring_position_ = look_target + params.offset;
        spring_target_ = look_target;
        spring_initialized_ = true;
    }
    spring_target_ = spring_damp(spring_target_, look_target, 0.15f, dt);

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
            last_rail_t_ = t;

            // Snap directly to rail — no spring on position.
            state.position = rails_[ri].path.evaluate(t);

            // Enforce minimum height above player (terrain) to prevent camera
            // sinking into the ground when rail Y is lower than terrain.
            float min_y = player_pos.y + params.min_ground_clearance;
            if (state.position.y < min_y) {
                state.position.y = min_y;
            }

            spring_position_ = state.position;  // keep spring in sync

            if (rails_[ri].has_target_path && rails_[ri].target_path.valid()) {
                // Snap target directly — no spring (spring_target_ tracks player,
                // which fights the target path and causes oscillation).
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
        int ri = params.rail_index;
        if (ri >= 0 && ri < static_cast<int>(rails_.size()) && rails_[ri].path.valid()) {
            // Step 1: Advance timer (time-driven modes only).
            if (cinematic_state_ == CinematicState::playing &&
                params.cinematic_playback != CinematicPlayback::manual) {
                if (cinematic_reverse_) {
                    cinematic_timer_ -= dt;
                } else {
                    cinematic_timer_ += dt;
                }
            }

            // Step 2: Compute base t.
            float base_t = (params.cinematic_duration > 0.0f)
                ? cinematic_timer_ / params.cinematic_duration
                : 1.0f;

            // Step 3: Handle playback mode boundaries.
            switch (params.cinematic_playback) {
                case CinematicPlayback::once:
                    base_t = std::clamp(base_t, 0.0f, 1.0f);
                    if (base_t >= 1.0f && cinematic_state_ == CinematicState::playing) {
                        cinematic_state_ = CinematicState::finished;
                        cinematic_timer_ = params.cinematic_duration;
                        if (on_cinematic_complete_) {
                            on_cinematic_complete_(active_zone_entity_);
                        }
                    }
                    break;
                case CinematicPlayback::loop:
                    if (base_t >= 1.0f) {
                        cinematic_timer_ = std::fmod(cinematic_timer_, params.cinematic_duration);
                        base_t = cinematic_timer_ / params.cinematic_duration;
                    }
                    if (base_t < 0.0f) base_t += 1.0f;
                    break;
                case CinematicPlayback::ping_pong:
                    if (base_t >= 1.0f && !cinematic_reverse_) {
                        cinematic_reverse_ = true;
                        cinematic_timer_ = params.cinematic_duration;
                        base_t = 1.0f;
                    } else if (base_t <= 0.0f && cinematic_reverse_) {
                        cinematic_reverse_ = false;
                        cinematic_timer_ = 0.0f;
                        base_t = 0.0f;
                    }
                    base_t = std::clamp(base_t, 0.0f, 1.0f);
                    break;
                case CinematicPlayback::manual:
                    base_t = std::clamp(base_t, 0.0f, 1.0f);
                    break;
            }

            // Step 4: Apply easing.
            float eased_t = apply_easing(std::clamp(base_t, 0.0f, 1.0f), params.cinematic_easing);

            // Step 5: Evaluate spline position.
            state.position = rails_[ri].path.evaluate(eased_t);

            // Step 6: Evaluate target based on target_mode.
            switch (params.target_mode) {
                case TargetMode::player:
                    state.target = spring_target_;
                    break;
                case TargetMode::target_path:
                    if (rails_[ri].has_target_path && rails_[ri].target_path.valid()) {
                        state.target = rails_[ri].target_path.evaluate(eased_t);
                    } else {
                        state.target = spring_target_;
                    }
                    break;
                case TargetMode::fixed_point:
                    state.target = params.fixed_position;
                    break;
            }

            // Step 7: Apply min_ground_clearance.
            float min_y = spring_target_.y + params.min_ground_clearance;
            if (state.position.y < min_y) {
                state.position.y = min_y;
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

    // Reset cinematic state on zone change.
    if (new_zone != prev_zone_entity_) {
        cinematic_timer_ = 0.0f;
        cinematic_state_ = CinematicState::idle;
        cinematic_reverse_ = false;
    }

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

    // Auto-start cinematic rail if play_on_enter.
    if (active_params->mode == CameraMode::cinematic_rail &&
        cinematic_state_ == CinematicState::idle &&
        active_params->play_on_enter) {
        cinematic_state_ = CinematicState::playing;
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

// ── Cinematic manual control ───────────────────────────────────────────────

const CameraParams* CameraZoneSystem::active_params_ptr() const {
    for (const auto& [id, vol] : volumes_) {
        if (id == active_zone_entity_) return &vol.params;
    }
    return &default_params_;
}

void CameraZoneSystem::set_cinematic_t(float t) {
    const auto* params = active_params_ptr();
    cinematic_timer_ = std::clamp(t, 0.0f, 1.0f) * params->cinematic_duration;
    if (cinematic_state_ == CinematicState::idle ||
        cinematic_state_ == CinematicState::finished) {
        cinematic_state_ = CinematicState::playing;
    }
}

void CameraZoneSystem::advance_cinematic_t(float delta_t) {
    const auto* params = active_params_ptr();
    cinematic_timer_ += delta_t * params->cinematic_duration;
    cinematic_timer_ = std::clamp(cinematic_timer_, 0.0f, params->cinematic_duration);
    if (cinematic_state_ == CinematicState::idle ||
        cinematic_state_ == CinematicState::finished) {
        cinematic_state_ = CinematicState::playing;
    }
}

void CameraZoneSystem::set_on_cinematic_complete(CinematicCompleteCallback cb) {
    on_cinematic_complete_ = std::move(cb);
}

}  // namespace gseurat
