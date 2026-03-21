// Unit test: GsParallaxCamera — configure, update, view/proj matrices
//
// Build:
//   c++ -std=c++23 -I include -I build/macos-debug/_deps/glm-src \
//       -I build/macos-debug/_deps/json-src/include \
//       -I build/macos-debug/_deps/stb-src \
//       tests/test_gs_parallax_camera.cpp src/engine/gs_parallax_camera.cpp \
//       src/engine/scene_loader.cpp src/engine/tilemap.cpp \
//       -o build/test_gs_parallax_camera
//
// Run: ./build/test_gs_parallax_camera

#include "gseurat/engine/gs_parallax_camera.hpp"

#include <glm/glm.hpp>

#include <cassert>
#include <cmath>
#include <cstdio>

using namespace gseurat;

static bool is_identity(const glm::mat4& m) {
    for (int c = 0; c < 4; ++c)
        for (int r = 0; r < 4; ++r) {
            float expected = (c == r) ? 1.0f : 0.0f;
            if (std::abs(m[c][r] - expected) > 0.001f) return false;
        }
    return true;
}

static bool is_zero(const glm::mat4& m) {
    for (int c = 0; c < 4; ++c)
        for (int r = 0; r < 4; ++r)
            if (std::abs(m[c][r]) > 0.001f) return false;
    return true;
}

static GsParallaxConfig default_config() {
    GsParallaxConfig cfg{};
    cfg.azimuth_range = 0.15f;
    cfg.elevation_min = -0.15f;
    cfg.elevation_max = 0.15f;
    cfg.distance_range = 0.10f;
    cfg.parallax_strength = 1.0f;
    return cfg;
}

int main() {
    // 1. Initial matrices valid (not identity/zero after configure)
    {
        GsParallaxCamera cam;
        cam.configure(
            glm::vec3(0.0f, 5.0f, 10.0f),
            glm::vec3(0.0f, 0.0f, 0.0f),
            45.0f, 320, 240, default_config());

        auto v = cam.view();
        auto p = cam.proj();
        assert(!is_identity(v));
        assert(!is_zero(v));
        assert(!is_identity(p));
        assert(!is_zero(p));
        std::printf("PASS: initial matrices valid\n");
    }

    // 2. Vulkan Y-flip: proj[1][1] < 0
    {
        GsParallaxCamera cam;
        cam.configure(
            glm::vec3(0.0f, 5.0f, 10.0f),
            glm::vec3(0.0f, 0.0f, 0.0f),
            45.0f, 320, 240, default_config());

        assert(cam.proj()[1][1] < 0.0f);
        std::printf("PASS: Vulkan Y-flip\n");
    }

    // 3. Zero offset with dt=0 doesn't change view
    {
        GsParallaxCamera cam;
        cam.configure(
            glm::vec3(0.0f, 5.0f, 10.0f),
            glm::vec3(0.0f, 0.0f, 0.0f),
            45.0f, 320, 240, default_config());

        auto v_before = cam.view();
        cam.update(glm::vec2(0.0f, 0.0f), 0.0f);
        auto v_after = cam.view();

        // With dt=0, smooth factor is 0, so no change
        for (int c = 0; c < 4; ++c)
            for (int r = 0; r < 4; ++r)
                assert(std::abs(v_before[c][r] - v_after[c][r]) < 0.001f);
        std::printf("PASS: zero offset no change\n");
    }

    // 4. Offset shifts camera
    {
        GsParallaxCamera cam;
        cam.configure(
            glm::vec3(0.0f, 5.0f, 10.0f),
            glm::vec3(0.0f, 0.0f, 0.0f),
            45.0f, 320, 240, default_config());

        auto v_before = cam.view();
        cam.update(glm::vec2(1.0f, 0.0f), 1.0f / 60.0f);
        auto v_after = cam.view();

        // At least one element should differ
        bool changed = false;
        for (int c = 0; c < 4; ++c)
            for (int r = 0; r < 4; ++r)
                if (std::abs(v_before[c][r] - v_after[c][r]) > 0.0001f) changed = true;
        assert(changed);
        std::printf("PASS: offset shifts camera\n");
    }

    // 5. Smoothing converges — many updates toward offset should approach target
    {
        GsParallaxCamera cam;
        cam.configure(
            glm::vec3(0.0f, 5.0f, 10.0f),
            glm::vec3(0.0f, 0.0f, 0.0f),
            45.0f, 320, 240, default_config());

        // Apply same offset many times
        for (int i = 0; i < 300; ++i) {
            cam.update(glm::vec2(1.0f, 0.0f), 1.0f / 60.0f);
        }
        auto v1 = cam.view();

        // One more update should barely change it (converged)
        cam.update(glm::vec2(1.0f, 0.0f), 1.0f / 60.0f);
        auto v2 = cam.view();

        float max_diff = 0.0f;
        for (int c = 0; c < 4; ++c)
            for (int r = 0; r < 4; ++r)
                max_diff = std::max(max_diff, std::abs(v1[c][r] - v2[c][r]));
        assert(max_diff < 0.001f);
        std::printf("PASS: smoothing converges\n");
    }

    // 6. Aspect ratio — configure 320×240, verify proj encodes 4:3
    {
        GsParallaxCamera cam;
        cam.configure(
            glm::vec3(0.0f, 5.0f, 10.0f),
            glm::vec3(0.0f, 0.0f, 0.0f),
            45.0f, 320, 240, default_config());

        auto p = cam.proj();
        // For perspective: p[0][0] = 1/(aspect*tan(fov/2)), p[1][1] = -1/tan(fov/2)
        // aspect = 320/240 = 4/3, so |p[1][1]| / |p[0][0]| ≈ 4/3
        float ratio = std::abs(p[1][1]) / std::abs(p[0][0]);
        assert(std::abs(ratio - (4.0f / 3.0f)) < 0.01f);
        std::printf("PASS: aspect ratio 4:3\n");
    }

    std::printf("\nAll gs_parallax_camera tests passed.\n");
    return 0;
}
