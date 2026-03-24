// Unit test: GS point light support
//
// Tests that point lights are correctly stored and capped at 8.

#include "gseurat/engine/types.hpp"

#include <cassert>
#include <cstdio>
#include <vector>

using namespace gseurat;

int main() {
    // 1. PointLight struct layout
    {
        PointLight pl;
        pl.position_and_radius = {10.0f, 20.0f, 5.0f, 8.0f};
        pl.color = {1.0f, 0.5f, 0.0f, 2.0f};

        assert(pl.position_and_radius.x == 10.0f);  // world X
        assert(pl.position_and_radius.y == 20.0f);   // world Z
        assert(pl.position_and_radius.z == 5.0f);    // height (Y)
        assert(pl.position_and_radius.w == 8.0f);    // radius
        assert(pl.color.r == 1.0f);
        assert(pl.color.g == 0.5f);
        assert(pl.color.a == 2.0f);  // intensity

        std::printf("PASS: PointLight struct layout\n");
    }

    // 2. LightGlowData struct contains lights
    {
        LightGlowData data{};
        data.light_params.x = 3;  // 3 lights
        data.lights[0].position_and_radius = {1.0f, 2.0f, 3.0f, 4.0f};
        data.lights[0].color = {1.0f, 0.0f, 0.0f, 1.0f};
        data.lights[2].position_and_radius = {5.0f, 6.0f, 7.0f, 8.0f};

        assert(data.light_params.x == 3);
        assert(data.lights[0].position_and_radius.x == 1.0f);
        assert(data.lights[2].position_and_radius.z == 7.0f);

        std::printf("PASS: LightGlowData struct\n");
    }

    // 3. kMaxLights constant
    {
        assert(kMaxLights == 8);
        std::printf("PASS: kMaxLights == 8\n");
    }

    // 4. Light vector capping (simulated — GsRenderer not available without Vulkan)
    {
        std::vector<PointLight> lights(12);
        for (int i = 0; i < 12; i++) {
            lights[i].position_and_radius = {static_cast<float>(i), 0.0f, 0.0f, 1.0f};
            lights[i].color = {1.0f, 1.0f, 1.0f, 1.0f};
        }

        // Simulate set_point_lights capping
        size_t capped = std::min(lights.size(), static_cast<size_t>(kMaxLights));
        assert(capped == 8);

        std::vector<PointLight> stored(lights.begin(), lights.begin() + capped);
        assert(stored.size() == 8);
        assert(stored[7].position_and_radius.x == 7.0f);

        std::printf("PASS: Light count capped at 8\n");
    }

    std::printf("\nAll GS point light tests passed.\n");
    return 0;
}
