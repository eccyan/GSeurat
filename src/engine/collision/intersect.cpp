#include "gseurat/engine/collision/intersect.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>
#include <algorithm>
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

std::optional<RayHit> ray_vs_sphere(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& center, float radius)
{
    glm::vec3 oc = origin - center;
    float a = glm::dot(direction, direction);
    float b = 2.0f * glm::dot(oc, direction);
    float c = glm::dot(oc, oc) - radius * radius;
    float disc = b * b - 4.0f * a * c;

    if (disc < 0.0f) return std::nullopt;

    float sqrt_disc = std::sqrt(disc);
    float t = (-b - sqrt_disc) / (2.0f * a);
    if (t < 0.0f) {
        t = (-b + sqrt_disc) / (2.0f * a);
    }
    if (t < 0.0f) return std::nullopt;

    glm::vec3 point  = origin + t * direction;
    glm::vec3 normal = glm::normalize(point - center);
    return RayHit{t, point, normal};
}

std::optional<RayHit> ray_vs_box(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& pos, const glm::quat& rot, const BoxData& box)
{
    glm::quat inv_rot = glm::inverse(rot);
    glm::vec3 lo = inv_rot * (origin - pos);
    glm::vec3 ld = inv_rot * direction;

    const glm::vec3& he = box.half_extents;

    float t_enter = -std::numeric_limits<float>::infinity();
    float t_exit  =  std::numeric_limits<float>::infinity();
    int   hit_axis = -1;
    float hit_sign =  1.0f;

    for (int i = 0; i < 3; ++i) {
        float d = ld[i];
        float o = lo[i];
        float h = he[i];

        if (std::abs(d) < 1e-8f) {
            // Ray is parallel to this slab — check if origin is inside it.
            if (o < -h || o > h) return std::nullopt;
        } else {
            float inv_d  = 1.0f / d;
            float t_near = (-h - o) * inv_d;
            float t_far  = ( h - o) * inv_d;
            if (t_near > t_far) std::swap(t_near, t_far);

            if (t_near > t_enter) {
                t_enter   = t_near;
                hit_axis  = i;
                hit_sign  = (d > 0.0f) ? -1.0f : 1.0f;
            }
            t_exit = std::min(t_exit, t_far);
        }
    }

    if (t_enter > t_exit || t_exit < 0.0f) return std::nullopt;
    if (t_enter < 0.0f) return std::nullopt;  // Ray starts inside box

    // Build local normal from the axis that was entered last.
    glm::vec3 local_normal(0.0f);
    local_normal[hit_axis] = hit_sign;

    glm::vec3 world_normal = glm::normalize(rot * local_normal);
    glm::vec3 point = origin + t_enter * direction;
    return RayHit{t_enter, point, world_normal};
}

std::optional<RayHit> ray_vs_capsule(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& pos, const glm::quat& rot, const CapsuleData& capsule)
{
    glm::quat inv_rot = glm::inverse(rot);
    glm::vec3 lo = inv_rot * (origin - pos);
    glm::vec3 ld = inv_rot * direction;

    float r   = capsule.radius;
    float hh  = capsule.half_height;

    float best_t = std::numeric_limits<float>::infinity();
    glm::vec3 best_local_normal;

    // ── 1. Infinite cylinder test (XZ plane only) ─────────────────────
    {
        float a = ld.x * ld.x + ld.z * ld.z;
        float b = 2.0f * (lo.x * ld.x + lo.z * ld.z);
        float c = lo.x * lo.x + lo.z * lo.z - r * r;
        float disc = b * b - 4.0f * a * c;

        if (disc >= 0.0f && std::abs(a) > 1e-8f) {
            float sqrt_disc = std::sqrt(disc);
            float t0 = (-b - sqrt_disc) / (2.0f * a);
            float t1 = (-b + sqrt_disc) / (2.0f * a);
            // Try smallest positive t first
            for (float t : {t0, t1}) {
                if (t < 0.0f) continue;
                float y_hit = lo.y + t * ld.y;
                if (y_hit >= -hh && y_hit <= hh) {
                    if (t < best_t) {
                        best_t = t;
                        glm::vec3 hit_local = lo + t * ld;
                        best_local_normal = glm::normalize(glm::vec3(hit_local.x, 0.0f, hit_local.z));
                    }
                    break;  // smallest valid cylinder t found
                }
            }
        }
    }

    // ── 2. Hemisphere cap tests ───────────────────────────────────────
    auto test_cap = [&](float cap_y) {
        glm::vec3 cap_center_local(0.0f, cap_y, 0.0f);
        glm::vec3 oc = lo - cap_center_local;
        float a = glm::dot(ld, ld);
        float b = 2.0f * glm::dot(oc, ld);
        float c = glm::dot(oc, oc) - r * r;
        float disc = b * b - 4.0f * a * c;
        if (disc < 0.0f) return;

        float sqrt_disc = std::sqrt(disc);
        float t = (-b - sqrt_disc) / (2.0f * a);
        if (t < 0.0f) t = (-b + sqrt_disc) / (2.0f * a);
        if (t < 0.0f) return;

        glm::vec3 hit_local = lo + t * ld;
        // Only count hits that are on the hemisphere half (y >= cap_y for top, y <= cap_y for bottom)
        bool on_cap = (cap_y > 0.0f) ? (hit_local.y >= cap_y) : (hit_local.y <= cap_y);
        if (!on_cap) return;

        if (t < best_t) {
            best_t = t;
            best_local_normal = glm::normalize(hit_local - cap_center_local);
        }
    };

    test_cap( hh);
    test_cap(-hh);

    if (best_t == std::numeric_limits<float>::infinity()) return std::nullopt;

    glm::vec3 world_normal = glm::normalize(rot * best_local_normal);
    glm::vec3 point = origin + best_t * direction;
    return RayHit{best_t, point, world_normal};
}

std::optional<RayHit> ray_intersect(
    const glm::vec3& origin, const glm::vec3& direction,
    const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot)
{
    return std::visit([&](const auto& s) -> std::optional<RayHit> {
        using T = std::decay_t<decltype(s)>;
        if constexpr (std::is_same_v<T, SphereData>) {
            return ray_vs_sphere(origin, direction, pos, s.radius);
        } else if constexpr (std::is_same_v<T, BoxData>) {
            return ray_vs_box(origin, direction, pos, rot, s);
        } else if constexpr (std::is_same_v<T, CapsuleData>) {
            return ray_vs_capsule(origin, direction, pos, rot, s);
        }
    }, shape);
}

}  // namespace gseurat
