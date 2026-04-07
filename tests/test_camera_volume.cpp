// Test: AABB and Sphere volume geometry — contains, clamp_to, volume_size.
// Build: add_gseurat_test(test_camera_volume)

#include "gseurat/engine/camera_volume.hpp"

#include <cmath>
#include <cstdio>

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) {
        std::printf("  PASS: %s\n", msg);
        passed++;
    } else {
        std::printf("  FAIL: %s\n", msg);
        failed++;
    }
}

static bool approx(float a, float b, float eps = 0.001f) {
    return std::fabs(a - b) < eps;
}

static bool vec_approx(const glm::vec3& a, const glm::vec3& b, float eps = 0.001f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

// ── AABB contains ────────────────────────────────────────────────────────────

void test_aabb_contains() {
    std::printf("AABB contains:\n");

    gseurat::AABB box{{0.0f, 0.0f, 0.0f}, {2.0f, 2.0f, 2.0f}};

    check(gseurat::contains(box, {0.0f, 0.0f, 0.0f}), "center is inside");
    check(gseurat::contains(box, {2.0f, 2.0f, 2.0f}), "positive corner is inside (boundary)");
    check(gseurat::contains(box, {-2.0f, -2.0f, -2.0f}), "negative corner is inside (boundary)");
    check(!gseurat::contains(box, {3.0f, 0.0f, 0.0f}), "outside on X axis");
    check(!gseurat::contains(box, {0.0f, 2.1f, 0.0f}), "outside on Y axis");
    check(!gseurat::contains(box, {0.0f, 0.0f, -2.5f}), "outside on -Z axis");
}

// ── AABB clamp_to ────────────────────────────────────────────────────────────

void test_aabb_clamp() {
    std::printf("AABB clamp_to:\n");

    gseurat::AABB box{{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f, 1.0f}};

    // Inside: unchanged
    glm::vec3 inside{0.5f, 0.5f, 0.5f};
    check(vec_approx(gseurat::clamp_to(box, inside), inside), "inside point unchanged");

    // Outside on X: clamp to X boundary
    glm::vec3 outside_x{5.0f, 0.0f, 0.0f};
    check(vec_approx(gseurat::clamp_to(box, outside_x), {1.0f, 0.0f, 0.0f}), "clamp X+ to boundary");

    // Outside on Y: clamp to Y boundary
    glm::vec3 outside_y{0.0f, -3.0f, 0.0f};
    check(vec_approx(gseurat::clamp_to(box, outside_y), {0.0f, -1.0f, 0.0f}), "clamp Y- to boundary");

    // Outside on Z: clamp to Z boundary
    glm::vec3 outside_z{0.0f, 0.0f, 4.0f};
    check(vec_approx(gseurat::clamp_to(box, outside_z), {0.0f, 0.0f, 1.0f}), "clamp Z+ to boundary");

    // Corner: clamp all axes
    glm::vec3 corner{10.0f, 10.0f, 10.0f};
    check(vec_approx(gseurat::clamp_to(box, corner), {1.0f, 1.0f, 1.0f}), "clamp all axes from corner");
}

// ── Sphere contains ──────────────────────────────────────────────────────────

void test_sphere_contains() {
    std::printf("Sphere contains:\n");

    gseurat::Sphere sphere{{0.0f, 0.0f, 0.0f}, 3.0f};

    check(gseurat::contains(sphere, {0.0f, 0.0f, 0.0f}), "center is inside");
    check(gseurat::contains(sphere, {3.0f, 0.0f, 0.0f}), "boundary point is inside (radius)");
    check(gseurat::contains(sphere, {0.0f, -3.0f, 0.0f}), "boundary on -Y axis");
    check(!gseurat::contains(sphere, {3.1f, 0.0f, 0.0f}), "just outside boundary");
    check(!gseurat::contains(sphere, {10.0f, 0.0f, 0.0f}), "far outside");

    // Diagonal: (1,1,1) distance = sqrt(3) ≈ 1.732 < 3, so inside
    check(gseurat::contains(sphere, {1.0f, 1.0f, 1.0f}), "diagonal point inside");
    // (2,2,2) distance = sqrt(12) ≈ 3.464 > 3, so outside
    check(!gseurat::contains(sphere, {2.0f, 2.0f, 2.0f}), "diagonal point outside");
}

// ── Sphere clamp_to ──────────────────────────────────────────────────────────

void test_sphere_clamp() {
    std::printf("Sphere clamp_to:\n");

    gseurat::Sphere sphere{{0.0f, 0.0f, 0.0f}, 5.0f};

    // Inside: unchanged
    glm::vec3 inside{1.0f, 2.0f, 0.0f};
    check(vec_approx(gseurat::clamp_to(sphere, inside), inside), "inside point unchanged");

    // Outside on X axis: clamp to surface
    glm::vec3 outside_x{10.0f, 0.0f, 0.0f};
    check(vec_approx(gseurat::clamp_to(sphere, outside_x), {5.0f, 0.0f, 0.0f}), "clamp X+ to sphere surface");

    // Outside on -Y axis: clamp to surface
    glm::vec3 outside_y{0.0f, -20.0f, 0.0f};
    check(vec_approx(gseurat::clamp_to(sphere, outside_y), {0.0f, -5.0f, 0.0f}), "clamp -Y to sphere surface");

    // Far diagonal: result should be on sphere surface
    glm::vec3 far_diag{100.0f, 0.0f, 0.0f};
    glm::vec3 clamped = gseurat::clamp_to(sphere, far_diag);
    float dist = glm::length(clamped - sphere.center);
    check(approx(dist, 5.0f, 0.01f), "clamped point is on sphere surface");
}

// ── volume_size ──────────────────────────────────────────────────────────────

void test_volume_size() {
    std::printf("volume_size:\n");

    // AABB: product of half_extents
    gseurat::AABB box{{0.0f, 0.0f, 0.0f}, {2.0f, 3.0f, 4.0f}};
    check(approx(gseurat::volume_size(box), 24.0f), "AABB volume_size = 2*3*4 = 24");

    gseurat::AABB unit_box{{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f, 1.0f}};
    check(approx(gseurat::volume_size(unit_box), 1.0f), "unit AABB volume_size = 1");

    // Sphere: r³
    gseurat::Sphere sphere{{0.0f, 0.0f, 0.0f}, 3.0f};
    check(approx(gseurat::volume_size(sphere), 27.0f), "Sphere volume_size = 3^3 = 27");

    gseurat::Sphere unit_sphere{{0.0f, 0.0f, 0.0f}, 1.0f};
    check(approx(gseurat::volume_size(unit_sphere), 1.0f), "unit Sphere volume_size = 1");
}

// ── VolumeShape variant dispatch ─────────────────────────────────────────────

void test_variant_dispatch() {
    std::printf("VolumeShape variant dispatch:\n");

    gseurat::VolumeShape aabb_shape = gseurat::AABB{{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f, 1.0f}};
    gseurat::VolumeShape sphere_shape = gseurat::Sphere{{0.0f, 0.0f, 0.0f}, 2.0f};

    // contains via variant
    check(gseurat::contains(aabb_shape, {0.5f, 0.0f, 0.0f}), "variant AABB contains inside");
    check(!gseurat::contains(aabb_shape, {5.0f, 0.0f, 0.0f}), "variant AABB contains outside");
    check(gseurat::contains(sphere_shape, {1.0f, 0.0f, 0.0f}), "variant Sphere contains inside");
    check(!gseurat::contains(sphere_shape, {3.0f, 0.0f, 0.0f}), "variant Sphere contains outside");

    // clamp_to via variant (just verify the result is sensible)
    glm::vec3 far{10.0f, 0.0f, 0.0f};
    glm::vec3 clamped_aabb = gseurat::clamp_to(aabb_shape, far);
    check(vec_approx(clamped_aabb, {1.0f, 0.0f, 0.0f}), "variant AABB clamp_to X+");

    glm::vec3 clamped_sphere = gseurat::clamp_to(sphere_shape, far);
    check(vec_approx(clamped_sphere, {2.0f, 0.0f, 0.0f}), "variant Sphere clamp_to X+");

    // volume_size via variant
    check(approx(gseurat::volume_size(aabb_shape), 1.0f), "variant AABB volume_size = 1");
    check(approx(gseurat::volume_size(sphere_shape), 8.0f), "variant Sphere volume_size = 2^3 = 8");
}

// ── CameraVolume and CameraTrigger struct defaults ───────────────────────────

void test_struct_defaults() {
    std::printf("Struct defaults:\n");

    gseurat::CameraState state;
    check(approx(state.fov, 45.0f), "CameraState default fov = 45");
    check(vec_approx(state.up, {0.0f, 1.0f, 0.0f}), "CameraState default up = (0,1,0)");

    gseurat::CameraParams params;
    check(params.mode == gseurat::CameraMode::free_look, "CameraParams default mode = free_look");
    check(params.priority == 0, "CameraParams default priority = 0");
    check(approx(params.blend_time, 1.0f), "CameraParams default blend_time = 1.0");
    check(params.allow_user_orbit, "CameraParams default allow_user_orbit = true");
    check(params.rail_index == -1, "CameraParams default rail_index = -1");

    gseurat::CameraTrigger trigger;
    check(trigger.from_zone_entity == -1, "CameraTrigger default from_zone = -1");
    check(trigger.to_zone_entity == -1, "CameraTrigger default to_zone = -1");
    check(trigger.blend_override < 0.0f, "CameraTrigger default blend_override negative");
}

// ── Off-center AABB ──────────────────────────────────────────────────────────

void test_aabb_off_center() {
    std::printf("AABB off-center:\n");

    // Box centered at (5, 0, 0) with half_extents (2, 2, 2)
    // Covers [3..7, -2..2, -2..2]
    gseurat::AABB box{{5.0f, 0.0f, 0.0f}, {2.0f, 2.0f, 2.0f}};

    check(gseurat::contains(box, {5.0f, 0.0f, 0.0f}), "off-center: center inside");
    check(gseurat::contains(box, {4.0f, 1.0f, 0.0f}), "off-center: nearby point inside");
    check(!gseurat::contains(box, {0.0f, 0.0f, 0.0f}), "off-center: origin outside");

    glm::vec3 far{0.0f, 0.0f, 0.0f};
    glm::vec3 clamped = gseurat::clamp_to(box, far);
    // Nearest point on [3..7,-2..2,-2..2] to (0,0,0) is (3,0,0)
    check(vec_approx(clamped, {3.0f, 0.0f, 0.0f}), "off-center: clamp origin to nearest face");
}

int main() {
    std::printf("=== Camera Volume Geometry Tests ===\n\n");

    test_aabb_contains();
    test_aabb_clamp();
    test_sphere_contains();
    test_sphere_clamp();
    test_volume_size();
    test_variant_dispatch();
    test_struct_defaults();
    test_aabb_off_center();

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
