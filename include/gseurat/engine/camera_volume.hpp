#pragma once

// camera_volume.hpp — Volume geometry for camera zone triggers.
//
// Provides AABB and Sphere shapes with contains/clamp/volume_size helpers,
// plus CameraVolume and CameraTrigger aggregates used by the camera pipeline.

#include <glm/glm.hpp>
#include <variant>
#include <cmath>
#include <algorithm>

namespace gseurat {

// ── Axis-Aligned Bounding Box ────────────────────────────────────────────────

struct AABB {
    glm::vec3 center{0.0f};
    glm::vec3 half_extents{1.0f};
};

// ── Sphere ───────────────────────────────────────────────────────────────────

struct Sphere {
    glm::vec3 center{0.0f};
    float radius{1.0f};
};

// ── VolumeShape variant ──────────────────────────────────────────────────────

using VolumeShape = std::variant<AABB, Sphere>;

// ── Free functions — AABB ────────────────────────────────────────────────────

/// Returns true if point p is inside or on the boundary of the AABB.
inline bool contains(const AABB& box, const glm::vec3& p) {
    glm::vec3 d = glm::abs(p - box.center);
    return d.x <= box.half_extents.x &&
           d.y <= box.half_extents.y &&
           d.z <= box.half_extents.z;
}

/// Clamps p to the nearest point on or inside the AABB.
inline glm::vec3 clamp_to(const AABB& box, const glm::vec3& p) {
    glm::vec3 lo = box.center - box.half_extents;
    glm::vec3 hi = box.center + box.half_extents;
    return glm::clamp(p, lo, hi);
}

/// Volume measure for an AABB: product of half-extents (proportional to volume).
inline float volume_size(const AABB& box) {
    return box.half_extents.x * box.half_extents.y * box.half_extents.z;
}

// ── Free functions — Sphere ──────────────────────────────────────────────────

/// Returns true if point p is inside or on the boundary of the sphere.
inline bool contains(const Sphere& sphere, const glm::vec3& p) {
    glm::vec3 d = p - sphere.center;
    float dist2 = d.x * d.x + d.y * d.y + d.z * d.z;
    return dist2 <= sphere.radius * sphere.radius;
}

/// Clamps p to the nearest point on or inside the sphere.
inline glm::vec3 clamp_to(const Sphere& sphere, const glm::vec3& p) {
    glm::vec3 d = p - sphere.center;
    float dist2 = d.x * d.x + d.y * d.y + d.z * d.z;
    if (dist2 <= sphere.radius * sphere.radius) {
        return p;  // already inside
    }
    float dist = std::sqrt(dist2);
    return sphere.center + (d / dist) * sphere.radius;
}

/// Volume measure for a sphere: r³ (proportional to volume, omitting π*4/3 constant).
inline float volume_size(const Sphere& sphere) {
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
    float fov{60.0f};
};

struct CameraParams {
    CameraMode mode{CameraMode::free_look};
    int priority{0};
    float blend_time{0.5f};
    bool allow_user_orbit{true};
    float pitch_min{-89.0f};
    float pitch_max{89.0f};
    float yaw_min{-180.0f};
    float yaw_max{180.0f};
    float fov{60.0f};
    float orbit_distance{10.0f};
    glm::vec3 offset{0.0f};
    glm::vec3 fixed_position{0.0f};
    int rail_index{-1};
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

}  // namespace gseurat
