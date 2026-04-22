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

    std::printf("\n--- Capsule overlap tests ---\n");

    // ── Test 9: capsule_vs_sphere overlap ──
    // Capsule at (0,1,0) upright hh=0.5 r=0.3, sphere at (0.4,1,0) r=0.2
    // Closest point on segment to sphere center is (0,1,0), dist=0.4, combined=0.5 → contact
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 0.5f;

        SphereData sph;
        sph.radius = 0.2f;

        auto contact = capsule_vs_sphere(
            glm::vec3(0.0f, 1.0f, 0.0f), identity_rot(), cap,
            glm::vec3(0.4f, 1.0f, 0.0f), sph);

        check(contact.has_value(), "cap_vs_sphere: overlapping contact detected");
        if (contact) {
            check(contact->depth > 0.0f, "cap_vs_sphere: depth > 0");
            // normal = normalize(cp - sph_pos): cp=(0,1,0), sph=(0.4,1,0) → normal ≈ (-1,0,0)
        check(contact->normal.x < -0.5f, "cap_vs_sphere: normal points roughly -X (from sphere toward capsule)");
        }
    }

    // ── Test 10: capsule_vs_sphere no overlap ──
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 0.5f;

        SphereData sph;
        sph.radius = 0.5f;

        auto contact = capsule_vs_sphere(
            glm::vec3(0.0f, 0.0f, 0.0f), identity_rot(), cap,
            glm::vec3(5.0f, 0.0f, 0.0f), sph);

        check(!contact.has_value(), "cap_vs_sphere: separated → no contact");
    }

    // ── Test 11: capsule_vs_capsule overlap ──
    // Two parallel upright capsules at (0,0,0) and (0.4,0,0), both hh=0.5 r=0.3
    // Combined radius=0.6 > distance=0.4 → contact, normal ≈ (1,0,0)
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 0.5f;

        auto contact = capsule_vs_capsule(
            glm::vec3(0.0f, 0.0f, 0.0f), identity_rot(), cap,
            glm::vec3(0.4f, 0.0f, 0.0f), identity_rot(), cap);

        check(contact.has_value(), "cap_vs_capsule: overlapping contact detected");
        if (contact) {
            check(contact->depth > 0.0f, "cap_vs_capsule: depth > 0");
            // normal points from B toward A, so roughly -X (cap A is at X=0, cap B at X=0.4)
            check(std::abs(contact->normal.x) > 0.5f, "cap_vs_capsule: normal is along X axis");
        }
    }

    // ── Test 12: capsule_vs_capsule no overlap ──
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 0.5f;

        auto contact = capsule_vs_capsule(
            glm::vec3(0.0f, 0.0f, 0.0f), identity_rot(), cap,
            glm::vec3(2.0f, 0.0f, 0.0f), identity_rot(), cap);

        check(!contact.has_value(), "cap_vs_capsule: separated → no contact");
    }

    // ── Test 13: capsule_vs_box floor contact ──
    // Capsule at (0, 0.8, 0) upright hh=0.5 r=0.3
    // Capsule bottom = 0.8 - 0.5 = 0.3 (segment bottom), capsule bottom sphere extent = 0.3 - 0.3 = 0.0
    // Box at (0,0,0) half_extents (5,0.5,5), top face at y=0.5
    // Overlap: capsule segment bottom at y=0.3, closest OBB point y=0.5 → dist=0.2 < 0.3 radius
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 0.5f;

        BoxData floor_box;
        floor_box.half_extents = glm::vec3(5.0f, 0.5f, 5.0f);

        auto contact = capsule_vs_box(
            glm::vec3(0.0f, 0.8f, 0.0f), identity_rot(), cap,
            glm::vec3(0.0f, 0.0f, 0.0f), identity_rot(), floor_box);

        check(contact.has_value(), "cap_vs_box floor: capsule resting on floor → contact");
        if (contact) {
            check(contact->depth > 0.0f, "cap_vs_box floor: depth > 0");
            check(contact->normal.y > 0.5f, "cap_vs_box floor: normal points roughly up");
        }
    }

    // ── Test 14: capsule_vs_box wall contact ──
    // Capsule at (1.2, 1, 0) upright hh=0.5 r=0.3
    // Box wall at (2,1,0) half_extents (0.5,2,2), left face at X=1.5
    // Capsule at X=1.2 + radius 0.3 = 1.5 → exactly touching / just overlapping
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 0.5f;

        BoxData wall_box;
        wall_box.half_extents = glm::vec3(0.5f, 2.0f, 2.0f);

        // Capsule at X=1.3: closest OBB point at X=1.5, dist=0.2 < radius=0.3 → overlap
        auto contact = capsule_vs_box(
            glm::vec3(1.3f, 1.0f, 0.0f), identity_rot(), cap,
            glm::vec3(2.0f, 1.0f, 0.0f), identity_rot(), wall_box);

        check(contact.has_value(), "cap_vs_box wall: capsule overlapping wall → contact");
        if (contact) {
            check(contact->depth > 0.0f, "cap_vs_box wall: depth > 0");
            check(contact->normal.x < -0.5f, "cap_vs_box wall: normal points roughly -X (away from wall)");
        }
    }

    // ── Test 15: capsule_vs_box no overlap ──
    {
        CapsuleData cap;
        cap.radius      = 0.3f;
        cap.half_height = 0.5f;

        BoxData box;
        box.half_extents = glm::vec3(1.0f);

        auto contact = capsule_vs_box(
            glm::vec3(0.0f, 5.0f, 0.0f), identity_rot(), cap,
            glm::vec3(0.0f, 0.0f, 0.0f), identity_rot(), box);

        check(!contact.has_value(), "cap_vs_box: separated → no contact");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return (failed == 0) ? 0 : 1;
}
