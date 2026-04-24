#pragma once

#include "gseurat/engine/collision/primitive.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"  // for AABB

#include <glm/gtc/quaternion.hpp>
#include <optional>

#include "gseurat/engine/ecs/components/heightfield_component.hpp"

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

// ── Capsule sweep ─────────────────────────────────────────────────
std::optional<SweepHit> sweep_capsule(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);

// ── Heightfield ──────────────────────────────────────────────────────

struct HeightfieldInstance {
    glm::vec3 origin{0.0f};              // World-space min corner (from Transform)
    float width{100.0f};                 // World X extent
    float length{100.0f};                // World Z extent
    float min_height{0.0f};
    float max_height{50.0f};
    uint32_t collision_mask{0xFFFFFFFF};
    const HeightfieldData* data{nullptr}; // Non-owning pointer
    AABB world_aabb;
};

/// Sample terrain elevation at world (x,z). Returns nullopt if outside bounds.
std::optional<float> sample_height(const HeightfieldInstance& hf,
                                   float world_x, float world_z);

/// Compute surface normal at world (x,z) via central differences.
glm::vec3 heightfield_normal(const HeightfieldInstance& hf,
                             float world_x, float world_z);

/// Ray vs heightfield intersection using DDA grid traversal.
/// Triangles are single-sided (backface culling — rays from below are rejected).
std::optional<RayHit> ray_vs_heightfield(
    const glm::vec3& origin, const glm::vec3& direction,
    const HeightfieldInstance& hf);

/// Capsule overlap test against heightfield terrain.
/// Returns deepest penetrating contact (push-out toward capsule).
std::optional<Contact> capsule_vs_heightfield(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule, const HeightfieldInstance& hf);

}  // namespace gseurat
