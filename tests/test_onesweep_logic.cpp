#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstddef>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

// ============================================================
// Key Packing Logic (mirrors gs_tile_bin.comp)
// ============================================================

static uint32_t pack_tile_sort_key(uint32_t tile_id, float depth, float near_z, float far_z) {
    float t = (depth - near_z) / (far_z - near_z);
    if (t < 0.0f) t = 0.0f;
    if (t > 1.0f) t = 1.0f;
    uint32_t depth_q = static_cast<uint32_t>(t * 65535.0f);
    if (depth_q > 0xFFFEu) depth_q = 0xFFFEu;
    return (tile_id << 16u) | depth_q;
}

static void extract_near_far(const glm::mat4& proj, float& near_z, float& far_z) {
    float A = proj[2][2];
    float B = proj[3][2];
    near_z = B / A;
    far_z  = B / (A + 1.0f);
}

// ============================================================
// Status Buffer Encoding (mirrors gs_onesweep.comp)
// ============================================================

static constexpr uint32_t LOCAL_FLAG    = 1u << 30u;
static constexpr uint32_t INCLUSIVE_FLAG = 3u << 30u;
static constexpr uint32_t VALUE_MASK    = 0x3FFFFFFFu;

static uint32_t encode_local(uint32_t sum) {
    return LOCAL_FLAG | (sum & VALUE_MASK);
}

static uint32_t encode_inclusive(uint32_t sum) {
    return INCLUSIVE_FLAG | (sum & VALUE_MASK);
}

static uint32_t decode_state(uint32_t val) {
    return val >> 30u;
}

static uint32_t decode_sum(uint32_t val) {
    return val & VALUE_MASK;
}

// ============================================================
// GsUniforms UBO Layout Audit (must match GLSL std140)
// ============================================================

inline constexpr uint32_t kMaxGsPointLights = 8;

struct GsUniforms {
    glm::mat4 view;
    glm::mat4 proj;
    glm::mat4 inv_view;
    glm::mat4 inv_proj;
    glm::uvec4 params;
    glm::vec4 shadow_box;
    glm::vec4 cone_dir;
    glm::vec4 cam_pos;
    glm::vec4 effect_flags;
    glm::vec4 light_params;
    glm::vec4 touch_point;
    glm::vec4 effect_params;
    glm::vec4 effect_params2;
    glm::vec4 point_light_params;
    glm::vec4 actor_rotation;
    glm::vec4 pl_pos_rad[kMaxGsPointLights];
    glm::vec4 pl_color[kMaxGsPointLights];
    glm::vec4 pl_dir_cone[kMaxGsPointLights];
    glm::vec4 pl_area[kMaxGsPointLights];
    glm::vec4 tile_sort_params;
};

int main() {
    // ========================================
    // Task 1: Key Packing Tests
    // ========================================

    // 1a: Sort order preserved within same tile
    {
        uint32_t k1 = pack_tile_sort_key(5, 10.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(5, 20.0f, 0.1f, 1000.0f);
        assert(k1 < k2 && "same tile, closer depth should sort first");
    }

    // 1b: Tile ID is primary sort key
    {
        uint32_t k1 = pack_tile_sort_key(3, 500.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(4, 1.0f, 0.1f, 1000.0f);
        assert(k1 < k2 && "lower tile_id sorts first regardless of depth");
    }

    // 1c: Depth clamping
    {
        uint32_t k_near = pack_tile_sort_key(0, -5.0f, 0.1f, 1000.0f);
        uint32_t k_far  = pack_tile_sort_key(0, 9999.0f, 0.1f, 1000.0f);
        assert((k_near & 0xFFFFu) == 0 && "below near clamped to 0");
        assert((k_far & 0xFFFFu) == 0xFFFEu && "above far clamped to 0xFFFE");
    }

    // 1d: Sentinel is maximum
    {
        uint32_t sentinel = 0xFFFFFFFFu;
        uint32_t k_max = pack_tile_sort_key(0xFFFFu - 1, 1000.0f, 0.1f, 1000.0f);
        assert(k_max < sentinel && "sentinel must sort after all valid keys");
    }

    // 1e: Near/far extraction from perspective matrix
    {
        float near_in = 0.1f, far_in = 1000.0f;
        glm::mat4 proj = glm::perspectiveRH_ZO(glm::radians(60.0f), 16.0f/9.0f, near_in, far_in);
        float near_out, far_out;
        extract_near_far(proj, near_out, far_out);
        assert(std::abs(near_out - near_in) < 0.001f && "near plane extraction");
        assert(std::abs(far_out - far_in) < 1.0f && "far plane extraction");
        std::printf("  near: in=%.4f out=%.4f  far: in=%.1f out=%.1f\n",
                    near_in, near_out, far_in, far_out);
    }

    // 1f: 16-bit depth precision
    {
        uint32_t k1 = pack_tile_sort_key(0, 10.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(0, 10.02f, 0.1f, 1000.0f);
        assert(k1 != k2 && "0.02 apart at depth 10 should produce different keys");
    }

    std::printf("PASS: key packing (6 tests)\n");

    // ========================================
    // Task 1: Status Encoding Tests
    // ========================================

    // 2a: LOCAL encoding
    {
        uint32_t encoded = encode_local(42);
        assert(decode_state(encoded) == 1 && "LOCAL state = 1");
        assert(decode_sum(encoded) == 42 && "LOCAL sum preserved");
    }

    // 2b: INCLUSIVE encoding
    {
        uint32_t encoded = encode_inclusive(12345);
        assert(decode_state(encoded) == 3 && "INCLUSIVE state = 3");
        assert(decode_sum(encoded) == 12345 && "INCLUSIVE sum preserved");
    }

    // 2c: NOT_READY is 0
    {
        uint32_t not_ready = 0u;
        assert(decode_state(not_ready) == 0 && "NOT_READY state = 0");
        assert(decode_sum(not_ready) == 0 && "NOT_READY sum = 0");
    }

    // 2d: Max value fits in 30 bits
    {
        uint32_t max_val = VALUE_MASK;  // 0x3FFFFFFF = 1073741823
        uint32_t encoded = encode_inclusive(max_val);
        assert(decode_sum(encoded) == max_val && "max 30-bit value preserved");
        assert(decode_state(encoded) == 3 && "state bits intact with max value");
    }

    // 2e: Value overflow is masked
    {
        uint32_t overflow = 0xFFFFFFFFu;
        uint32_t encoded = encode_local(overflow);
        assert(decode_sum(encoded) == VALUE_MASK && "overflow masked to 30 bits");
        assert(decode_state(encoded) == 1 && "LOCAL state preserved despite overflow");
    }

    std::printf("PASS: status encoding (5 tests)\n");

    // ========================================
    // Task 2: UBO Layout Audit
    // ========================================

    std::printf("\n=== GsUniforms Layout Audit ===\n");
    std::printf("sizeof(GsUniforms) = %zu bytes\n", sizeof(GsUniforms));

    // Expected offsets per std140:
    // 4 × mat4 = 256 bytes, then 11 × vec4 = 176, then 4 × vec4[8] = 512, then tile_sort_params = 16
    // Total = 256 + 176 + 512 + 16 = 960
    std::printf("  view:              offset=%3zu  (expected=  0)\n", offsetof(GsUniforms, view));
    std::printf("  proj:              offset=%3zu  (expected= 64)\n", offsetof(GsUniforms, proj));
    std::printf("  inv_view:          offset=%3zu  (expected=128)\n", offsetof(GsUniforms, inv_view));
    std::printf("  inv_proj:          offset=%3zu  (expected=192)\n", offsetof(GsUniforms, inv_proj));
    std::printf("  params:            offset=%3zu  (expected=256)\n", offsetof(GsUniforms, params));
    std::printf("  shadow_box:        offset=%3zu  (expected=272)\n", offsetof(GsUniforms, shadow_box));
    std::printf("  cone_dir:          offset=%3zu  (expected=288)\n", offsetof(GsUniforms, cone_dir));
    std::printf("  cam_pos:           offset=%3zu  (expected=304)\n", offsetof(GsUniforms, cam_pos));
    std::printf("  effect_flags:      offset=%3zu  (expected=320)\n", offsetof(GsUniforms, effect_flags));
    std::printf("  light_params:      offset=%3zu  (expected=336)\n", offsetof(GsUniforms, light_params));
    std::printf("  touch_point:       offset=%3zu  (expected=352)\n", offsetof(GsUniforms, touch_point));
    std::printf("  effect_params:     offset=%3zu  (expected=368)\n", offsetof(GsUniforms, effect_params));
    std::printf("  effect_params2:    offset=%3zu  (expected=384)\n", offsetof(GsUniforms, effect_params2));
    std::printf("  point_light_params:offset=%3zu  (expected=400)\n", offsetof(GsUniforms, point_light_params));
    std::printf("  actor_rotation:    offset=%3zu  (expected=416)\n", offsetof(GsUniforms, actor_rotation));
    std::printf("  pl_pos_rad:        offset=%3zu  (expected=432)\n", offsetof(GsUniforms, pl_pos_rad));
    std::printf("  pl_color:          offset=%3zu  (expected=560)\n", offsetof(GsUniforms, pl_color));
    std::printf("  pl_dir_cone:       offset=%3zu  (expected=688)\n", offsetof(GsUniforms, pl_dir_cone));
    std::printf("  pl_area:           offset=%3zu  (expected=816)\n", offsetof(GsUniforms, pl_area));
    std::printf("  tile_sort_params:  offset=%3zu  (expected=944)\n", offsetof(GsUniforms, tile_sort_params));

    // Static assertions for critical offsets
    static_assert(offsetof(GsUniforms, view) == 0, "view offset mismatch");
    static_assert(offsetof(GsUniforms, proj) == 64, "proj offset mismatch");
    static_assert(offsetof(GsUniforms, inv_view) == 128, "inv_view offset mismatch");
    static_assert(offsetof(GsUniforms, inv_proj) == 192, "inv_proj offset mismatch");
    static_assert(offsetof(GsUniforms, params) == 256, "params offset mismatch");
    static_assert(offsetof(GsUniforms, shadow_box) == 272, "shadow_box offset mismatch");
    static_assert(offsetof(GsUniforms, cam_pos) == 304, "cam_pos offset mismatch");
    static_assert(offsetof(GsUniforms, pl_pos_rad) == 432, "pl_pos_rad offset mismatch");
    static_assert(offsetof(GsUniforms, pl_area) == 816, "pl_area offset mismatch");
    static_assert(offsetof(GsUniforms, tile_sort_params) == 944, "tile_sort_params offset mismatch");
    static_assert(sizeof(GsUniforms) == 960, "GsUniforms total size mismatch (expected 960)");

    std::printf("\nALL static_assert passed — C++ layout matches std140 expectations\n");
    std::printf("PASS: UBO layout audit\n");

    return 0;
}
