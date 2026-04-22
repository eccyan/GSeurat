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

static bool approx(float a, float b, float eps = 0.01f) {
    return std::abs(a - b) < eps;
}

static bool vec_approx(const glm::vec3& a, const glm::vec3& b, float eps = 0.01f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

static glm::quat identity_rot() {
    return glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
}

static glm::quat angle_axis(float angle_rad, glm::vec3 axis) {
    return glm::angleAxis(angle_rad, glm::normalize(axis));
}

static constexpr float PI_2 = 1.5707963268f;  // π/2

int main() {
    std::printf("=== test_intersect ===\n");

    // ── Test 1: Ray along -Y from (0,5,0) hitting sphere at origin radius 1 ──
    // Expected: hit.t ≈ 4.0, normal ≈ (0,1,0)
    {
        auto hit = ray_vs_sphere(
            glm::vec3(0.0f, 5.0f, 0.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            glm::vec3(0.0f), 1.0f);

        check(hit.has_value(), "sphere: ray -Y from (0,5,0) hits sphere at origin");
        if (hit) {
            check(approx(hit->t, 4.0f), "sphere: t ≈ 4.0");
            check(vec_approx(hit->normal, glm::vec3(0.0f, 1.0f, 0.0f)),
                  "sphere: normal ≈ (0,1,0)");
        }
    }

    // ── Test 2: Ray along +X from (-5,0,0) missing sphere at (0,3,0) radius 1 ──
    {
        auto hit = ray_vs_sphere(
            glm::vec3(-5.0f, 0.0f, 0.0f),
            glm::vec3(1.0f, 0.0f, 0.0f),
            glm::vec3(0.0f, 3.0f, 0.0f), 1.0f);

        check(!hit.has_value(), "sphere: ray along +X misses sphere offset in Y");
    }

    // ── Test 3: Ray along -Z from (0,0,5) hitting axis-aligned box at origin ──
    // Box half_extents (1,1,1), expected t ≈ 4.0, normal ≈ (0,0,1)
    {
        BoxData box;
        box.half_extents = glm::vec3(1.0f);
        auto hit = ray_vs_box(
            glm::vec3(0.0f, 0.0f, 5.0f),
            glm::vec3(0.0f, 0.0f, -1.0f),
            glm::vec3(0.0f), identity_rot(), box);

        check(hit.has_value(), "box: ray -Z from (0,0,5) hits unit box at origin");
        if (hit) {
            check(approx(hit->t, 4.0f), "box: t ≈ 4.0");
            check(vec_approx(hit->normal, glm::vec3(0.0f, 0.0f, 1.0f)),
                  "box: normal ≈ (0,0,1)");
        }
    }

    // ── Test 4: Ray along -X hitting box rotated 90° around Y ──
    // Box local X becomes world Z after 90° Y rotation. Ray from +X direction hits
    // the face that was originally the local +Z face (now world +X face).
    {
        BoxData box;
        box.half_extents = glm::vec3(1.0f);
        // Rotate box 90° around Y: local X → world -Z, local Z → world X
        glm::quat rot = angle_axis(PI_2, glm::vec3(0.0f, 1.0f, 0.0f));
        auto hit = ray_vs_box(
            glm::vec3(5.0f, 0.0f, 0.0f),
            glm::vec3(-1.0f, 0.0f, 0.0f),
            glm::vec3(0.0f), rot, box);

        check(hit.has_value(), "box rotated 90°Y: ray -X hits box");
        if (hit) {
            check(approx(hit->t, 4.0f, 0.05f), "box rotated 90°Y: t ≈ 4.0");
            // The world normal should be approximately (1,0,0) — the face facing +X
            check(vec_approx(hit->normal, glm::vec3(1.0f, 0.0f, 0.0f), 0.05f),
                  "box rotated 90°Y: normal ≈ (1,0,0)");
        }
    }

    // ── Test 5: Ray along -Y from (0,5,0) hitting upright capsule at origin ──
    // Capsule: half_height=1, radius=0.3. Top hemisphere center at (0,1,0).
    // Ray hits top hemisphere, entry at y = 1 + 0.3 = 1.3, t ≈ 5.0 - 1.3 = 3.7
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 1.0f;
        auto hit = ray_vs_capsule(
            glm::vec3(0.0f, 5.0f, 0.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            glm::vec3(0.0f), identity_rot(), cap);

        check(hit.has_value(), "capsule: ray -Y from (0,5,0) hits top hemisphere");
        if (hit) {
            check(approx(hit->t, 3.7f, 0.05f), "capsule: t ≈ 3.7");
            // Normal should point upward
            check(hit->normal.y > 0.9f, "capsule: top hemisphere normal points up");
        }
    }

    // ── Test 6: Ray along -X from (5,0,0) hitting upright capsule cylinder side ──
    // Expected: hits cylinder at x = 0.3, t ≈ 4.7, normal ≈ (1,0,0)
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 1.0f;
        auto hit = ray_vs_capsule(
            glm::vec3(5.0f, 0.0f, 0.0f),
            glm::vec3(-1.0f, 0.0f, 0.0f),
            glm::vec3(0.0f), identity_rot(), cap);

        check(hit.has_value(), "capsule: ray -X from (5,0,0) hits cylinder side");
        if (hit) {
            check(approx(hit->t, 4.7f, 0.05f), "capsule cylinder: t ≈ 4.7");
            check(vec_approx(hit->normal, glm::vec3(1.0f, 0.0f, 0.0f), 0.05f),
                  "capsule cylinder: normal ≈ (1,0,0)");
        }
    }

    // ── Test 7: Ray starting behind sphere (direction away) ──
    {
        auto hit = ray_vs_sphere(
            glm::vec3(0.0f, -5.0f, 0.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),  // pointing away from sphere at origin
            glm::vec3(0.0f), 1.0f);

        check(!hit.has_value(), "sphere: ray pointing away → no hit");
    }

    // ── Test 8: ray_intersect variant dispatch — same as Test 1 via ColliderShape ──
    {
        SphereData sphere;
        sphere.radius = 1.0f;
        ColliderShape shape = sphere;

        auto hit = ray_intersect(
            glm::vec3(0.0f, 5.0f, 0.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            shape,
            glm::vec3(0.0f), identity_rot());

        check(hit.has_value(), "ray_intersect dispatch: sphere variant hits");
        if (hit) {
            check(approx(hit->t, 4.0f), "ray_intersect dispatch: t ≈ 4.0");
            check(vec_approx(hit->normal, glm::vec3(0.0f, 1.0f, 0.0f)),
                  "ray_intersect dispatch: normal ≈ (0,1,0)");
        }
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return (failed == 0) ? 0 : 1;
}
