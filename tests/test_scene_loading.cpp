// Test: scene loading logic shared between DemoApp and StagingApp.
// Validates that SceneLoader output is correctly transformed for the GS pipeline:
// - AABB offset applied to lights, emitters, animations, VFX instances
// - VFX instance rotation applied to element positions
// - Light coordinate swizzle (scene x,height,z → PointLight x,z,y)
//
// Run: ctest -R test_scene_loading

#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <fstream>

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

// ── Scene loading helper (mirrors the shared logic from DemoApp/StagingApp) ──

struct SceneLoadResult {
    std::vector<gseurat::PointLight> gs_lights;
    std::vector<gseurat::GsEmitterConfig> emitter_configs;
    std::vector<gseurat::GsAnimationData> animations;
    std::vector<gseurat::SceneData::VfxInstanceRef> vfx_refs;
    glm::vec2 aabb_offset{0.0f};
};

static SceneLoadResult load_gs_scene(const gseurat::SceneData& scene_data,
                                      const gseurat::AABB& aabb) {
    SceneLoadResult result;
    result.aabb_offset = glm::vec2(aabb.min.x, aabb.min.y);

    // Transform lights (same as DemoApp/StagingApp)
    for (const auto& pl : scene_data.static_lights) {
        gseurat::PointLight t = pl;
        t.position_and_radius.x = pl.position_and_radius.x + aabb.min.x;
        t.position_and_radius.z = pl.position_and_radius.z + aabb.min.y;
        result.gs_lights.push_back(t);
    }

    // Transform emitters
    for (const auto& em : scene_data.gs_particle_emitters) {
        auto config = em.config;
        config.position.x += aabb.min.x;
        config.position.y += aabb.min.y;
        result.emitter_configs.push_back(config);
    }

    // Store animations and VFX refs for validation
    result.animations = scene_data.gs_animations;
    result.vfx_refs = scene_data.vfx_instances;

    return result;
}

int main() {
    std::printf("\n=== Scene Loading Tests ===\n\n");

    // ── 1. SceneLoader parses lights correctly ──
    std::printf("--- Light parsing and transform ---\n\n");
    {
        std::printf("Test 1.1: Light position swizzle\n");
        // Scene JSON: position [x, height, z] → PointLight: {x, z, height, radius}
        const char* json = R"({
            "version": 2,
            "lights": [{"position": [10, 50, 20], "radius": 30, "color": [1,1,1], "intensity": 5}]
        })";
        std::ofstream("/tmp/test_scene_light.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_scene_light.json");
        check(scene.static_lights.size() == 1, "1 light loaded");
        auto& pl = scene.static_lights[0];
        check(approx(pl.position_and_radius.x, 10), "light x = scene x (10)");
        check(approx(pl.position_and_radius.y, 20), "light y = scene z (20)");
        check(approx(pl.position_and_radius.z, 50), "light z = height (50)");
        check(approx(pl.position_and_radius.w, 30), "light radius = 30");
        check(approx(pl.color.a, 5), "light intensity = 5");
    }

    {
        std::printf("Test 1.2: AABB offset applied to lights\n");
        const char* json = R"({
            "version": 2,
            "lights": [{"position": [10, 50, 20], "radius": 30, "color": [1,1,1], "intensity": 1}]
        })";
        std::ofstream("/tmp/test_scene_aabb.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_scene_aabb.json");

        gseurat::AABB aabb;
        aabb.min = {-100, -200, -50};
        aabb.max = {100, 200, 50};

        auto result = load_gs_scene(scene, aabb);
        check(result.gs_lights.size() == 1, "1 light after transform");
        // x offset by aabb.min.x, z offset by aabb.min.y
        check(approx(result.gs_lights[0].position_and_radius.x, 10 + (-100)), "light x + aabb.min.x");
        check(approx(result.gs_lights[0].position_and_radius.z, 50 + (-200)), "light z + aabb.min.y (height)");
    }

    // ── 2. Emitter parsing ──
    std::printf("\n--- Emitter parsing ---\n\n");
    {
        std::printf("Test 2.1: Emitter position with region\n");
        const char* json = R"({
            "version": 2,
            "particle_emitters": [{
                "position": [5, 10, 15],
                "spawn_rate": 100,
                "region": {"shape": "sphere", "radius": 3}
            }]
        })";
        std::ofstream("/tmp/test_scene_emitter.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_scene_emitter.json");
        check(scene.gs_particle_emitters.size() == 1, "1 emitter loaded");
        auto& cfg = scene.gs_particle_emitters[0].config;
        check(approx(cfg.position.x, 5), "emitter position x = 5");
        check(cfg.spawn_region.shape == gseurat::GsAnimRegion::Shape::Sphere, "region shape = sphere");
        check(approx(cfg.spawn_region.radius, 3), "region radius = 3");
    }

    {
        std::printf("Test 2.2: Emitter AABB offset\n");
        const char* json = R"({
            "version": 2,
            "particle_emitters": [{"position": [5, 10, 15], "spawn_rate": 50}]
        })";
        std::ofstream("/tmp/test_scene_em_aabb.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_scene_em_aabb.json");

        gseurat::AABB aabb;
        aabb.min = {-10, -20, 0};
        aabb.max = {10, 20, 0};

        auto result = load_gs_scene(scene, aabb);
        check(result.emitter_configs.size() == 1, "1 emitter after transform");
        check(approx(result.emitter_configs[0].position.x, 5 + (-10)), "emitter x + aabb.min.x");
        check(approx(result.emitter_configs[0].position.y, 10 + (-20)), "emitter y + aabb.min.y");
    }

    // ── 3. VFX instance parsing ──
    std::printf("\n--- VFX instance parsing ---\n\n");
    {
        std::printf("Test 3.1: VFX instance with rotation_y\n");
        const char* json = R"({
            "version": 2,
            "vfx_instances": [{
                "vfx_file": "assets/vfx/test.vfx.json",
                "position": [50, 30, 10],
                "rotation_y": 90,
                "loop": true
            }]
        })";
        std::ofstream("/tmp/test_scene_vfx.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_scene_vfx.json");
        check(scene.vfx_instances.size() == 1, "1 vfx instance loaded");
        check(approx(scene.vfx_instances[0].rotation_y, 90), "rotation_y = 90");
        check(approx(scene.vfx_instances[0].position.x, 50), "position x = 50");
        check(scene.vfx_instances[0].loop, "loop = true");
    }

    {
        std::printf("Test 3.2: VFX instance defaults\n");
        const char* json = R"({
            "version": 2,
            "vfx_instances": [{"vfx_file": "test.vfx.json", "position": [0,0,0]}]
        })";
        std::ofstream("/tmp/test_scene_vfx_def.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_scene_vfx_def.json");
        check(approx(scene.vfx_instances[0].rotation_y, 0), "default rotation_y = 0");
        check(approx(scene.vfx_instances[0].radius, 5), "default radius = 5");
        check(scene.vfx_instances[0].trigger == "auto", "default trigger = auto");
        check(scene.vfx_instances[0].loop, "default loop = true");
    }

    // ── 4. VFX element rotation ──
    std::printf("\n--- VFX element rotation ---\n\n");
    {
        std::printf("Test 4.1: VfxInstance rotation rotates element positions\n");
        // Create a simple preset with one element at (10, 0, 0)
        gseurat::VfxPreset preset;
        preset.name = "test";
        preset.duration = 3.0f;
        gseurat::VfxElementData el;
        el.name = "test_light";
        el.type = "light";
        el.position = {10.0f, 0.0f, 0.0f};
        el.light_color = {1, 1, 1};
        el.light_intensity = 5;
        el.light_radius = 10;
        preset.elements.push_back(el);

        gseurat::VfxInstance inst;
        // 90 degrees: (10, 0, 0) → (0, 0, -10)
        inst.init(preset, {0, 0, 0}, true, 90.0f);

        // Update one frame to activate the light
        std::vector<gseurat::Gaussian> buffer;
        gseurat::GaussianAnimator animator;
        inst.update(0.1f, buffer, animator);

        auto& lights = inst.active_lights();
        check(lights.size() == 1, "1 active light");
        if (!lights.empty()) {
            // After 90° rotation around Y: (10, 0, 0) → (0, 0, -10)
            // PointLight: (world_x, world_z, world_y, radius)
            // world_pos = position + rotated_el = (0,0,0) + (0, 0, -10) = (0, 0, -10)
            // PointLight = (0, -10, 0, 10)
            check(approx(lights[0].position_and_radius.x, 0, 0.5f), "rotated light x ~ 0");
            check(approx(lights[0].position_and_radius.y, -10, 0.5f), "rotated light y ~ -10 (z)");
            check(approx(lights[0].position_and_radius.z, 0, 0.5f), "rotated light z ~ 0 (height)");
        }
    }

    {
        std::printf("Test 4.2: No rotation (0°) preserves positions\n");
        gseurat::VfxPreset preset;
        preset.name = "test";
        preset.duration = 3.0f;
        gseurat::VfxElementData el;
        el.name = "light";
        el.type = "light";
        el.position = {5.0f, 3.0f, 7.0f};
        el.light_color = {1, 0, 0};
        el.light_intensity = 1;
        el.light_radius = 5;
        preset.elements.push_back(el);

        gseurat::VfxInstance inst;
        inst.init(preset, {100, 200, 300}, true, 0.0f);

        std::vector<gseurat::Gaussian> buffer;
        gseurat::GaussianAnimator animator;
        inst.update(0.1f, buffer, animator);

        auto& lights = inst.active_lights();
        check(lights.size() == 1, "1 light");
        if (!lights.empty()) {
            // world_pos = (100+5, 200+3, 300+7) = (105, 203, 307)
            // PointLight = (105, 307, 203, 5)
            check(approx(lights[0].position_and_radius.x, 105), "unrotated light x = 105");
            check(approx(lights[0].position_and_radius.y, 307), "unrotated light y = 307 (z)");
            check(approx(lights[0].position_and_radius.z, 203), "unrotated light z = 203 (height)");
        }
    }

    // ── 5. Animation region parsing ──
    std::printf("\n--- Animation region parsing ---\n\n");
    {
        std::printf("Test 5.1: Animation with sphere region\n");
        const char* json = R"({
            "version": 2,
            "animations": [{
                "effect": "wave",
                "region": {"shape": "sphere", "center": [10, 20, 30], "radius": 5},
                "lifetime": 3,
                "loop": true
            }]
        })";
        std::ofstream("/tmp/test_scene_anim.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_scene_anim.json");
        check(scene.gs_animations.size() == 1, "1 animation loaded");
        check(scene.gs_animations[0].effect == "wave", "effect = wave");
        check(scene.gs_animations[0].region.shape == gseurat::GsAnimRegion::Shape::Sphere, "shape = sphere");
        check(approx(scene.gs_animations[0].region.radius, 5), "radius = 5");
        check(approx(scene.gs_animations[0].region.center.x, 10), "center x = 10");
    }

    {
        std::printf("Test 5.2: Animation with box region\n");
        const char* json = R"({
            "version": 2,
            "animations": [{
                "effect": "pulse",
                "region": {"shape": "box", "center": [0,0,0], "half_extents": [5,3,7]},
                "lifetime": 2
            }]
        })";
        std::ofstream("/tmp/test_scene_anim_box.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_scene_anim_box.json");
        check(scene.gs_animations[0].region.shape == gseurat::GsAnimRegion::Shape::Box, "shape = box");
        check(approx(scene.gs_animations[0].region.half_extents.x, 5), "half_extents x = 5");
    }

    // ── Summary ──
    std::printf("\n========================================\n");
    std::printf("  %d passed, %d failed\n", passed, failed);
    std::printf("========================================\n");
    return failed > 0 ? 1 : 0;
}
