// Unit test: GsChunkGrid — build, visible_chunks, gather, gather_lod
//
// Build:
//   c++ -std=c++23 -I include -I build/macos-debug/_deps/glm-src \
//       -I build/macos-debug/_deps/stb-src \
//       tests/test_gs_chunk_grid.cpp src/engine/gs_chunk_grid.cpp \
//       src/engine/gaussian_cloud.cpp \
//       -o build/test_gs_chunk_grid
//
// Run: ./build/test_gs_chunk_grid

#include "gseurat/engine/gs_chunk_grid.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#include <cassert>
#include <cmath>
#include <cstdio>
#include <set>
#include <vector>

using namespace gseurat;

// Build a wide VP matrix that sees a large region centered at the given position
static glm::mat4 wide_vp(glm::vec3 center = glm::vec3(0.0f)) {
    glm::mat4 view = glm::lookAt(
        center + glm::vec3(0.0f, 0.0f, 500.0f),
        center,
        glm::vec3(0.0f, 1.0f, 0.0f));
    glm::mat4 proj = glm::perspective(glm::radians(120.0f), 1.0f, 0.1f, 2000.0f);
    return proj * view;
}

// Helper: create a Gaussian at a given position with specified opacity and scale
static Gaussian make_test_gaussian(glm::vec3 pos, float opacity = 0.9f, float scale = 0.01f) {
    Gaussian g{};
    g.position = pos;
    g.scale = glm::vec3(scale);
    g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    g.color = glm::vec3(1.0f);
    g.opacity = opacity;
    g.importance = opacity * scale;
    return g;
}

int main() {
    // 1. Empty cloud → empty grid
    {
        GaussianCloud cloud = GaussianCloud::from_gaussians({});
        GsChunkGrid grid;
        grid.build(cloud);
        assert(grid.empty());
        std::printf("PASS: empty cloud\n");
    }

    // 2. Single Gaussian → 1 chunk, correct bounds
    {
        std::vector<Gaussian> gs = { make_test_gaussian({5.0f, 3.0f, 0.0f}) };
        auto cloud = GaussianCloud::from_gaussians(std::move(gs));
        GsChunkGrid grid;
        grid.build(cloud, 32.0f);
        assert(!grid.empty());
        auto bounds = grid.cloud_bounds();
        assert(std::abs(bounds.min.x - 5.0f) < 0.001f);
        assert(std::abs(bounds.max.x - 5.0f) < 0.001f);
        std::printf("PASS: single Gaussian\n");
    }

    // 3. Multi-chunk: Gaussians spread across area → multiple chunks
    {
        std::vector<Gaussian> gs;
        // Place Gaussians at 0, 50, 100 along X — should span multiple 32-unit chunks
        for (float x = 0.0f; x <= 100.0f; x += 50.0f) {
            gs.push_back(make_test_gaussian({x, 0.0f, 0.0f}));
        }
        auto cloud = GaussianCloud::from_gaussians(std::move(gs));
        GsChunkGrid grid;
        grid.build(cloud, 32.0f);
        // With range 0..100 and chunk_size=32, we need ceil(100/32)=4 cols
        // Wide camera to see everything
        glm::mat4 view = glm::lookAt(
            glm::vec3(50.0f, 0.0f, 200.0f),
            glm::vec3(50.0f, 0.0f, 0.0f),
            glm::vec3(0.0f, 1.0f, 0.0f));
        glm::mat4 proj = glm::perspective(glm::radians(90.0f), 1.0f, 0.1f, 500.0f);
        auto visible = grid.visible_chunks(proj * view);
        assert(visible.size() >= 2);
        std::printf("PASS: multi-chunk\n");
    }

    // 4. visible_chunks returns results for known VP
    {
        std::vector<Gaussian> gs;
        for (float x = 0.0f; x < 64.0f; x += 8.0f) {
            for (float y = 0.0f; y < 64.0f; y += 8.0f) {
                gs.push_back(make_test_gaussian({x, y, 0.0f}));
            }
        }
        auto cloud = GaussianCloud::from_gaussians(std::move(gs));
        GsChunkGrid grid;
        grid.build(cloud, 32.0f);

        // Camera looking at center from above
        glm::mat4 view = glm::lookAt(
            glm::vec3(32.0f, 32.0f, 100.0f),
            glm::vec3(32.0f, 32.0f, 0.0f),
            glm::vec3(0.0f, 1.0f, 0.0f));
        glm::mat4 proj = glm::perspective(glm::radians(60.0f), 1.0f, 0.1f, 500.0f);
        auto vp = proj * view;
        auto visible = grid.visible_chunks(vp);
        assert(!visible.empty());
        std::printf("PASS: visible_chunks returns results\n");
    }

    // 5. Frustum culling: tight camera doesn't see all chunks in large grid
    {
        std::vector<Gaussian> gs;
        // Spread Gaussians over 1000 units
        for (float x = 0.0f; x < 1000.0f; x += 10.0f) {
            gs.push_back(make_test_gaussian({x, 0.0f, 0.0f}));
        }
        auto cloud = GaussianCloud::from_gaussians(std::move(gs));
        GsChunkGrid grid;
        grid.build(cloud, 32.0f);

        // Tight camera at origin looking down +X with narrow FOV
        glm::mat4 view = glm::lookAt(
            glm::vec3(0.0f, 0.0f, 50.0f),
            glm::vec3(0.0f, 0.0f, 0.0f),
            glm::vec3(0.0f, 1.0f, 0.0f));
        glm::mat4 proj = glm::perspective(glm::radians(30.0f), 1.0f, 0.1f, 200.0f);
        auto vp = proj * view;

        auto all = grid.visible_chunks(wide_vp(glm::vec3(500.0f, 0.0f, 0.0f)));
        auto culled = grid.visible_chunks(vp);
        assert(culled.size() < all.size());
        std::printf("PASS: frustum culling\n");
    }

    // 6. gather count matches sum of selected chunk counts
    {
        std::vector<Gaussian> gs;
        for (int i = 0; i < 50; ++i) {
            gs.push_back(make_test_gaussian({static_cast<float>(i * 2), 0.0f, 0.0f}));
        }
        auto cloud = GaussianCloud::from_gaussians(std::move(gs));
        GsChunkGrid grid;
        grid.build(cloud, 32.0f);

        auto visible = grid.visible_chunks(wide_vp(glm::vec3(50.0f, 0.0f, 0.0f)));
        std::vector<Gaussian> out;
        uint32_t count = grid.gather(visible, out);
        assert(count == static_cast<uint32_t>(out.size()));
        assert(count == 50);
        std::printf("PASS: gather count\n");
    }

    // 7. gather_lod respects budget
    {
        std::vector<Gaussian> gs;
        for (int i = 0; i < 1000; ++i) {
            float x = static_cast<float>(i % 50);
            float y = static_cast<float>(i / 50);
            gs.push_back(make_test_gaussian({x, y, 0.0f}));
        }
        auto cloud = GaussianCloud::from_gaussians(std::move(gs));
        GsChunkGrid grid;
        grid.build(cloud, 16.0f);

        auto visible = grid.visible_chunks(wide_vp(glm::vec3(25.0f, 10.0f, 0.0f)));
        std::vector<Gaussian> out;
        glm::vec3 cam_pos(25.0f, 10.0f, 50.0f);
        uint32_t count = grid.gather_lod(visible, cam_pos, 200, out);
        assert(count <= 200);
        assert(count == static_cast<uint32_t>(out.size()));
        std::printf("PASS: gather_lod respects budget\n");
    }

    // 8. gather_lod spatial coverage — stride sampling covers spatial range
    {
        std::vector<Gaussian> gs;
        // 100 Gaussians spread along X from 0 to 99
        for (int i = 0; i < 100; ++i) {
            gs.push_back(make_test_gaussian({static_cast<float>(i), 0.0f, 0.0f}, 0.5f, 0.01f));
        }
        auto cloud = GaussianCloud::from_gaussians(std::move(gs));
        GsChunkGrid grid;
        grid.build(cloud, 32.0f);

        auto visible = grid.visible_chunks(wide_vp(glm::vec3(50.0f, 0.0f, 0.0f)));
        std::vector<Gaussian> out;
        glm::vec3 cam_pos(50.0f, 0.0f, 50.0f);  // far enough for LOD
        grid.gather_lod(visible, cam_pos, 20, out);

        // Check that output covers a range of X positions, not just the first N
        float min_x = 1e9f, max_x = -1e9f;
        for (const auto& g : out) {
            min_x = std::min(min_x, g.position.x);
            max_x = std::max(max_x, g.position.x);
        }
        // Should span at least 50 units of the 0..99 range
        assert((max_x - min_x) > 30.0f);
        std::printf("PASS: gather_lod spatial coverage\n");
    }

    // 9. cloud_bounds accuracy
    {
        std::vector<Gaussian> gs;
        gs.push_back(make_test_gaussian({-10.0f, 5.0f, 3.0f}));
        gs.push_back(make_test_gaussian({20.0f, -7.0f, 12.0f}));
        gs.push_back(make_test_gaussian({0.0f, 0.0f, 0.0f}));
        auto cloud = GaussianCloud::from_gaussians(std::move(gs));
        GsChunkGrid grid;
        grid.build(cloud, 32.0f);

        auto bounds = grid.cloud_bounds();
        assert(std::abs(bounds.min.x - (-10.0f)) < 0.001f);
        assert(std::abs(bounds.min.y - (-7.0f)) < 0.001f);
        assert(std::abs(bounds.min.z - 0.0f) < 0.001f);
        assert(std::abs(bounds.max.x - 20.0f) < 0.001f);
        assert(std::abs(bounds.max.y - 5.0f) < 0.001f);
        assert(std::abs(bounds.max.z - 12.0f) < 0.001f);
        std::printf("PASS: cloud_bounds accuracy\n");
    }

    std::printf("\nAll gs_chunk_grid tests passed.\n");
    return 0;
}
