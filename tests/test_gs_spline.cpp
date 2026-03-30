// Test: Catmull-Rom spline evaluation and tangent computation.
//
// Validates:
// 1. Spline passes through control points
// 2. Two-point spline is a straight line
// 3. Tangent direction is correct for straight segments
// 4. Continuity at segment boundaries
// 5. Edge cases (empty, single point)
// 6. Arc length approximation
//
// Run: ctest -R test_gs_spline

#include "gseurat/engine/gs_spline.hpp"

#include <cassert>
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

static bool approx(float a, float b, float eps = 0.01f) {
    return std::fabs(a - b) < eps;
}

static bool vec_approx(const glm::vec3& a, const glm::vec3& b, float eps = 0.01f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

// ── Validity ──

void test_validity() {
    std::printf("Validity checks:\n");

    gseurat::SplinePath empty;
    check(!empty.valid(), "empty spline is invalid");

    gseurat::SplinePath one;
    one.control_points = {{0, 0, 0}};
    check(!one.valid(), "single-point spline is invalid");

    gseurat::SplinePath two;
    two.control_points = {{0, 0, 0}, {10, 0, 0}};
    check(two.valid(), "two-point spline is valid");
}

// ── Two-point spline (straight line) ──

void test_two_point_line() {
    std::printf("Two-point spline (straight line):\n");

    gseurat::SplinePath sp;
    sp.control_points = {{0, 0, 0}, {10, 0, 0}};

    auto p0 = sp.evaluate(0.0f);
    auto p1 = sp.evaluate(1.0f);
    auto mid = sp.evaluate(0.5f);

    check(vec_approx(p0, {0, 0, 0}), "evaluate(0) = P0");
    check(vec_approx(p1, {10, 0, 0}), "evaluate(1) = P1");
    check(vec_approx(mid, {5, 0, 0}), "evaluate(0.5) = midpoint");

    // Quarter point
    auto q = sp.evaluate(0.25f);
    check(vec_approx(q, {2.5f, 0, 0}), "evaluate(0.25) = quarter");
}

// ── Three-point spline ──

void test_three_point() {
    std::printf("Three-point spline:\n");

    gseurat::SplinePath sp;
    sp.control_points = {{0, 0, 0}, {5, 10, 0}, {10, 0, 0}};

    auto p0 = sp.evaluate(0.0f);
    auto p1 = sp.evaluate(0.5f);
    auto p2 = sp.evaluate(1.0f);

    check(vec_approx(p0, {0, 0, 0}), "evaluate(0) = P0");
    check(vec_approx(p1, {5, 10, 0}), "evaluate(0.5) = P1 (middle control point)");
    check(vec_approx(p2, {10, 0, 0}), "evaluate(1) = P2");
}

// ── Four-point spline ──

void test_four_point() {
    std::printf("Four-point spline:\n");

    gseurat::SplinePath sp;
    sp.control_points = {{0, 0, 0}, {3, 5, 0}, {7, 5, 0}, {10, 0, 0}};

    // Should pass through all 4 control points
    float t0 = 0.0f;
    float t1 = 1.0f / 3.0f;
    float t2 = 2.0f / 3.0f;
    float t3 = 1.0f;

    check(vec_approx(sp.evaluate(t0), {0, 0, 0}), "evaluate(0) = P0");
    check(vec_approx(sp.evaluate(t1), {3, 5, 0}, 0.1f), "evaluate(1/3) ≈ P1");
    check(vec_approx(sp.evaluate(t2), {7, 5, 0}, 0.1f), "evaluate(2/3) ≈ P2");
    check(vec_approx(sp.evaluate(t3), {10, 0, 0}), "evaluate(1) = P3");
}

// ── Tangent direction ──

void test_tangent() {
    std::printf("Tangent direction:\n");

    // Straight line along X axis
    gseurat::SplinePath sp;
    sp.control_points = {{0, 0, 0}, {10, 0, 0}};

    auto tan = sp.tangent(0.5f);
    float len = glm::length(tan);
    check(len > 0.0f, "tangent is non-zero");

    // Tangent should be along X axis
    auto dir = glm::normalize(tan);
    check(approx(dir.x, 1.0f, 0.1f), "tangent.x ≈ 1 (along X)");
    check(approx(dir.y, 0.0f, 0.1f), "tangent.y ≈ 0");
    check(approx(dir.z, 0.0f, 0.1f), "tangent.z ≈ 0");
}

// ── Continuity at segment boundaries ──

void test_continuity() {
    std::printf("Continuity at segment boundaries:\n");

    gseurat::SplinePath sp;
    sp.control_points = {{0, 0, 0}, {3, 5, 0}, {7, -3, 0}, {10, 0, 0}};

    // At the boundary between segment 0-1 and segment 1-2 (t = 1/3)
    float boundary = 1.0f / 3.0f;
    float eps = 0.001f;
    auto left = sp.evaluate(boundary - eps);
    auto right = sp.evaluate(boundary + eps);

    float gap = glm::length(right - left);
    check(gap < 0.1f, "position continuous at segment boundary (gap < 0.1)");
}

// ── Clamping at boundaries ──

void test_clamping() {
    std::printf("Clamping at boundaries:\n");

    gseurat::SplinePath sp;
    sp.control_points = {{0, 0, 0}, {10, 0, 0}};

    auto below = sp.evaluate(-0.5f);
    auto above = sp.evaluate(1.5f);

    check(vec_approx(below, {0, 0, 0}), "evaluate(<0) clamps to P0");
    check(vec_approx(above, {10, 0, 0}), "evaluate(>1) clamps to PN");
}

// ── Arc length approximation ──

void test_arc_length() {
    std::printf("Arc length approximation:\n");

    // Straight line of length 10
    gseurat::SplinePath sp;
    sp.control_points = {{0, 0, 0}, {10, 0, 0}};

    float len = sp.length_approx(64);
    check(approx(len, 10.0f, 0.5f), "straight line length ≈ 10");

    // 3D diagonal: (0,0,0) to (10,10,10), length = sqrt(300) ≈ 17.32
    gseurat::SplinePath sp3d;
    sp3d.control_points = {{0, 0, 0}, {10, 10, 10}};
    float len3d = sp3d.length_approx(64);
    check(approx(len3d, 17.32f, 1.0f), "3D diagonal length ≈ 17.32");
}

// ── SplineConfig defaults ──

void test_spline_config_defaults() {
    std::printf("SplineConfig defaults:\n");

    gseurat::SplineConfig cfg;
    check(cfg.mode == gseurat::SplineMode::None, "default mode = None");
    check(!cfg.path.valid(), "default path is invalid (no points)");
    check(approx(cfg.emitter_speed, 1.0f), "default emitter_speed = 1.0");
    check(approx(cfg.path_spread, 0.0f), "default path_spread = 0.0");
    check(!cfg.align_to_tangent, "default align_to_tangent = false");
}

int main() {
    std::printf("=== Catmull-Rom Spline Tests ===\n\n");

    test_validity();
    test_two_point_line();
    test_three_point();
    test_four_point();
    test_tangent();
    test_continuity();
    test_clamping();
    test_arc_length();
    test_spline_config_defaults();

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
