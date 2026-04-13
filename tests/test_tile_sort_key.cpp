#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

// Key packing logic (will be shared with shader via matching algorithm)
static uint32_t pack_tile_sort_key(uint32_t tile_id, float depth, float near_z, float far_z) {
    float t = (depth - near_z) / (far_z - near_z);
    if (t < 0.0f) t = 0.0f;
    if (t > 1.0f) t = 1.0f;
    uint32_t depth_q = static_cast<uint32_t>(t * 65535.0f);
    if (depth_q > 0xFFFEu) depth_q = 0xFFFEu;  // 0xFFFF reserved for sentinel
    return (tile_id << 16u) | depth_q;
}

static void extract_near_far(const glm::mat4& proj, float& near_z, float& far_z) {
    // glm::perspective with GLM_FORCE_DEPTH_ZERO_TO_ONE → perspectiveRH_ZO
    // proj[2][2] = -far/(far-near), proj[3][2] = -far*near/(far-near)
    // near = B / A,  far = B / (A + 1)  (matches renderer.cpp gs_pp extraction)
    float A = proj[2][2];
    float B = proj[3][2];
    near_z = B / A;
    far_z  = B / (A + 1.0f);
}

int main() {
    // Test 1: Key packing preserves sort order
    {
        uint32_t k1 = pack_tile_sort_key(5, 10.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(5, 20.0f, 0.1f, 1000.0f);
        assert(k1 < k2);  // same tile, closer depth sorts first
    }

    // Test 2: Tile ID is primary sort key
    {
        uint32_t k1 = pack_tile_sort_key(3, 500.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(4, 1.0f, 0.1f, 1000.0f);
        assert(k1 < k2);  // tile 3 < tile 4 regardless of depth
    }

    // Test 3: Depth clamping at boundaries
    {
        uint32_t k_near = pack_tile_sort_key(0, -5.0f, 0.1f, 1000.0f);
        uint32_t k_far  = pack_tile_sort_key(0, 9999.0f, 0.1f, 1000.0f);
        assert((k_near & 0xFFFFu) == 0);       // clamped to 0
        assert((k_far & 0xFFFFu) == 0xFFFEu);  // clamped to max (0xFFFF reserved)
    }

    // Test 4: Sentinel key is maximum
    {
        uint32_t sentinel = 0xFFFFFFFFu;
        uint32_t k_max = pack_tile_sort_key(0xFFFFu - 1, 1000.0f, 0.1f, 1000.0f);
        assert(k_max < sentinel);
    }

    // Test 5: Near/far extraction from projection matrix
    {
        float near_in = 0.1f, far_in = 1000.0f;
        glm::mat4 proj = glm::perspective(glm::radians(60.0f), 1.0f, near_in, far_in);
        float near_out, far_out;
        extract_near_far(proj, near_out, far_out);
        assert(std::abs(near_out - near_in) < 0.01f);
        assert(std::abs(far_out - far_in) < 1.0f);
    }

    // Test 6: 16-bit depth has sufficient precision
    {
        // Two Gaussians 0.02 apart at depth ~10 should get different keys
        uint32_t k1 = pack_tile_sort_key(0, 10.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(0, 10.02f, 0.1f, 1000.0f);
        assert(k1 != k2);  // 0.02 / 1000 * 65535 ≈ 1.3 — should differ by at least 1
    }

    std::printf("PASS: test_tile_sort_key (6 tests)\n");
    return 0;
}
