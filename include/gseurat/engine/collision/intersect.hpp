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

}  // namespace gseurat
