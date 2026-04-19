#pragma once

// camera_volume.hpp — Volume geometry for camera zone triggers.
//
// Provides CamAABB and CamSphere shapes with contains/clamp/volume_size helpers,
// plus CameraVolume and CameraTrigger aggregates used by the camera pipeline.

#include <glm/glm.hpp>
#include <variant>
#include <vector>
#include <utility>
#include <cmath>
#include <algorithm>

namespace gseurat {

// ── Axis-Aligned Bounding Box ────────────────────────────────────────────────

struct CamAABB {
    glm::vec3 center{0.0f};
    glm::vec3 half_extents{1.0f};
};

// ── Sphere ───────────────────────────────────────────────────────────────────

struct CamSphere {
    glm::vec3 center{0.0f};
    float radius{1.0f};
};

// ── VolumeShape variant ──────────────────────────────────────────────────────

using VolumeShape = std::variant<CamAABB, CamSphere>;

// ── Free functions — CamAABB ────────────────────────────────────────────────────

/// Returns true if point p is inside or on the boundary of the CamAABB.
inline bool contains(const CamAABB& box, const glm::vec3& p) {
    glm::vec3 d = glm::abs(p - box.center);
    return d.x <= box.half_extents.x &&
           d.y <= box.half_extents.y &&
           d.z <= box.half_extents.z;
}

/// Clamps p to the nearest point on or inside the CamAABB.
inline glm::vec3 clamp_to(const CamAABB& box, const glm::vec3& p) {
    glm::vec3 lo = box.center - box.half_extents;
    glm::vec3 hi = box.center + box.half_extents;
    return glm::clamp(p, lo, hi);
}

/// Volume measure for a CamAABB: product of half-extents (proportional to volume).
inline float volume_size(const CamAABB& box) {
    return box.half_extents.x * box.half_extents.y * box.half_extents.z;
}

// ── Free functions — CamSphere ──────────────────────────────────────────────────

/// Returns true if point p is inside or on the boundary of the sphere.
inline bool contains(const CamSphere& sphere, const glm::vec3& p) {
    glm::vec3 d = p - sphere.center;
    float dist2 = d.x * d.x + d.y * d.y + d.z * d.z;
    return dist2 <= sphere.radius * sphere.radius;
}

/// Clamps p to the nearest point on or inside the sphere.
inline glm::vec3 clamp_to(const CamSphere& sphere, const glm::vec3& p) {
    glm::vec3 d = p - sphere.center;
    float dist2 = d.x * d.x + d.y * d.y + d.z * d.z;
    if (dist2 <= sphere.radius * sphere.radius) {
        return p;  // already inside
    }
    float dist = std::sqrt(dist2);
    return sphere.center + (d / dist) * sphere.radius;
}

/// Volume measure for a sphere: r³ (proportional to volume, omitting π*4/3 constant).
inline float volume_size(const CamSphere& sphere) {
    return sphere.radius * sphere.radius * sphere.radius;
}

// ── Free functions — VolumeShape variant ────────────────────────────────────

inline bool contains(const VolumeShape& shape, const glm::vec3& p) {
    return std::visit([&](const auto& s) { return contains(s, p); }, shape);
}

inline glm::vec3 clamp_to(const VolumeShape& shape, const glm::vec3& p) {
    return std::visit([&](const auto& s) { return clamp_to(s, p); }, shape);
}

inline float volume_size(const VolumeShape& shape) {
    return std::visit([&](const auto& s) { return volume_size(s); }, shape);
}

// ── Camera enums and structs ─────────────────────────────────────────────────

enum class CameraMode : uint8_t {
    free_look,
    rail_follow,
    cinematic_rail,
    fixed_point,
    side_scroll,
};

struct CameraState {
    glm::vec3 position{0.0f};
    glm::vec3 target{0.0f, 0.0f, -1.0f};
    glm::vec3 up{0.0f, 1.0f, 0.0f};
    float fov{45.0f};
};

struct CameraParams {
    CameraMode mode{CameraMode::free_look};
    int priority{0};
    float blend_time{1.0f};
    bool allow_user_orbit{true};
    float pitch_min{-60.0f};
    float pitch_max{10.0f};
    float yaw_min{-180.0f};
    float yaw_max{180.0f};
    float fov{45.0f};
    float orbit_distance{10.0f};
    glm::vec3 offset{0.0f, 5.0f, -10.0f};
    glm::vec3 fixed_position{0.0f};
    int rail_index{-1};
    float min_ground_clearance{10.0f};  // Minimum Y above player (terrain) for rail cameras
    float target_y_offset{2.5f};       // Y offset above player for camera look-at target
};

struct CameraVolume {
    VolumeShape shape;
    CameraParams params;
    float cached_volume_size{0.0f};
};

struct CameraTrigger {
    VolumeShape shape;
    int from_zone_entity{-1};
    int to_zone_entity{-1};
    float blend_override{-1.0f};  // negative = use destination params
};

// ── Zone priority resolution ─────────────────────────────────────────────────

/// Resolve which zone wins when the player is inside multiple volumes.
///
/// Rules:
///   - Manual zones (priority > 0) always beat auto zones (priority == 0).
///   - Among manual zones: highest priority wins; tie-break by lowest entity ID.
///   - Among auto zones: smallest cached_volume_size wins; tie-break by lowest entity ID.
///
/// Returns {entity_id, volume_ptr}. Returns {-1, nullptr} if candidates is empty.
inline std::pair<int, const CameraVolume*> resolve_zone_priority(
    const std::vector<std::pair<int, const CameraVolume*>>& candidates)
{
    if (candidates.empty()) {
        return {-1, nullptr};
    }

    // Partition into manual (priority > 0) and auto (priority == 0) groups.
    const std::pair<int, const CameraVolume*>* best_manual = nullptr;
    const std::pair<int, const CameraVolume*>* best_auto   = nullptr;

    for (const auto& c : candidates) {
        if (c.second->params.priority > 0) {
            // Manual: prefer higher priority, tie-break lower entity ID.
            if (!best_manual ||
                c.second->params.priority > best_manual->second->params.priority ||
                (c.second->params.priority == best_manual->second->params.priority &&
                 c.first < best_manual->first)) {
                best_manual = &c;
            }
        } else {
            // Auto: prefer smaller cached_volume_size, tie-break lower entity ID.
            if (!best_auto ||
                c.second->cached_volume_size < best_auto->second->cached_volume_size ||
                (c.second->cached_volume_size == best_auto->second->cached_volume_size &&
                 c.first < best_auto->first)) {
                best_auto = &c;
            }
        }
    }

    // Manual always beats auto.
    const auto* winner = best_manual ? best_manual : best_auto;
    return {winner->first, winner->second};
}

}  // namespace gseurat
