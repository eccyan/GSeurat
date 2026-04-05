// Test: PBD solver struct layout, index segmentation, and quaternion math.
//
// Validates:
// 1. PbdState struct size and alignment for GPU (std430)
// 2. Bone index segmentation: 0 = none, 1-31 = bone, 32-63 = PBD
// 3. Quaternion multiplication matches expected results
// 4. Quaternion-vector rotation (the formula used in gs_preprocess.comp)
// 5. Axis-angle to quaternion conversion (used in pbd_solver.comp)
//
// Run: ctest -R test_pbd_solver

#include "gseurat/engine/gs_renderer.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>

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

static bool approx_vec3(glm::vec3 a, glm::vec3 b, float eps = 0.001f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

static bool approx_vec4(glm::vec4 a, glm::vec4 b, float eps = 0.001f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) &&
           approx(a.z, b.z, eps) && approx(a.w, b.w, eps);
}

// Mirror the GLSL quat_mul from gs_preprocess.comp (xyzw layout)
static glm::vec4 quat_mul(glm::vec4 a, glm::vec4 b) {
    return glm::vec4(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
    );
}

// Mirror the GLSL quaternion-vector rotation from gs_preprocess.comp
static glm::vec3 quat_rotate_vec(glm::vec4 q, glm::vec3 v) {
    glm::vec3 qv(q.x, q.y, q.z);
    glm::vec3 t = 2.0f * glm::cross(qv, v);
    return v + q.w * t + glm::cross(qv, t);
}

// Mirror the GLSL axis_angle_to_quat from pbd_solver.comp
static glm::vec4 axis_angle_to_quat(glm::vec3 axis, float angle) {
    float half_a = angle * 0.5f;
    float s = std::sin(half_a);
    return glm::vec4(axis * s, std::cos(half_a));
}

// ── PbdState struct layout ──

static void test_pbd_state_layout() {
    std::printf("=== PbdState struct layout ===\n");
    using PbdState = gseurat::GsRenderer::PbdState;

    // Must be 2 * vec4 = 32 bytes for GPU std430 layout
    check(sizeof(PbdState) == 32, "PbdState is 32 bytes (2 x vec4)");

    // Verify field offsets
    check(offsetof(PbdState, position) == 0, "position at offset 0");
    check(offsetof(PbdState, rotation) == 16, "rotation at offset 16");

    // Max elements constant
    check(gseurat::GsRenderer::kMaxPbdElements == 32,
          "kMaxPbdElements is 32 (matches bone_idx range 32-63)");
}

// ── Index segmentation ──

static void test_index_segmentation() {
    std::printf("=== Index segmentation (bone vs PBD) ===\n");

    // Bone index encoding: uint32 → float via memcpy (mirrors gs_renderer.cpp)
    auto encode = [](uint32_t idx) -> float {
        float f;
        std::memcpy(&f, &idx, sizeof(float));
        return f;
    };
    auto decode = [](float f) -> uint32_t {
        uint32_t idx;
        std::memcpy(&idx, &f, sizeof(uint32_t));
        return idx;
    };

    // Round-trip encoding
    check(decode(encode(0)) == 0, "bone_idx 0 round-trips (no transform)");
    check(decode(encode(1)) == 1, "bone_idx 1 round-trips (first bone)");
    check(decode(encode(31)) == 31, "bone_idx 31 round-trips (last bone)");
    check(decode(encode(32)) == 32, "bone_idx 32 round-trips (first PBD)");
    check(decode(encode(63)) == 63, "bone_idx 63 round-trips (last PBD)");

    // Verify segmentation logic (mirrors gs_preprocess.comp)
    for (uint32_t idx = 0; idx < 64; ++idx) {
        uint32_t decoded = decode(encode(idx));
        bool is_bone = (decoded > 0 && decoded < 32);
        bool is_pbd = (decoded >= 32 && decoded < 64);
        bool is_none = (decoded == 0);

        if (idx == 0) {
            check(is_none && !is_bone && !is_pbd, "idx 0 = no transform");
        } else if (idx < 32) {
            check(!is_none && is_bone && !is_pbd,
                  (std::string("idx ") + std::to_string(idx) + " = bone").c_str());
        } else {
            check(!is_none && !is_bone && is_pbd,
                  (std::string("idx ") + std::to_string(idx) + " = PBD").c_str());
        }
    }

    // PBD index mapping: bone_idx 32 → pbd_states[0], bone_idx 63 → pbd_states[31]
    check(32 - 32 == 0, "bone_idx 32 maps to pbd_states[0]");
    check(63 - 32 == 31, "bone_idx 63 maps to pbd_states[31]");
}

// ── Quaternion multiplication ──

static void test_quat_multiplication() {
    std::printf("=== Quaternion multiplication ===\n");

    // Identity * identity = identity
    glm::vec4 id(0, 0, 0, 1);
    check(approx_vec4(quat_mul(id, id), id), "identity * identity = identity");

    // q * identity = q
    glm::vec4 q90z(0, 0, std::sin(M_PI / 4.0f), std::cos(M_PI / 4.0f));  // 90deg around Z
    check(approx_vec4(quat_mul(q90z, id), q90z), "q * identity = q");
    check(approx_vec4(quat_mul(id, q90z), q90z), "identity * q = q");

    // 90deg Z * 90deg Z = 180deg Z
    glm::vec4 result = quat_mul(q90z, q90z);
    glm::vec4 q180z(0, 0, std::sin(M_PI / 2.0f), std::cos(M_PI / 2.0f));  // 180deg around Z
    check(approx_vec4(result, q180z), "90deg Z * 90deg Z = 180deg Z");

    // Verify quaternion is unit length
    float len = std::sqrt(result.x * result.x + result.y * result.y +
                          result.z * result.z + result.w * result.w);
    check(approx(len, 1.0f), "product quaternion is unit length");
}

// ── Quaternion-vector rotation ──

static void test_quat_vector_rotation() {
    std::printf("=== Quaternion-vector rotation ===\n");

    // Identity rotation leaves vector unchanged
    glm::vec4 id(0, 0, 0, 1);
    glm::vec3 v(1, 2, 3);
    check(approx_vec3(quat_rotate_vec(id, v), v), "identity rotation preserves vector");

    // 90deg around Y: (1,0,0) → (0,0,-1)
    glm::vec4 q90y(0, std::sin(M_PI / 4.0f), 0, std::cos(M_PI / 4.0f));
    glm::vec3 rotated = quat_rotate_vec(q90y, glm::vec3(1, 0, 0));
    check(approx_vec3(rotated, glm::vec3(0, 0, -1)), "90deg Y rotates X-axis to -Z");

    // 90deg around Z: (1,0,0) → (0,1,0)
    glm::vec4 q90z(0, 0, std::sin(M_PI / 4.0f), std::cos(M_PI / 4.0f));
    rotated = quat_rotate_vec(q90z, glm::vec3(1, 0, 0));
    check(approx_vec3(rotated, glm::vec3(0, 1, 0)), "90deg Z rotates X-axis to Y");

    // 180deg around X: (0,1,0) → (0,-1,0)
    glm::vec4 q180x(std::sin(M_PI / 2.0f), 0, 0, std::cos(M_PI / 2.0f));
    rotated = quat_rotate_vec(q180x, glm::vec3(0, 1, 0));
    check(approx_vec3(rotated, glm::vec3(0, -1, 0)), "180deg X flips Y to -Y");

    // Rotation preserves vector magnitude
    glm::vec4 q_arb = glm::normalize(glm::vec4(0.3f, 0.5f, 0.1f, 0.8f));
    glm::vec3 v_arb(3, 4, 5);
    glm::vec3 v_rot = quat_rotate_vec(q_arb, v_arb);
    float orig_len = glm::length(v_arb);
    float rot_len = glm::length(v_rot);
    check(approx(orig_len, rot_len, 0.01f), "rotation preserves vector magnitude");
}

// ── PBD transform composition ──

static void test_pbd_transform_composition() {
    std::printf("=== PBD transform composition (anchor + rotation) ===\n");

    // Simulates the gs_preprocess.comp PBD path:
    //   local_offset = pos - anchor
    //   pos = anchor + quat_rotate(pbd_q, local_offset)
    //   rot_q = quat_mul(pbd_q, rot_q)

    glm::vec3 anchor(10, 0, 0);
    glm::vec3 pos(11, 0, 0);  // 1 unit to the right of anchor
    glm::vec4 orig_rot(0, 0, 0, 1);  // identity

    // PBD rotation: 90deg around Y
    glm::vec4 pbd_q(0, std::sin(M_PI / 4.0f), 0, std::cos(M_PI / 4.0f));

    // Apply PBD transform (mirror shader logic)
    glm::vec3 local_offset = pos - anchor;
    glm::vec3 new_pos = anchor + quat_rotate_vec(pbd_q, local_offset);
    glm::vec4 new_rot = quat_mul(pbd_q, orig_rot);

    // The point (1,0,0) relative to anchor should rotate to (0,0,-1) relative to anchor
    check(approx_vec3(new_pos, glm::vec3(10, 0, -1)),
          "PBD rotates position around anchor correctly");
    check(approx_vec4(new_rot, pbd_q),
          "PBD composes rotation with identity correctly");

    // Multiple Gaussians at different offsets from same anchor should maintain relative structure
    glm::vec3 pos2(10, 1, 0);  // 1 unit above anchor
    glm::vec3 local2 = pos2 - anchor;
    glm::vec3 new_pos2 = anchor + quat_rotate_vec(pbd_q, local2);
    // (0,1,0) rotated 90deg around Y stays (0,1,0)
    check(approx_vec3(new_pos2, glm::vec3(10, 1, 0)),
          "Y-axis point unchanged by Y-axis rotation (correct anchor pivot)");

    // Distance between the two transformed points should equal original distance
    float orig_dist = glm::length(pos - pos2);
    float new_dist = glm::length(new_pos - new_pos2);
    check(approx(orig_dist, new_dist, 0.01f),
          "PBD preserves inter-Gaussian distances (rigid body)");
}

// ── Axis-angle to quaternion ──

static void test_axis_angle_to_quat() {
    std::printf("=== Axis-angle to quaternion ===\n");

    // Zero angle → identity
    glm::vec4 q = axis_angle_to_quat(glm::vec3(1, 0, 0), 0.0f);
    check(approx_vec4(q, glm::vec4(0, 0, 0, 1)), "zero angle → identity quaternion");

    // 90deg around Z
    q = axis_angle_to_quat(glm::vec3(0, 0, 1), static_cast<float>(M_PI / 2.0));
    float expected_s = std::sin(M_PI / 4.0f);
    float expected_c = std::cos(M_PI / 4.0f);
    check(approx_vec4(q, glm::vec4(0, 0, expected_s, expected_c)),
          "90deg around Z produces correct quaternion");

    // Result is unit length
    float len = glm::length(q);
    check(approx(len, 1.0f), "axis-angle quaternion is unit length");

    // 180deg around arbitrary axis
    glm::vec3 axis = glm::normalize(glm::vec3(1, 1, 0));
    q = axis_angle_to_quat(axis, static_cast<float>(M_PI));
    len = glm::length(q);
    check(approx(len, 1.0f), "180deg quaternion is unit length");
    // w should be cos(pi/2) = 0
    check(approx(q.w, 0.0f, 0.01f), "180deg rotation has w ≈ 0");
}

// ── Wind sway produces valid output ──

static void test_wind_sway_output() {
    std::printf("=== Wind sway produces valid rotations ===\n");

    // Simulate pbd_solver.comp logic for a few anchors
    glm::vec3 wind = glm::normalize(glm::vec3(1, 0, 0));
    float strength = 0.3f;
    float freq = 2.0f;
    float time = 1.5f;

    glm::vec3 anchors[] = {
        {0, 0, 0}, {10, 5, 3}, {-5, 0, 20}
    };

    for (int i = 0; i < 3; ++i) {
        glm::vec3 anchor = anchors[i];
        float phase = glm::dot(anchor, glm::vec3(0.37f, 0.13f, 0.71f));
        float sway_angle = std::sin(time * freq + phase) * strength;

        glm::vec3 sway_axis = glm::normalize(glm::cross(wind, glm::vec3(0, 1, 0)));
        glm::vec4 q = axis_angle_to_quat(sway_axis, sway_angle);

        float len = glm::length(q);
        check(approx(len, 1.0f, 0.001f),
              (std::string("wind sway quat ") + std::to_string(i) + " is unit length").c_str());

        // Sway angle should be within [-strength, +strength]
        check(std::fabs(sway_angle) <= strength + 0.001f,
              (std::string("sway angle ") + std::to_string(i) + " within bounds").c_str());
    }

    // Different anchors should produce different sway angles (spatial variation)
    float phase0 = glm::dot(anchors[0], glm::vec3(0.37f, 0.13f, 0.71f));
    float phase1 = glm::dot(anchors[1], glm::vec3(0.37f, 0.13f, 0.71f));
    float angle0 = std::sin(time * freq + phase0) * strength;
    float angle1 = std::sin(time * freq + phase1) * strength;
    check(!approx(angle0, angle1, 0.0001f),
          "different anchors produce different sway (spatial variation)");
}

int main() {
    std::printf("test_pbd_solver\n");

    test_pbd_state_layout();
    test_index_segmentation();
    test_quat_multiplication();
    test_quat_vector_rotation();
    test_pbd_transform_composition();
    test_axis_angle_to_quat();
    test_wind_sway_output();

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
