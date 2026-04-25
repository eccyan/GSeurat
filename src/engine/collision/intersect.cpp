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

// ── Heightfield helpers ──────────────────────────────────────────────

std::optional<float> sample_height(const HeightfieldInstance& hf,
                                   float world_x, float world_z) {
    if (!hf.data || hf.data->img_width == 0 || hf.data->img_height == 0)
        return std::nullopt;

    float u = (world_x - hf.origin.x) / hf.width;
    float v = (world_z - hf.origin.z) / hf.length;

    if (u < 0.0f || u > 1.0f || v < 0.0f || v > 1.0f)
        return std::nullopt;

    float px = u * static_cast<float>(hf.data->img_width - 1);
    float pz = v * static_cast<float>(hf.data->img_height - 1);

    uint32_t ix = static_cast<uint32_t>(px);
    uint32_t iz = static_cast<uint32_t>(pz);

    // Clamp to valid range
    uint32_t ix1 = std::min(ix + 1, hf.data->img_width - 1);
    uint32_t iz1 = std::min(iz + 1, hf.data->img_height - 1);

    float fx = px - static_cast<float>(ix);
    float fz = pz - static_cast<float>(iz);

    auto sample = [&](uint32_t sx, uint32_t sz) -> float {
        return static_cast<float>(
            hf.data->samples[sz * hf.data->img_width + sx]);
    };

    float s00 = sample(ix,  iz);
    float s10 = sample(ix1, iz);
    float s01 = sample(ix,  iz1);
    float s11 = sample(ix1, iz1);

    // Bilinear interpolation
    float s = (s00 * (1.0f - fx) + s10 * fx) * (1.0f - fz) +
              (s01 * (1.0f - fx) + s11 * fx) * fz;

    return hf.origin.y + hf.min_height + (s / 65535.0f) * (hf.max_height - hf.min_height);
}

glm::vec3 heightfield_normal(const HeightfieldInstance& hf,
                             float world_x, float world_z) {
    // Half-texel epsilon in world space
    float eps_x = hf.width / static_cast<float>(hf.data->img_width) * 0.5f;
    float eps_z = hf.length / static_cast<float>(hf.data->img_height) * 0.5f;
    float eps = std::min(eps_x, eps_z);

    auto h_center = sample_height(hf, world_x, world_z);
    float fallback = h_center.value_or(0.0f);

    auto h_left  = sample_height(hf, world_x - eps, world_z);
    auto h_right = sample_height(hf, world_x + eps, world_z);
    auto h_back  = sample_height(hf, world_x, world_z - eps);
    auto h_front = sample_height(hf, world_x, world_z + eps);

    // At edges, fall back to center height (flat normal) instead of 0
    float dx = h_right.value_or(fallback) - h_left.value_or(fallback);
    float dz = h_front.value_or(fallback) - h_back.value_or(fallback);

    glm::vec3 n(-dx, 2.0f * eps, -dz);
    return glm::normalize(n);
}

// ── Ray-triangle (Moller-Trumbore, backface culling) ────────────────

static std::optional<RayHit> ray_vs_triangle(
    const glm::vec3& origin, const glm::vec3& dir,
    const glm::vec3& v0, const glm::vec3& v1, const glm::vec3& v2)
{
    glm::vec3 e1 = v1 - v0;
    glm::vec3 e2 = v2 - v0;
    glm::vec3 h  = glm::cross(dir, e2);
    float a = glm::dot(e1, h);

    // Backface cull: only front-face hits (a > 0 means front-facing)
    if (a < 1e-7f) return std::nullopt;

    float f = 1.0f / a;
    glm::vec3 s = origin - v0;
    float u = f * glm::dot(s, h);
    if (u < 0.0f || u > 1.0f) return std::nullopt;

    glm::vec3 q = glm::cross(s, e1);
    float v = f * glm::dot(dir, q);
    if (v < 0.0f || u + v > 1.0f) return std::nullopt;

    float t = f * glm::dot(e2, q);
    if (t < 0.0f) return std::nullopt;

    glm::vec3 normal = glm::normalize(glm::cross(e1, e2));
    glm::vec3 point  = origin + t * dir;
    return RayHit{t, point, normal};
}

// ── Ray vs heightfield (DDA grid traversal) ─────────────────────────

std::optional<RayHit> ray_vs_heightfield(
    const glm::vec3& origin, const glm::vec3& direction,
    const HeightfieldInstance& hf)
{
    if (!hf.data || hf.data->img_width < 2 || hf.data->img_height < 2)
        return std::nullopt;

    uint32_t cols = hf.data->img_width;
    uint32_t rows = hf.data->img_height;

    float cell_w = hf.width  / static_cast<float>(cols - 1);
    float cell_h = hf.length / static_cast<float>(rows - 1);

    // Helper: grid (ix, iz) -> world position
    auto vertex = [&](uint32_t ix, uint32_t iz) -> glm::vec3 {
        float wx = hf.origin.x + static_cast<float>(ix) * cell_w;
        float wz = hf.origin.z + static_cast<float>(iz) * cell_h;
        float s  = static_cast<float>(hf.data->samples[iz * cols + ix]);
        float wy = hf.origin.y + hf.min_height + (s / 65535.0f) * (hf.max_height - hf.min_height);
        return glm::vec3(wx, wy, wz);
    };

    // Slab test against heightfield XZ bounds to find entry/exit t
    float xmin = hf.origin.x;
    float xmax = hf.origin.x + hf.width;
    float zmin = hf.origin.z;
    float zmax = hf.origin.z + hf.length;

    float t_enter = 0.0f;
    float t_exit  = std::numeric_limits<float>::max();

    // X slab
    if (std::abs(direction.x) < 1e-8f) {
        if (origin.x < xmin || origin.x > xmax) return std::nullopt;
    } else {
        float inv = 1.0f / direction.x;
        float t0 = (xmin - origin.x) * inv;
        float t1 = (xmax - origin.x) * inv;
        if (t0 > t1) std::swap(t0, t1);
        t_enter = std::max(t_enter, t0);
        t_exit  = std::min(t_exit, t1);
    }

    // Z slab
    if (std::abs(direction.z) < 1e-8f) {
        if (origin.z < zmin || origin.z > zmax) return std::nullopt;
    } else {
        float inv = 1.0f / direction.z;
        float t0 = (zmin - origin.z) * inv;
        float t1 = (zmax - origin.z) * inv;
        if (t0 > t1) std::swap(t0, t1);
        t_enter = std::max(t_enter, t0);
        t_exit  = std::min(t_exit, t1);
    }

    if (t_enter > t_exit || t_exit < 0.0f) return std::nullopt;
    t_enter = std::max(t_enter, 0.0f);

    // Entry point in world space -> grid coordinates
    glm::vec3 entry = origin + t_enter * direction;
    float gx = (entry.x - hf.origin.x) / cell_w;
    float gz = (entry.z - hf.origin.z) / cell_h;

    int ix = static_cast<int>(gx);
    int iz = static_cast<int>(gz);
    ix = std::clamp(ix, 0, static_cast<int>(cols) - 2);
    iz = std::clamp(iz, 0, static_cast<int>(rows) - 2);

    // DDA step setup
    int step_x = (direction.x >= 0.0f) ? 1 : -1;
    int step_z = (direction.z >= 0.0f) ? 1 : -1;

    // t values for crossing next cell boundary
    auto next_t_x = [&](int cx) -> float {
        float boundary = hf.origin.x + static_cast<float>(step_x > 0 ? cx + 1 : cx) * cell_w;
        if (std::abs(direction.x) < 1e-8f) return std::numeric_limits<float>::max();
        return (boundary - origin.x) / direction.x;
    };
    auto next_t_z = [&](int cz) -> float {
        float boundary = hf.origin.z + static_cast<float>(step_z > 0 ? cz + 1 : cz) * cell_h;
        if (std::abs(direction.z) < 1e-8f) return std::numeric_limits<float>::max();
        return (boundary - origin.z) / direction.z;
    };

    float t_next_x = next_t_x(ix);
    float t_next_z = next_t_z(iz);

    float dt_x = (std::abs(direction.x) > 1e-8f) ? std::abs(cell_w / direction.x)
                                                   : std::numeric_limits<float>::max();
    float dt_z = (std::abs(direction.z) > 1e-8f) ? std::abs(cell_h / direction.z)
                                                   : std::numeric_limits<float>::max();

    int max_steps = static_cast<int>(cols + rows);

    for (int step = 0; step < max_steps; ++step) {
        if (ix < 0 || ix >= static_cast<int>(cols) - 1 ||
            iz < 0 || iz >= static_cast<int>(rows) - 1)
            break;

        uint32_t ux = static_cast<uint32_t>(ix);
        uint32_t uz = static_cast<uint32_t>(iz);

        glm::vec3 v00 = vertex(ux,     uz);
        glm::vec3 v10 = vertex(ux + 1, uz);
        glm::vec3 v01 = vertex(ux,     uz + 1);
        glm::vec3 v11 = vertex(ux + 1, uz + 1);

        // Split cell along shorter diagonal.
        // Winding order: CCW when viewed from above (+Y), so cross(e1,e2) points up.
        float diag_a = glm::length(v00 - v11);
        float diag_b = glm::length(v10 - v01);

        std::optional<RayHit> hit;
        if (diag_a <= diag_b) {
            // Split: v00-v11 diagonal  ->  tri(v00,v11,v10) and tri(v00,v01,v11)
            hit = ray_vs_triangle(origin, direction, v00, v11, v10);
            if (!hit) hit = ray_vs_triangle(origin, direction, v00, v01, v11);
        } else {
            // Split: v10-v01 diagonal  ->  tri(v00,v01,v10) and tri(v10,v01,v11)
            hit = ray_vs_triangle(origin, direction, v00, v01, v10);
            if (!hit) hit = ray_vs_triangle(origin, direction, v10, v01, v11);
        }

        if (hit) return hit;

        // Advance DDA
        if (t_next_x < t_next_z) {
            ix += step_x;
            t_next_x += dt_x;
        } else {
            iz += step_z;
            t_next_z += dt_z;
        }
    }

    return std::nullopt;
}

// ── Capsule vs triangle (static helper) ─────────────────────────────

static glm::vec3 closest_point_on_triangle(
    const glm::vec3& p,
    const glm::vec3& v0, const glm::vec3& v1, const glm::vec3& v2)
{
    glm::vec3 e0 = v1 - v0;
    glm::vec3 e1 = v2 - v0;
    glm::vec3 v  = v0 - p;

    float a = glm::dot(e0, e0);
    float b = glm::dot(e0, e1);
    float c = glm::dot(e1, e1);
    float d = glm::dot(e0, v);
    float e = glm::dot(e1, v);

    float det = a * c - b * b;
    float s   = b * e - c * d;
    float t   = b * d - a * e;

    if (s + t <= det) {
        if (s < 0.0f) {
            if (t < 0.0f) {
                // Region 4
                if (d < 0.0f) { s = glm::clamp(-d / a, 0.0f, 1.0f); t = 0.0f; }
                else          { s = 0.0f; t = glm::clamp(-e / c, 0.0f, 1.0f); }
            } else {
                // Region 3
                s = 0.0f;
                t = glm::clamp(-e / c, 0.0f, 1.0f);
            }
        } else if (t < 0.0f) {
            // Region 5
            s = glm::clamp(-d / a, 0.0f, 1.0f);
            t = 0.0f;
        } else {
            // Region 0 (inside triangle)
            float inv_det = 1.0f / det;
            s *= inv_det;
            t *= inv_det;
        }
    } else {
        if (s < 0.0f) {
            // Region 2
            float tmp0 = b + d;
            float tmp1 = c + e;
            if (tmp1 > tmp0) {
                float numer = tmp1 - tmp0;
                float denom2 = a - 2.0f * b + c;
                s = glm::clamp(numer / denom2, 0.0f, 1.0f);
                t = 1.0f - s;
            } else {
                s = 0.0f;
                t = glm::clamp(-e / c, 0.0f, 1.0f);
            }
        } else if (t < 0.0f) {
            // Region 6
            float tmp0 = b + e;
            float tmp1 = a + d;
            if (tmp1 > tmp0) {
                float numer = tmp1 - tmp0;
                float denom2 = a - 2.0f * b + c;
                t = glm::clamp(numer / denom2, 0.0f, 1.0f);
                s = 1.0f - t;
            } else {
                t = 0.0f;
                s = glm::clamp(-d / a, 0.0f, 1.0f);
            }
        } else {
            // Region 1
            float numer = (c + e) - (b + d);
            float denom2 = a - 2.0f * b + c;
            s = glm::clamp(numer / denom2, 0.0f, 1.0f);
            t = 1.0f - s;
        }
    }

    return v0 + s * e0 + t * e1;
}

static std::optional<Contact> capsule_vs_triangle(
    const glm::vec3& seg_a, const glm::vec3& seg_b, float radius,
    const glm::vec3& v0, const glm::vec3& v1, const glm::vec3& v2)
{
    // Compute triangle normal
    glm::vec3 e1 = v1 - v0;
    glm::vec3 e2 = v2 - v0;
    glm::vec3 tri_normal = glm::cross(e1, e2);
    float tri_len2 = glm::dot(tri_normal, tri_normal);
    if (tri_len2 < 1e-12f) return std::nullopt;  // degenerate triangle
    tri_normal = tri_normal / std::sqrt(tri_len2);

    // Skip backface (normal pointing down)
    if (tri_normal.y < 0.0f) return std::nullopt;

    // Find closest point on capsule segment to triangle plane
    // Then project onto triangle, clamping to edges if outside
    // Then re-find closest point on segment to that clamped point

    // For each endpoint of capsule segment, find closest point on triangle
    // and pick the pair with minimum distance.
    // This is more robust than the plane-projection approach for edge cases.

    // Strategy: find closest point on triangle to segment
    // 1. Closest point on triangle to seg_a
    // 2. Closest point on triangle to seg_b
    // 3. Closest point on segment to each triangle vertex
    // 4. Closest point on segment to each triangle edge (segment-segment)
    // Pick the pair with minimum distance.

    // Simplified approach: closest point on triangle to the capsule segment
    // by testing segment against triangle plane, then clamping.

    // Project segment endpoints onto triangle plane
    float d_a = glm::dot(seg_a - v0, tri_normal);
    float d_b = glm::dot(seg_b - v0, tri_normal);

    // Find the point on the segment closest to the plane
    glm::vec3 seg_pt;
    if (std::abs(d_a - d_b) > 1e-8f) {
        float t = d_a / (d_a - d_b);
        t = glm::clamp(t, 0.0f, 1.0f);
        seg_pt = seg_a + t * (seg_b - seg_a);
    } else {
        // Segment parallel to plane, use the endpoint closer to plane
        seg_pt = (std::abs(d_a) <= std::abs(d_b)) ? seg_a : seg_b;
    }

    // Find closest point on triangle to this segment point
    glm::vec3 tri_pt = closest_point_on_triangle(seg_pt, v0, v1, v2);

    // Re-find closest point on segment to that triangle point
    seg_pt = closest_point_on_segment(seg_a, seg_b, tri_pt);

    // Re-find closest point on triangle to the updated segment point
    tri_pt = closest_point_on_triangle(seg_pt, v0, v1, v2);

    glm::vec3 diff = seg_pt - tri_pt;
    float dist2 = glm::dot(diff, diff);

    if (dist2 >= radius * radius) return std::nullopt;

    float dist = std::sqrt(dist2);
    glm::vec3 normal;
    if (dist < 1e-8f) {
        normal = tri_normal;
    } else {
        normal = diff / dist;
    }

    float depth = radius - dist;
    glm::vec3 point = tri_pt;
    return Contact{point, normal, depth};
}

// ── Capsule vs heightfield ──────────────────────────────────────────

std::optional<Contact> capsule_vs_heightfield(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule, const HeightfieldInstance& hf)
{
    if (!hf.data || hf.data->img_width < 2 || hf.data->img_height < 2)
        return std::nullopt;

    // Compute capsule segment endpoints
    glm::vec3 up = cap_rot * glm::vec3(0.0f, 1.0f, 0.0f);
    glm::vec3 seg_a = cap_pos - up * capsule.half_height;
    glm::vec3 seg_b = cap_pos + up * capsule.half_height;

    // Compute capsule AABB
    float r = capsule.radius;
    glm::vec3 aabb_min = glm::min(seg_a, seg_b) - glm::vec3(r);
    glm::vec3 aabb_max = glm::max(seg_a, seg_b) + glm::vec3(r);

    uint32_t cols = hf.data->img_width;
    uint32_t rows = hf.data->img_height;

    float cell_w = hf.width  / static_cast<float>(cols - 1);
    float cell_h = hf.length / static_cast<float>(rows - 1);

    // Map AABB XZ footprint to grid cell range
    int ix_min = static_cast<int>((aabb_min.x - hf.origin.x) / cell_w);
    int iz_min = static_cast<int>((aabb_min.z - hf.origin.z) / cell_h);
    int ix_max = static_cast<int>((aabb_max.x - hf.origin.x) / cell_w);
    int iz_max = static_cast<int>((aabb_max.z - hf.origin.z) / cell_h);

    ix_min = std::max(ix_min, 0);
    iz_min = std::max(iz_min, 0);
    ix_max = std::min(ix_max, static_cast<int>(cols) - 2);
    iz_max = std::min(iz_max, static_cast<int>(rows) - 2);

    // Vertex helper (same as ray_vs_heightfield)
    auto vertex = [&](uint32_t vx, uint32_t vz) -> glm::vec3 {
        float wx = hf.origin.x + static_cast<float>(vx) * cell_w;
        float wz = hf.origin.z + static_cast<float>(vz) * cell_h;
        float s  = static_cast<float>(hf.data->samples[vz * cols + vx]);
        float wy = hf.origin.y + hf.min_height + (s / 65535.0f) * (hf.max_height - hf.min_height);
        return glm::vec3(wx, wy, wz);
    };

    std::optional<Contact> deepest;

    for (int iz = iz_min; iz <= iz_max; ++iz) {
        for (int ix = ix_min; ix <= ix_max; ++ix) {
            uint32_t ux = static_cast<uint32_t>(ix);
            uint32_t uz = static_cast<uint32_t>(iz);

            glm::vec3 v00 = vertex(ux,     uz);
            glm::vec3 v10 = vertex(ux + 1, uz);
            glm::vec3 v01 = vertex(ux,     uz + 1);
            glm::vec3 v11 = vertex(ux + 1, uz + 1);

            // Split cell along shorter diagonal (same as ray_vs_heightfield)
            float diag_a = glm::length(v00 - v11);
            float diag_b = glm::length(v10 - v01);

            std::optional<Contact> c;
            if (diag_a <= diag_b) {
                c = capsule_vs_triangle(seg_a, seg_b, r, v00, v11, v10);
                if (c && (!deepest || c->depth > deepest->depth)) deepest = c;
                c = capsule_vs_triangle(seg_a, seg_b, r, v00, v01, v11);
                if (c && (!deepest || c->depth > deepest->depth)) deepest = c;
            } else {
                c = capsule_vs_triangle(seg_a, seg_b, r, v00, v01, v10);
                if (c && (!deepest || c->depth > deepest->depth)) deepest = c;
                c = capsule_vs_triangle(seg_a, seg_b, r, v10, v01, v11);
                if (c && (!deepest || c->depth > deepest->depth)) deepest = c;
            }
        }
    }

    return deepest;
}

// ── Sweep capsule vs triangle (hybrid step + binary search) ─────────

static std::optional<SweepHit> sweep_capsule_vs_triangle(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const glm::vec3& v0, const glm::vec3& v1, const glm::vec3& v2)
{
    // Compute capsule segment endpoints helper
    glm::vec3 up = cap_rot * glm::vec3(0.0f, 1.0f, 0.0f);
    float r = capsule.radius;

    auto make_segment = [&](const glm::vec3& pos) -> std::pair<glm::vec3, glm::vec3> {
        glm::vec3 a = pos - up * capsule.half_height;
        glm::vec3 b = pos + up * capsule.half_height;
        return {a, b};
    };

    // Test overlap at t=0
    {
        auto [sa, sb] = make_segment(cap_pos);
        auto c = capsule_vs_triangle(sa, sb, r, v0, v1, v2);
        if (c) {
            // Use triangle face normal for initial overlaps — the capsule_vs_triangle
            // normal can be a horizontal edge-push direction, but for grounding on
            // a heightfield we need the true surface normal.
            glm::vec3 face_normal = glm::normalize(glm::cross(v1 - v0, v2 - v0));
            if (glm::dot(face_normal, glm::vec3(0.0f, 1.0f, 0.0f)) < 0.0f)
                face_normal = -face_normal;
            return SweepHit{0.0f, c->point, face_normal};
        }
    }

    // Step through 8 evenly-spaced positions
    constexpr int num_steps = 8;
    float prev_frac = 0.0f;

    for (int i = 1; i <= num_steps; ++i) {
        float frac = static_cast<float>(i) / static_cast<float>(num_steps);
        glm::vec3 test_pos = cap_pos + direction * (frac * max_distance);
        auto [sa, sb] = make_segment(test_pos);
        auto c = capsule_vs_triangle(sa, sb, r, v0, v1, v2);

        if (c) {
            // Binary search between prev_frac and frac for precise t
            float lo = prev_frac;
            float hi = frac;
            Contact last_contact = *c;

            for (int iter = 0; iter < 8; ++iter) {
                float mid = (lo + hi) * 0.5f;
                glm::vec3 mid_pos = cap_pos + direction * (mid * max_distance);
                auto [ma, mb] = make_segment(mid_pos);
                auto mc = capsule_vs_triangle(ma, mb, r, v0, v1, v2);
                if (mc) {
                    hi = mid;
                    last_contact = *mc;
                } else {
                    lo = mid;
                }
            }

            return SweepHit{hi, last_contact.point, last_contact.normal};
        }

        prev_frac = frac;
    }

    return std::nullopt;
}

// ── Sweep capsule vs heightfield ────────────────────────────────────

std::optional<SweepHit> sweep_capsule_vs_heightfield(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const HeightfieldInstance& hf)
{
    if (max_distance <= 0.0f) return std::nullopt;
    if (!hf.data || hf.data->img_width < 2 || hf.data->img_height < 2)
        return std::nullopt;

    // Normalize direction for consistent stepping, but keep max_distance as-is
    float dir_len = glm::length(direction);
    if (dir_len < 1e-8f) return std::nullopt;
    glm::vec3 dir = direction / dir_len;
    float actual_distance = max_distance * dir_len;

    // Compute capsule segment endpoints at start and end
    glm::vec3 up = cap_rot * glm::vec3(0.0f, 1.0f, 0.0f);
    float r = capsule.radius;
    float hh = capsule.half_height;

    glm::vec3 start_a = cap_pos - up * hh;
    glm::vec3 start_b = cap_pos + up * hh;
    glm::vec3 end_pos = cap_pos + dir * actual_distance;
    glm::vec3 end_a = end_pos - up * hh;
    glm::vec3 end_b = end_pos + up * hh;

    // Compute swept AABB covering the full movement
    AABB swept;
    swept.min = glm::min(glm::min(start_a, start_b), glm::min(end_a, end_b)) - glm::vec3(r);
    swept.max = glm::max(glm::max(start_a, start_b), glm::max(end_a, end_b)) + glm::vec3(r);

    // Early reject: swept AABB vs heightfield AABB
    if (!aabb_overlaps(swept, hf.world_aabb)) return std::nullopt;

    uint32_t cols = hf.data->img_width;
    uint32_t rows = hf.data->img_height;

    float cell_w = hf.width  / static_cast<float>(cols - 1);
    float cell_h = hf.length / static_cast<float>(rows - 1);

    // Map swept AABB XZ footprint to grid cell range
    int ix_min = static_cast<int>((swept.min.x - hf.origin.x) / cell_w);
    int iz_min = static_cast<int>((swept.min.z - hf.origin.z) / cell_h);
    int ix_max = static_cast<int>((swept.max.x - hf.origin.x) / cell_w);
    int iz_max = static_cast<int>((swept.max.z - hf.origin.z) / cell_h);

    ix_min = std::max(ix_min, 0);
    iz_min = std::max(iz_min, 0);
    ix_max = std::min(ix_max, static_cast<int>(cols) - 2);
    iz_max = std::min(iz_max, static_cast<int>(rows) - 2);

    // Vertex helper
    auto vertex = [&](uint32_t vx, uint32_t vz) -> glm::vec3 {
        float wx = hf.origin.x + static_cast<float>(vx) * cell_w;
        float wz = hf.origin.z + static_cast<float>(vz) * cell_h;
        float s  = static_cast<float>(hf.data->samples[vz * cols + vx]);
        float wy = hf.origin.y + hf.min_height + (s / 65535.0f) * (hf.max_height - hf.min_height);
        return glm::vec3(wx, wy, wz);
    };

    std::optional<SweepHit> earliest;

    for (int iz = iz_min; iz <= iz_max; ++iz) {
        for (int ix = ix_min; ix <= ix_max; ++ix) {
            uint32_t ux = static_cast<uint32_t>(ix);
            uint32_t uz = static_cast<uint32_t>(iz);

            glm::vec3 v00 = vertex(ux,     uz);
            glm::vec3 v10 = vertex(ux + 1, uz);
            glm::vec3 v01 = vertex(ux,     uz + 1);
            glm::vec3 v11 = vertex(ux + 1, uz + 1);

            // Split cell along shorter diagonal
            float diag_a = glm::length(v00 - v11);
            float diag_b = glm::length(v10 - v01);

            auto test_tri = [&](const glm::vec3& a, const glm::vec3& b, const glm::vec3& c) {
                auto hit = sweep_capsule_vs_triangle(
                    cap_pos, cap_rot, capsule,
                    dir, actual_distance,
                    a, b, c);
                if (hit && (!earliest || hit->t < earliest->t)) {
                    earliest = hit;
                }
            };

            if (diag_a <= diag_b) {
                test_tri(v00, v11, v10);
                test_tri(v00, v01, v11);
            } else {
                test_tri(v00, v01, v10);
                test_tri(v10, v01, v11);
            }
        }
    }

    return earliest;
}

}  // namespace gseurat
