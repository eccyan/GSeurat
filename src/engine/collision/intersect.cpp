#include "gseurat/engine/collision/intersect.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>
#include <algorithm>
#include <cmath>

namespace gseurat {

AABB compute_aabb(const BoxData& box, const glm::vec3& pos, const glm::quat& rot) {
    // For an OBB, project each local axis into world space and take the absolute
    // value to compute the maximum extent in each world axis.
    // Clamp to non-negative to prevent inverted AABBs from malformed data.
    glm::vec3 safe_ext = glm::max(box.half_extents, glm::vec3(0.0f));
    glm::mat3 rotMat = glm::mat3_cast(rot);

    glm::vec3 expanded;
    for (int i = 0; i < 3; ++i) {
        expanded[i] = std::abs(rotMat[0][i]) * safe_ext.x
                    + std::abs(rotMat[1][i]) * safe_ext.y
                    + std::abs(rotMat[2][i]) * safe_ext.z;
    }

    return AABB{pos - expanded, pos + expanded};
}

AABB compute_aabb(const SphereData& sphere, const glm::vec3& pos, const glm::quat& /*rot*/) {
    // Rotation is irrelevant for a sphere.
    float safe_r = std::max(sphere.radius, 0.0f);
    glm::vec3 r{safe_r};
    return AABB{pos - r, pos + r};
}

AABB compute_aabb(const CapsuleData& capsule, const glm::vec3& pos, const glm::quat& rot) {
    // Capsule is aligned along local Y-axis. The two hemisphere centers are offset
    // by ±half_height along the rotated Y axis.
    // Clamp to non-negative to prevent inverted AABBs from malformed data.
    float safe_hh = std::max(capsule.half_height, 0.0f);
    float safe_r  = std::max(capsule.radius, 0.0f);
    glm::vec3 local_y{0.0f, 1.0f, 0.0f};
    glm::vec3 offset = rot * local_y * safe_hh;

    glm::vec3 top    = pos + offset;
    glm::vec3 bottom = pos - offset;

    // Compute AABB of the two hemisphere centers, then expand by radius.
    glm::vec3 aabb_min = glm::min(top, bottom) - glm::vec3(safe_r);
    glm::vec3 aabb_max = glm::max(top, bottom) + glm::vec3(safe_r);

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

// ── Internal helpers for capsule overlap ─────────────────────────────────────

static glm::vec3 closest_point_on_segment(const glm::vec3& a, const glm::vec3& b, const glm::vec3& p) {
    glm::vec3 ab = b - a;
    float len2 = glm::dot(ab, ab);
    if (len2 < 1e-8f) return a;  // degenerate segment
    float t = glm::clamp(glm::dot(p - a, ab) / len2, 0.0f, 1.0f);
    return a + t * ab;
}

static std::pair<glm::vec3, glm::vec3> closest_points_segments(
    const glm::vec3& a1, const glm::vec3& b1,
    const glm::vec3& a2, const glm::vec3& b2)
{
    glm::vec3 d1 = b1 - a1;
    glm::vec3 d2 = b2 - a2;
    glm::vec3 r  = a1 - a2;

    float e = glm::dot(d2, d2);
    float f = glm::dot(d2, r);

    float s, t;

    float c = glm::dot(d1, r);
    float a = glm::dot(d1, d1);
    float b = glm::dot(d1, d2);
    float denom = a * e - b * b;

    if (denom < 1e-8f) {
        // Parallel segments: fix s=0, solve for t
        s = 0.0f;
        t = (e > 1e-8f) ? glm::clamp(f / e, 0.0f, 1.0f) : 0.0f;
    } else {
        s = glm::clamp((b * f - c * e) / denom, 0.0f, 1.0f);
        t = (b * s + f) / e;

        if (t < 0.0f) {
            t = 0.0f;
            s = glm::clamp(-c / a, 0.0f, 1.0f);
        } else if (t > 1.0f) {
            t = 1.0f;
            s = glm::clamp((b - c) / a, 0.0f, 1.0f);
        }
    }

    return {a1 + s * d1, a2 + t * d2};
}

static glm::vec3 closest_point_on_obb(
    const glm::vec3& p,
    const glm::vec3& box_pos, const glm::quat& box_rot, const BoxData& box)
{
    glm::quat inv_rot = glm::inverse(box_rot);
    glm::vec3 local_p = inv_rot * (p - box_pos);
    glm::vec3 clamped = glm::clamp(local_p, -box.half_extents, box.half_extents);
    return box_pos + box_rot * clamped;
}

// ── Capsule overlap implementations ──────────────────────────────────────────

std::optional<Contact> capsule_vs_sphere(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& sph_pos, const SphereData& sphere)
{
    glm::vec3 up   = cap_rot * glm::vec3(0.0f, 1.0f, 0.0f);
    glm::vec3 seg_a = cap_pos - up * capsule.half_height;
    glm::vec3 seg_b = cap_pos + up * capsule.half_height;

    glm::vec3 cp   = closest_point_on_segment(seg_a, seg_b, sph_pos);
    float dist      = glm::length(cp - sph_pos);
    float combined_r = capsule.radius + sphere.radius;

    if (dist >= combined_r) return std::nullopt;

    glm::vec3 normal;
    if (dist < 1e-8f) {
        normal = glm::vec3(0.0f, 1.0f, 0.0f);
    } else {
        normal = glm::normalize(cp - sph_pos);
    }

    float depth = combined_r - dist;
    glm::vec3 point = sph_pos + normal * sphere.radius;
    return Contact{point, normal, depth};
}

std::optional<Contact> capsule_vs_capsule(
    const glm::vec3& pos_a, const glm::quat& rot_a, const CapsuleData& a,
    const glm::vec3& pos_b, const glm::quat& rot_b, const CapsuleData& b)
{
    glm::vec3 up_a  = rot_a * glm::vec3(0.0f, 1.0f, 0.0f);
    glm::vec3 seg_a1 = pos_a - up_a * a.half_height;
    glm::vec3 seg_a2 = pos_a + up_a * a.half_height;

    glm::vec3 up_b  = rot_b * glm::vec3(0.0f, 1.0f, 0.0f);
    glm::vec3 seg_b1 = pos_b - up_b * b.half_height;
    glm::vec3 seg_b2 = pos_b + up_b * b.half_height;

    auto [cp1, cp2] = closest_points_segments(seg_a1, seg_a2, seg_b1, seg_b2);

    float dist       = glm::length(cp1 - cp2);
    float combined_r = a.radius + b.radius;

    if (dist >= combined_r) return std::nullopt;

    glm::vec3 normal;
    if (dist < 1e-8f) {
        normal = glm::vec3(0.0f, 1.0f, 0.0f);
    } else {
        normal = glm::normalize(cp1 - cp2);
    }

    float depth = combined_r - dist;
    glm::vec3 point = cp2 + normal * b.radius;
    return Contact{point, normal, depth};
}

std::optional<Contact> capsule_vs_box(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& box_pos, const glm::quat& box_rot, const BoxData& box)
{
    glm::vec3 up    = cap_rot * glm::vec3(0.0f, 1.0f, 0.0f);
    glm::vec3 seg_a = cap_pos - up * capsule.half_height;
    glm::vec3 seg_b = cap_pos + up * capsule.half_height;
    glm::vec3 seg_m = (seg_a + seg_b) * 0.5f;

    // Build candidate capsule points and find their closest OBB points
    glm::vec3 candidates[4] = {seg_a, seg_b, seg_m,
        closest_point_on_segment(seg_a, seg_b, box_pos)};

    float min_dist     = std::numeric_limits<float>::infinity();
    glm::vec3 best_cap = seg_m;
    glm::vec3 best_obb = closest_point_on_obb(seg_m, box_pos, box_rot, box);

    for (const glm::vec3& cap_pt : candidates) {
        glm::vec3 obb_pt = closest_point_on_obb(cap_pt, box_pos, box_rot, box);
        float d = glm::length(cap_pt - obb_pt);
        if (d < min_dist) {
            min_dist = d;
            best_cap = cap_pt;
            best_obb = obb_pt;
        }
    }

    if (min_dist >= capsule.radius) return std::nullopt;

    glm::vec3 normal;
    float depth;

    if (min_dist < 1e-8f) {
        // Capsule center inside box — push out along nearest face
        glm::quat inv_rot = glm::inverse(box_rot);
        glm::vec3 local_p = inv_rot * (best_cap - box_pos);
        glm::vec3 he = box.half_extents;

        // Find which face is closest (smallest penetration per axis)
        float min_pen = std::numeric_limits<float>::infinity();
        int   axis    = 0;
        float sign    = 1.0f;

        for (int i = 0; i < 3; ++i) {
            float pen_pos = he[i] - local_p[i];
            float pen_neg = he[i] + local_p[i];
            if (pen_pos < min_pen) { min_pen = pen_pos; axis = i; sign =  1.0f; }
            if (pen_neg < min_pen) { min_pen = pen_neg; axis = i; sign = -1.0f; }
        }

        glm::vec3 local_normal(0.0f);
        local_normal[axis] = sign;
        normal = glm::normalize(box_rot * local_normal);
        depth  = capsule.radius + min_pen;
    } else {
        normal = glm::normalize(best_cap - best_obb);
        depth  = capsule.radius - min_dist;
    }

    return Contact{best_obb, normal, depth};
}

// ── Capsule sweep ────────────────────────────────────────────────────────────

std::optional<SweepHit> sweep_capsule(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot)
{
    if (max_distance <= 0.0f) return std::nullopt;

    glm::vec3 dir = glm::normalize(direction);

    // Helper to test overlap at a given position
    auto test_overlap = [&](const glm::vec3& test_pos) -> std::optional<Contact> {
        return std::visit([&](const auto& s) -> std::optional<Contact> {
            using T = std::decay_t<decltype(s)>;
            if constexpr (std::is_same_v<T, SphereData>)
                return capsule_vs_sphere(test_pos, cap_rot, capsule, pos, s);
            else if constexpr (std::is_same_v<T, CapsuleData>)
                return capsule_vs_capsule(test_pos, cap_rot, capsule, pos, rot, s);
            else if constexpr (std::is_same_v<T, BoxData>)
                return capsule_vs_box(test_pos, cap_rot, capsule, pos, rot, s);
            else
                return std::nullopt;
        }, shape);
    };

    // Check if already overlapping at start
    auto start_contact = test_overlap(cap_pos);
    if (start_contact) {
        return SweepHit{0.0f, start_contact->point, start_contact->normal};
    }

    // Check if endpoint overlaps (if not, no hit along the path)
    glm::vec3 end_pos = cap_pos + dir * max_distance;
    auto end_contact = test_overlap(end_pos);
    if (!end_contact) {
        // Sample at 25%, 50%, 75% of the distance for thin obstacles
        bool any_hit = false;
        float hit_t_approx = max_distance;
        for (float frac : {0.25f, 0.5f, 0.75f}) {
            glm::vec3 mid = cap_pos + dir * (max_distance * frac);
            if (test_overlap(mid)) {
                any_hit = true;
                hit_t_approx = max_distance * frac;
                break;
            }
        }
        if (!any_hit) return std::nullopt;
        // Binary search from start to the intermediate hit point
        end_pos = cap_pos + dir * hit_t_approx;
        end_contact = test_overlap(end_pos);
    }

    // Binary search for exact contact point
    float lo = 0.0f;
    float hi = glm::length(end_pos - cap_pos);  // distance where overlap exists
    Contact last_contact = *end_contact;

    for (int i = 0; i < 16; ++i) {
        float mid = (lo + hi) * 0.5f;
        glm::vec3 mid_pos = cap_pos + dir * mid;
        auto contact = test_overlap(mid_pos);
        if (contact) {
            hi = mid;
            last_contact = *contact;
        } else {
            lo = mid;
        }
    }

    float t = glm::clamp(hi / max_distance, 0.0f, 1.0f);
    return SweepHit{t, last_contact.point, last_contact.normal};
}

}  // namespace gseurat
