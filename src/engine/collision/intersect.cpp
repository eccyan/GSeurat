#include "gseurat/engine/collision/intersect.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <cmath>

namespace gseurat {

AABB compute_aabb(const BoxData& box, const glm::vec3& pos, const glm::quat& rot) {
    // For an OBB, project each local axis into world space and take the absolute
    // value to compute the maximum extent in each world axis.
    glm::mat3 rotMat = glm::mat3_cast(rot);

    glm::vec3 expanded;
    for (int i = 0; i < 3; ++i) {
        expanded[i] = std::abs(rotMat[0][i]) * box.half_extents.x
                    + std::abs(rotMat[1][i]) * box.half_extents.y
                    + std::abs(rotMat[2][i]) * box.half_extents.z;
    }

    return AABB{pos - expanded, pos + expanded};
}

AABB compute_aabb(const SphereData& sphere, const glm::vec3& pos, const glm::quat& /*rot*/) {
    // Rotation is irrelevant for a sphere.
    glm::vec3 r{sphere.radius};
    return AABB{pos - r, pos + r};
}

AABB compute_aabb(const CapsuleData& capsule, const glm::vec3& pos, const glm::quat& rot) {
    // Capsule is aligned along local Y-axis. The two hemisphere centers are offset
    // by ±half_height along the rotated Y axis.
    glm::vec3 local_y{0.0f, 1.0f, 0.0f};
    glm::vec3 offset = rot * local_y * capsule.half_height;

    glm::vec3 top    = pos + offset;
    glm::vec3 bottom = pos - offset;

    // Compute AABB of the two hemisphere centers, then expand by radius.
    glm::vec3 aabb_min = glm::min(top, bottom) - glm::vec3(capsule.radius);
    glm::vec3 aabb_max = glm::max(top, bottom) + glm::vec3(capsule.radius);

    return AABB{aabb_min, aabb_max};
}

AABB compute_aabb(const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot) {
    return std::visit([&](const auto& s) { return compute_aabb(s, pos, rot); }, shape);
}

bool aabb_overlaps(const AABB& a, const AABB& b) {
    return a.max.x >= b.min.x && a.min.x <= b.max.x
        && a.max.y >= b.min.y && a.min.y <= b.max.y
        && a.max.z >= b.min.z && a.min.z <= b.max.z;
}

}  // namespace gseurat
