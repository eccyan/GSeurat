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

    // 5. Spot light: direction_and_cone defaults to point light
    {
        PointLight pl;
        pl.position_and_radius = {10.0f, 20.0f, 5.0f, 8.0f};
        pl.color = {1.0f, 1.0f, 1.0f, 1.0f};
        // Default: direction (0,-1,0), cone_cos -1 (point light)
        assert(pl.direction_and_cone.x == 0.0f);
        assert(pl.direction_and_cone.y == -1.0f);
        assert(pl.direction_and_cone.z == 0.0f);
        assert(pl.direction_and_cone.w == -1.0f);  // cos(180/2) = cos(90) ≈ 0, but -1 = sentinel

        std::printf("PASS: Spot light default = point light (cone_cos -1)\n");
    }

    // 6. Spot light: explicit direction and cone angle
    {
        PointLight pl;
        pl.position_and_radius = {0.0f, 0.0f, 10.0f, 20.0f};
        pl.color = {1.0f, 1.0f, 1.0f, 5.0f};
        // 45-degree cone, pointing straight down
        float cone_deg = 45.0f;
        float cone_cos = std::cos(cone_deg * 0.5f * 3.14159265f / 180.0f);
        pl.direction_and_cone = {0.0f, -1.0f, 0.0f, cone_cos};

        assert(pl.direction_and_cone.y == -1.0f);  // direction Y
        assert(pl.direction_and_cone.w > 0.9f);     // cos(22.5°) ≈ 0.924
        assert(pl.direction_and_cone.w < 1.0f);     // not exactly 1
        assert(pl.direction_and_cone.w > -0.99f);   // not a point light

        std::printf("PASS: Spot light 45° cone (cos=%.3f)\n", cone_cos);
    }

    // 7. Spot cone attenuation logic (mirrors shader)
    {
        // Simulate the shader's spot attenuation calculation
        auto spot_atten = [](float cos_angle, float cone_cos) -> float {
            if (cone_cos <= -0.99f) return 1.0f;  // point light
            float outer = cone_cos;
            float inner = std::min(outer + 0.1f, 1.0f);
            float denom = inner - outer;
            if (denom < 0.001f) denom = 0.001f;
            float a = (cos_angle - outer) / denom;
            return std::max(0.0f, std::min(1.0f, a));
        };

        // Point light (cone_cos = -1): always full
        assert(spot_atten(0.5f, -1.0f) == 1.0f);

        // 90° cone (cos(45°) ≈ 0.707): center of cone = full
        float cone_cos_90 = std::cos(45.0f * 3.14159265f / 180.0f);
        assert(spot_atten(1.0f, cone_cos_90) > 0.99f);  // dead center

        // Outside cone = 0
        assert(spot_atten(0.0f, cone_cos_90) == 0.0f);  // perpendicular
        assert(spot_atten(-0.5f, cone_cos_90) == 0.0f);  // behind

        // At cone edge
        float at_edge = spot_atten(cone_cos_90, cone_cos_90);
        assert(at_edge >= 0.0f && at_edge <= 0.01f);  // right at outer edge

        std::printf("PASS: Spot cone attenuation logic\n");
    }

    std::printf("\nAll GS point/spot light tests passed.\n");
    return 0;
}
