#pragma once

#include "gseurat/engine/collision/primitive.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"  // for AABB

#include <glm/gtc/quaternion.hpp>
#include <optional>

namespace gseurat {

// ── AABB computation ──────────────────────────────────────────────
AABB compute_aabb(const BoxData& box, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const SphereData& sphere, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const CapsuleData& capsule, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);

bool aabb_overlaps(const AABB& a, const AABB& b);

// ── Ray-primitive intersection ────────────────────────────────────
std::optional<RayHit> ray_vs_sphere(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& center, float radius);

std::optional<RayHit> ray_vs_box(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& pos, const glm::quat& rot, const BoxData& box);

std::optional<RayHit> ray_vs_capsule(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& pos, const glm::quat& rot, const CapsuleData& capsule);

std::optional<RayHit> ray_intersect(
    const glm::vec3& origin, const glm::vec3& direction,
    const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);

// ── Capsule overlap with penetration ──────────────────────────────
std::optional<Contact> capsule_vs_sphere(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& sph_pos, const SphereData& sphere);

std::optional<Contact> capsule_vs_capsule(
    const glm::vec3& pos_a, const glm::quat& rot_a, const CapsuleData& a,
    const glm::vec3& pos_b, const glm::quat& rot_b, const CapsuleData& b);

std::optional<Contact> capsule_vs_box(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& box_pos, const glm::quat& box_rot, const BoxData& box);

}  // namespace gseurat
