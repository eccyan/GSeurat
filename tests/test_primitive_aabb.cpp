#include "gseurat/engine/collision/intersect.hpp"
#include <cstdio>
#include <cmath>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.001f) {
    return std::abs(a - b) < eps;
}

// Helper: build a quaternion that rotates `angle` radians around `axis`.
static glm::quat angle_axis(float angle_rad, glm::vec3 axis) {
    return glm::angleAxis(angle_rad, glm::normalize(axis));
}

static constexpr float PI_2 = 1.5707963268f;  // π/2

int main() {
    std::printf("=== test_primitive_aabb ===\n");

    // ── Test 1: Identity-rotation box ──────────────────────────────
    {
        BoxData box;
        box.half_extents = glm::vec3(1.0f, 2.0f, 3.0f);
        glm::vec3 pos(5.0f, 6.0f, 7.0f);
        glm::quat rot = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);  // identity
        AABB aabb = compute_aabb(box, pos, rot);

        check(approx(aabb.min.x, 4.0f) && approx(aabb.max.x, 6.0f), "box identity: X extent = ±half_extents.x");
        check(approx(aabb.min.y, 4.0f) && approx(aabb.max.y, 8.0f), "box identity: Y extent = ±half_extents.y");
        check(approx(aabb.min.z, 4.0f) && approx(aabb.max.z, 10.0f), "box identity: Z extent = ±half_extents.z");
    }

    // ── Test 2: 90°-Y-rotated box: half_extents (2,1,3) → expanded (3,1,2) ──
    {
        BoxData box;
        box.half_extents = glm::vec3(2.0f, 1.0f, 3.0f);
        glm::vec3 pos(0.0f, 0.0f, 0.0f);
        glm::quat rot = angle_axis(PI_2, glm::vec3(0.0f, 1.0f, 0.0f));  // 90° around Y
        AABB aabb = compute_aabb(box, pos, rot);

        // After 90° Y rotation: local X -> world -Z, local Z -> world X.
        // expanded.x = |rotMat[0][0]|*2 + |rotMat[1][0]|*1 + |rotMat[2][0]|*3
        //            = |cos90|*2 + |0|*1 + |-sin90|*3 ≈ 0 + 0 + 3 = 3
        // expanded.y = |0|*2 + |1|*1 + |0|*3 = 1
        // expanded.z = |sin90|*2 + |0|*1 + |cos90|*3 ≈ 2 + 0 + 0 = 2
        check(approx(aabb.max.x, 3.0f), "box 90°Y: expanded.x = 3");
        check(approx(aabb.max.y, 1.0f), "box 90°Y: expanded.y = 1");
        check(approx(aabb.max.z, 2.0f), "box 90°Y: expanded.z = 2");
    }

    // ── Test 3: Sphere AABB, rotation irrelevant ───────────────────
    {
        SphereData sphere;
        sphere.radius = 1.5f;
        glm::vec3 pos(3.0f, 4.0f, 5.0f);
        glm::quat rot = angle_axis(PI_2, glm::vec3(1.0f, 0.0f, 0.0f));
        AABB aabb = compute_aabb(sphere, pos, rot);

        check(approx(aabb.min.x, 1.5f) && approx(aabb.max.x, 4.5f), "sphere: X = pos ± radius");
        check(approx(aabb.min.y, 2.5f) && approx(aabb.max.y, 5.5f), "sphere: Y = pos ± radius");
        check(approx(aabb.min.z, 3.5f) && approx(aabb.max.z, 6.5f), "sphere: Z = pos ± radius");

        // Rotation doesn't matter: same result with identity
        AABB aabb2 = compute_aabb(sphere, pos, glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
        check(approx(aabb.min.x, aabb2.min.x) && approx(aabb.max.x, aabb2.max.x),
              "sphere: rotation-invariant");
    }

    // ── Test 4: Upright capsule (identity rot) ─────────────────────
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 1.0f;
        glm::vec3 pos(0.0f, 0.0f, 0.0f);
        glm::quat rot = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
        AABB aabb = compute_aabb(cap, pos, rot);

        // Y: hemisphere centers at ±1.0, expanded by 0.3 → extent [-1.3, +1.3]
        // X/Z: only radius → extent [-0.3, +0.3]
        check(approx(aabb.max.y,  1.3f) && approx(aabb.min.y, -1.3f),
              "capsule upright: Y = ±(half_height + radius)");
        check(approx(aabb.max.x,  0.3f) && approx(aabb.min.x, -0.3f),
              "capsule upright: X = ±radius");
        check(approx(aabb.max.z,  0.3f) && approx(aabb.min.z, -0.3f),
              "capsule upright: Z = ±radius");
    }

    // ── Test 5: Capsule rotated 90° around Z → Y and X extents swap ──
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 1.0f;
        glm::vec3 pos(0.0f, 0.0f, 0.0f);
        glm::quat rot = angle_axis(PI_2, glm::vec3(0.0f, 0.0f, 1.0f));  // 90° around Z
        AABB aabb = compute_aabb(cap, pos, rot);

        // Local Y is now world X: hemisphere centers at (±1.0, 0, 0)
        // X: ±(1.0 + 0.3) = ±1.3
        // Y: ±0.3
        check(approx(aabb.max.x,  1.3f) && approx(aabb.min.x, -1.3f),
              "capsule 90°Z: X = ±(half_height + radius)");
        check(approx(aabb.max.y,  0.3f) && approx(aabb.min.y, -0.3f),
              "capsule 90°Z: Y = ±radius");
    }

    // ── Test 6: aabb_overlaps — two overlapping boxes ──────────────
    {
        AABB a{glm::vec3(0.0f), glm::vec3(2.0f)};
        AABB b{glm::vec3(1.0f), glm::vec3(3.0f)};
        check(aabb_overlaps(a, b), "aabb_overlaps: overlapping → true");
    }

    // ── Test 7: aabb_overlaps — two separated boxes ─────────────────
    {
        AABB a{glm::vec3(0.0f), glm::vec3(1.0f)};
        AABB b{glm::vec3(2.0f), glm::vec3(3.0f)};
        check(!aabb_overlaps(a, b), "aabb_overlaps: separated → false");
    }

    // ── Test 8: aabb_overlaps — touching at edge ────────────────────
    {
        AABB a{glm::vec3(0.0f), glm::vec3(1.0f)};
        AABB b{glm::vec3(1.0f), glm::vec3(2.0f)};
        check(aabb_overlaps(a, b), "aabb_overlaps: touching at edge → true");
    }

    // ── Test 9: ColliderShape variant dispatch ──────────────────────
    {
        glm::vec3 pos(0.0f);
        glm::quat rot = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);

        BoxData box;
        box.half_extents = glm::vec3(1.0f);
        ColliderShape box_shape = box;
        AABB box_aabb = compute_aabb(box_shape, pos, rot);
        check(approx(box_aabb.max.x, 1.0f), "variant dispatch: BoxData");

        SphereData sphere;
        sphere.radius = 2.0f;
        ColliderShape sphere_shape = sphere;
        AABB sphere_aabb = compute_aabb(sphere_shape, pos, rot);
        check(approx(sphere_aabb.max.x, 2.0f), "variant dispatch: SphereData");

        CapsuleData cap;
        cap.radius = 0.5f;
        cap.half_height = 1.0f;
        ColliderShape cap_shape = cap;
        AABB cap_aabb = compute_aabb(cap_shape, pos, rot);
        check(approx(cap_aabb.max.y, 1.5f), "variant dispatch: CapsuleData");
    }

    // ── Test 10: AABB::longest_axis() ───────────────────────────────
    {
        // extent (10, 5, 3) → axis 0
        AABB a{glm::vec3(0.0f), glm::vec3(10.0f, 5.0f, 3.0f)};
        check(a.longest_axis() == 0, "longest_axis: (10,5,3) → 0");

        // extent (3, 10, 5) → axis 1
        AABB b{glm::vec3(0.0f), glm::vec3(3.0f, 10.0f, 5.0f)};
        check(b.longest_axis() == 1, "longest_axis: (3,10,5) → 1");

        // extent (3, 5, 10) → axis 2
        AABB c{glm::vec3(0.0f), glm::vec3(3.0f, 5.0f, 10.0f)};
        check(c.longest_axis() == 2, "longest_axis: (3,5,10) → 2");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return (failed == 0) ? 0 : 1;
}
