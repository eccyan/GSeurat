#include "gseurat/engine/collision/bvh.hpp"
#include <cstdio>
#include <cmath>
#include <numeric>
#include <random>
#include <algorithm>
#include <set>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

// Helper: create AABB for a unit cube centered at (x, y, z)
static AABB make_cube(float x, float y, float z) {
    return AABB{glm::vec3(x - 0.5f, y - 0.5f, z - 0.5f),
                glm::vec3(x + 0.5f, y + 0.5f, z + 0.5f)};
}

int main() {
    std::printf("=== test_bvh ===\n");

    // ── Test 1: Build 8 cubes ──────────────────────────────────────────
    std::printf("\n-- Test 1: Build 8 cubes at (±1, ±1, ±1) --\n");
    {
        std::vector<AABB> aabbs;
        for (float x : {-1.0f, 1.0f})
            for (float y : {-1.0f, 1.0f})
                for (float z : {-1.0f, 1.0f})
                    aabbs.push_back(make_cube(x, y, z));

        std::vector<uint32_t> indices(aabbs.size());
        std::iota(indices.begin(), indices.end(), 0u);

        BVH bvh;
        bvh.build(aabbs, indices);

        check(!bvh.empty(), "bvh is non-empty after build");
        // 8 items / MAX_LEAF_SIZE=4 → 1 root + 2 leaves = 3 nodes minimum
        check(bvh.nodes().size() >= 3u, "node count >= 3 (root + 2 leaves)");
    }

    // ── Test 2: query_aabb — small query hits exactly 1 cube ───────────
    std::printf("\n-- Test 2: Small query hits exactly 1 cube --\n");
    {
        std::vector<AABB> aabbs;
        for (float x : {-1.0f, 1.0f})
            for (float y : {-1.0f, 1.0f})
                for (float z : {-1.0f, 1.0f})
                    aabbs.push_back(make_cube(x, y, z));
        // aabbs[7] = cube at (1, 1, 1) — iterate order: index 7 = (x=1,y=1,z=1)

        std::vector<uint32_t> indices(aabbs.size());
        std::iota(indices.begin(), indices.end(), 0u);

        BVH bvh;
        bvh.build(aabbs, indices);

        // Query tightly around (1,1,1)
        AABB query{glm::vec3(0.6f, 0.6f, 0.6f), glm::vec3(1.4f, 1.4f, 1.4f)};
        std::vector<uint32_t> out;
        bvh.query_aabb(query, aabbs, indices, out);

        check(out.size() == 1u, "small query: exactly 1 result");
        check(!out.empty() && out[0] == 7u, "small query: result is cube at (1,1,1) [index 7]");
    }

    // ── Test 3: query_aabb — large query hits all 8 ───────────────────
    std::printf("\n-- Test 3: Large query hits all 8 cubes --\n");
    {
        std::vector<AABB> aabbs;
        for (float x : {-1.0f, 1.0f})
            for (float y : {-1.0f, 1.0f})
                for (float z : {-1.0f, 1.0f})
                    aabbs.push_back(make_cube(x, y, z));

        std::vector<uint32_t> indices(aabbs.size());
        std::iota(indices.begin(), indices.end(), 0u);

        BVH bvh;
        bvh.build(aabbs, indices);

        AABB query{glm::vec3(-2.0f), glm::vec3(2.0f)};
        std::vector<uint32_t> out;
        bvh.query_aabb(query, aabbs, indices, out);

        check(out.size() == 8u, "large query: all 8 cubes found");
    }

    // ── Test 4: query_aabb — empty space returns 0 ────────────────────
    std::printf("\n-- Test 4: Query in empty space returns 0 --\n");
    {
        std::vector<AABB> aabbs;
        for (float x : {-1.0f, 1.0f})
            for (float y : {-1.0f, 1.0f})
                for (float z : {-1.0f, 1.0f})
                    aabbs.push_back(make_cube(x, y, z));

        std::vector<uint32_t> indices(aabbs.size());
        std::iota(indices.begin(), indices.end(), 0u);

        BVH bvh;
        bvh.build(aabbs, indices);

        AABB query{glm::vec3(9.5f, 9.5f, 9.5f), glm::vec3(10.5f, 10.5f, 10.5f)};
        std::vector<uint32_t> out;
        bvh.query_aabb(query, aabbs, indices, out);

        check(out.empty(), "empty-space query: 0 results");
    }

    // ── Test 5: raycast along X through 2 cubes ───────────────────────
    std::printf("\n-- Test 5: Raycast hits correct cube first --\n");
    {
        // Two cubes along X: one at x=-1, one at x=+1, both at y=1,z=1
        // Ray from (-5, 1, 1) pointing in +X direction
        // Should hit cube at (-1,1,1) first
        std::vector<AABB> aabbs;
        // index 0 = cube at (1, 1, 1)
        // index 1 = cube at (-1, 1, 1)
        aabbs.push_back(make_cube( 1.0f, 1.0f, 1.0f));
        aabbs.push_back(make_cube(-1.0f, 1.0f, 1.0f));

        std::vector<uint32_t> indices = {0, 1};

        BVH bvh;
        bvh.build(aabbs, indices);

        glm::vec3 origin(-5.0f, 1.0f, 1.0f);
        glm::vec3 dir(1.0f, 0.0f, 0.0f);
        glm::vec3 inv_dir(1.0f / dir.x, 1.0f / dir.y, 1.0f / dir.z);

        auto result = bvh.raycast(origin, inv_dir, 100.0f, aabbs, indices);

        check(result.has_value(), "raycast: hit detected");
        check(result.has_value() && result->first == 1u,
              "raycast: nearest hit is cube at (-1,1,1) [index 1]");
        check(result.has_value() && result->second > 0.0f,
              "raycast: t > 0");
    }

    // ── Test 6: Build from 1 collider ─────────────────────────────────
    std::printf("\n-- Test 6: Build from 1 collider --\n");
    {
        std::vector<AABB> aabbs = {make_cube(0.0f, 0.0f, 0.0f)};
        std::vector<uint32_t> indices = {0};

        BVH bvh;
        bvh.build(aabbs, indices);

        check(!bvh.empty(), "single-collider build: non-empty");

        AABB query{glm::vec3(-1.0f), glm::vec3(1.0f)};
        std::vector<uint32_t> out;
        bvh.query_aabb(query, aabbs, indices, out);
        check(out.size() == 1u && out[0] == 0u, "single-collider query: finds it");
    }

    // ── Test 7: Build from 0 colliders ────────────────────────────────
    std::printf("\n-- Test 7: Build from 0 colliders --\n");
    {
        std::vector<AABB> aabbs;
        std::vector<uint32_t> indices;

        BVH bvh;
        bvh.build(aabbs, indices);

        check(bvh.empty(), "zero-collider build: empty() == true");

        AABB query{glm::vec3(-100.0f), glm::vec3(100.0f)};
        std::vector<uint32_t> out;
        bvh.query_aabb(query, aabbs, indices, out);
        check(out.empty(), "zero-collider query_aabb: returns nothing");

        auto ray_result = bvh.raycast(
            glm::vec3(0.0f), glm::vec3(1.0f, 0.0f, 0.0f), 1000.0f, aabbs, indices);
        check(!ray_result.has_value(), "zero-collider raycast: returns nullopt");
    }

    // ── Test 8: Build from 100 random AABBs — brute-force comparison ──
    std::printf("\n-- Test 8: 100 random AABBs vs brute-force --\n");
    {
        std::mt19937 rng(42);
        std::uniform_real_distribution<float> pos_dist(-50.0f, 50.0f);
        std::uniform_real_distribution<float> size_dist(0.5f, 3.0f);

        std::vector<AABB> aabbs;
        for (int i = 0; i < 100; ++i) {
            glm::vec3 center(pos_dist(rng), pos_dist(rng), pos_dist(rng));
            float hs = size_dist(rng) * 0.5f;
            aabbs.push_back(AABB{center - glm::vec3(hs), center + glm::vec3(hs)});
        }

        std::vector<uint32_t> indices(aabbs.size());
        std::iota(indices.begin(), indices.end(), 0u);

        BVH bvh;
        bvh.build(aabbs, indices);

        check(!bvh.empty(), "100-random build: non-empty");

        // Query with a medium-sized box near the center
        AABB query{glm::vec3(-10.0f), glm::vec3(10.0f)};

        // BVH query
        std::vector<uint32_t> bvh_out;
        bvh.query_aabb(query, aabbs, indices, bvh_out);

        // Brute-force: check all original indices (0..99)
        std::vector<uint32_t> brute_out;
        for (uint32_t i = 0; i < static_cast<uint32_t>(aabbs.size()); ++i) {
            const auto& a = aabbs[i];
            if (a.max.x >= query.min.x && a.min.x <= query.max.x &&
                a.max.y >= query.min.y && a.min.y <= query.max.y &&
                a.max.z >= query.min.z && a.min.z <= query.max.z) {
                brute_out.push_back(i);
            }
        }

        std::sort(bvh_out.begin(), bvh_out.end());
        std::sort(brute_out.begin(), brute_out.end());

        check(bvh_out == brute_out, "100-random: BVH query matches brute-force");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return (failed == 0) ? 0 : 1;
}
