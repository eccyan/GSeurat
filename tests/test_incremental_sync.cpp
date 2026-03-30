// Test: incremental scene sync logic.
// Validates that structural vs property-only changes are correctly detected,
// and that update_scene_data JSON format round-trips correctly.
//
// Run: ctest -R test_incremental_sync

#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <nlohmann/json.hpp>

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

// ── Structural change detection ──
// A "structural" change requires full reload (PLY re-upload):
//   - ply_file changed
//   - camera changed
//   - placed objects changed (add/remove/ply_file/transform)
//   - render resolution changed
// Everything else is a "property" change that can use update_scene_data.

struct SceneFingerprint {
    std::string ply_file;
    std::string camera_json;       // serialized camera block
    std::string objects_json;      // serialized placed objects
    uint32_t render_width = 0;
    uint32_t render_height = 0;

    bool operator==(const SceneFingerprint& o) const {
        return ply_file == o.ply_file &&
               camera_json == o.camera_json &&
               objects_json == o.objects_json &&
               render_width == o.render_width &&
               render_height == o.render_height;
    }
    bool operator!=(const SceneFingerprint& o) const { return !(*this == o); }
};

static SceneFingerprint fingerprint_from_json(const nlohmann::json& scene) {
    SceneFingerprint fp;
    if (scene.contains("gaussian_splat")) {
        const auto& gs = scene["gaussian_splat"];
        fp.ply_file = gs.value("ply_file", "");
        if (gs.contains("camera")) fp.camera_json = gs["camera"].dump();
        fp.render_width = gs.value("render_width", 320u);
        fp.render_height = gs.value("render_height", 240u);
    }
    if (scene.contains("objects")) {
        fp.objects_json = scene["objects"].dump();
    }
    return fp;
}

// ── Build update_scene_data payload from scene JSON ──
// Extracts only the lightweight parts (lights, emitters, animations, VFX).

static nlohmann::json build_update_payload(const nlohmann::json& scene) {
    nlohmann::json payload;
    payload["cmd"] = "update_scene_data";

    if (scene.contains("lights")) {
        payload["lights"] = scene["lights"];
    }
    if (scene.contains("particle_emitters")) {
        payload["emitters"] = scene["particle_emitters"];
    }
    if (scene.contains("animations")) {
        payload["animations"] = scene["animations"];
    }
    if (scene.contains("vfx_instances")) {
        payload["vfx_instances"] = scene["vfx_instances"];
    }
    if (scene.contains("ambient_color")) {
        payload["ambient_color"] = scene["ambient_color"];
    }
    return payload;
}

int main() {
    std::printf("\n=== Incremental Sync Tests ===\n\n");

    // ── 1. Fingerprint detection ──
    std::printf("--- Fingerprint: structural change detection ---\n\n");
    {
        std::printf("Test 1.1: Same scene = same fingerprint\n");
        nlohmann::json scene = {
            {"version", 2},
            {"gaussian_splat", {
                {"ply_file", "assets/maps/test.ply"},
                {"camera", {{"position", {0,50,100}}, {"target", {0,0,0}}, {"fov", 45}}},
                {"render_width", 320},
                {"render_height", 240}
            }},
            {"lights", {{{"position", {10,20,30}}, {"radius", 50}, {"color", {1,1,1}}, {"intensity", 5}}}}
        };
        auto fp1 = fingerprint_from_json(scene);
        auto fp2 = fingerprint_from_json(scene);
        check(fp1 == fp2, "identical scenes have same fingerprint");
    }

    {
        std::printf("Test 1.2: Light change = same fingerprint (property only)\n");
        nlohmann::json scene1 = {
            {"version", 2},
            {"gaussian_splat", {{"ply_file", "test.ply"}, {"camera", {{"position", {0,50,100}}}}}},
            {"lights", {{{"position", {10,20,30}}, {"radius", 50}}}}
        };
        nlohmann::json scene2 = scene1;
        scene2["lights"][0]["position"] = {99, 99, 99};
        scene2["lights"][0]["radius"] = 100;
        auto fp1 = fingerprint_from_json(scene1);
        auto fp2 = fingerprint_from_json(scene2);
        check(fp1 == fp2, "light position change = same fingerprint");
    }

    {
        std::printf("Test 1.3: PLY file change = different fingerprint (structural)\n");
        nlohmann::json scene1 = {
            {"version", 2},
            {"gaussian_splat", {{"ply_file", "map_v1.ply"}, {"camera", {{"position", {0,50,100}}}}}}
        };
        nlohmann::json scene2 = scene1;
        scene2["gaussian_splat"]["ply_file"] = "map_v2.ply";
        auto fp1 = fingerprint_from_json(scene1);
        auto fp2 = fingerprint_from_json(scene2);
        check(fp1 != fp2, "different ply_file = different fingerprint");
    }

    {
        std::printf("Test 1.4: Camera change = different fingerprint (structural)\n");
        nlohmann::json scene1 = {
            {"version", 2},
            {"gaussian_splat", {{"ply_file", "test.ply"}, {"camera", {{"position", {0,50,100}}}}}}
        };
        nlohmann::json scene2 = scene1;
        scene2["gaussian_splat"]["camera"]["position"] = {10, 60, 200};
        check(fingerprint_from_json(scene1) != fingerprint_from_json(scene2),
              "camera position change = different fingerprint");
    }

    {
        std::printf("Test 1.5: Object add = different fingerprint (structural)\n");
        nlohmann::json scene1 = {
            {"version", 2},
            {"gaussian_splat", {{"ply_file", "test.ply"}, {"camera", {{"position", {0,50,100}}}}}}
        };
        nlohmann::json scene2 = scene1;
        scene2["objects"] = {{{"id", "obj1"}, {"ply_file", "rock.ply"}, {"position", {1,2,3}}}};
        check(fingerprint_from_json(scene1) != fingerprint_from_json(scene2),
              "adding objects = different fingerprint");
    }

    {
        std::printf("Test 1.6: Emitter change = same fingerprint (property only)\n");
        nlohmann::json scene1 = {
            {"version", 2},
            {"gaussian_splat", {{"ply_file", "test.ply"}, {"camera", {{"position", {0,50,100}}}}}},
            {"particle_emitters", {{{"position", {5,10,15}}, {"spawn_rate", 100}}}}
        };
        nlohmann::json scene2 = scene1;
        scene2["particle_emitters"][0]["position"] = {99, 99, 99};
        check(fingerprint_from_json(scene1) == fingerprint_from_json(scene2),
              "emitter position change = same fingerprint");
    }

    {
        std::printf("Test 1.7: Animation change = same fingerprint (property only)\n");
        nlohmann::json scene1 = {
            {"version", 2},
            {"gaussian_splat", {{"ply_file", "test.ply"}, {"camera", {{"position", {0,50,100}}}}}},
            {"animations", {{{"effect", "wave"}, {"region", {{"shape", "sphere"}, {"center", {0,0,0}}, {"radius", 5}}}}}}
        };
        nlohmann::json scene2 = scene1;
        scene2["animations"][0]["region"]["radius"] = 20;
        check(fingerprint_from_json(scene1) == fingerprint_from_json(scene2),
              "animation region change = same fingerprint");
    }

    {
        std::printf("Test 1.8: VFX instance change = same fingerprint (property only)\n");
        nlohmann::json scene1 = {
            {"version", 2},
            {"gaussian_splat", {{"ply_file", "test.ply"}, {"camera", {{"position", {0,50,100}}}}}},
            {"vfx_instances", {{{"vfx_file", "torch.vfx.json"}, {"position", {10,0,10}}}}}
        };
        nlohmann::json scene2 = scene1;
        scene2["vfx_instances"][0]["position"] = {50, 0, 50};
        check(fingerprint_from_json(scene1) == fingerprint_from_json(scene2),
              "VFX position change = same fingerprint");
    }

    {
        std::printf("Test 1.9: Render resolution change = different fingerprint (structural)\n");
        nlohmann::json scene1 = {
            {"version", 2},
            {"gaussian_splat", {{"ply_file", "test.ply"}, {"render_width", 320}, {"render_height", 240}}}
        };
        nlohmann::json scene2 = scene1;
        scene2["gaussian_splat"]["render_width"] = 160;
        scene2["gaussian_splat"]["render_height"] = 120;
        check(fingerprint_from_json(scene1) != fingerprint_from_json(scene2),
              "resolution change = different fingerprint");
    }

    // ── 2. Update payload construction ──
    std::printf("\n--- Update payload construction ---\n\n");
    {
        std::printf("Test 2.1: Payload includes lights\n");
        nlohmann::json scene = {
            {"version", 2},
            {"lights", {{{"position", {10,20,30}}, {"radius", 50}, {"color", {1,0,0}}, {"intensity", 3}}}}
        };
        auto payload = build_update_payload(scene);
        check(payload.contains("lights"), "payload has lights");
        check(payload["lights"].size() == 1, "1 light in payload");
        check(approx(payload["lights"][0]["radius"].get<float>(), 50), "light radius = 50");
    }

    {
        std::printf("Test 2.2: Payload includes emitters\n");
        nlohmann::json scene = {
            {"version", 2},
            {"particle_emitters", {{{"position", {5,10,15}}, {"spawn_rate", 100}}}}
        };
        auto payload = build_update_payload(scene);
        check(payload.contains("emitters"), "payload has emitters");
        check(payload["emitters"].size() == 1, "1 emitter in payload");
    }

    {
        std::printf("Test 2.3: Payload includes animations\n");
        nlohmann::json scene = {
            {"version", 2},
            {"animations", {{{"effect", "wave"}, {"region", {{"shape", "sphere"}, {"radius", 5}}}}}}
        };
        auto payload = build_update_payload(scene);
        check(payload.contains("animations"), "payload has animations");
        check(payload["animations"][0]["effect"] == "wave", "animation effect = wave");
    }

    {
        std::printf("Test 2.4: Payload includes VFX instances\n");
        nlohmann::json scene = {
            {"version", 2},
            {"vfx_instances", {{{"vfx_file", "torch.vfx.json"}, {"position", {10,0,10}}, {"rotation_y", 90}}}}
        };
        auto payload = build_update_payload(scene);
        check(payload.contains("vfx_instances"), "payload has vfx_instances");
        check(approx(payload["vfx_instances"][0]["rotation_y"].get<float>(), 90), "rotation_y = 90");
    }

    {
        std::printf("Test 2.5: Payload includes ambient color\n");
        nlohmann::json scene = {
            {"version", 2},
            {"ambient_color", {0.1, 0.2, 0.3, 1.0}}
        };
        auto payload = build_update_payload(scene);
        check(payload.contains("ambient_color"), "payload has ambient_color");
    }

    {
        std::printf("Test 2.6: Empty scene = minimal payload\n");
        nlohmann::json scene = {{"version", 2}};
        auto payload = build_update_payload(scene);
        check(payload["cmd"] == "update_scene_data", "cmd = update_scene_data");
        check(!payload.contains("lights"), "no lights key");
        check(!payload.contains("emitters"), "no emitters key");
        check(!payload.contains("animations"), "no animations key");
        check(!payload.contains("vfx_instances"), "no vfx_instances key");
    }

    // ── 3. SceneLoader round-trip for update fields ──
    std::printf("\n--- SceneLoader round-trip for update fields ---\n\n");
    {
        std::printf("Test 3.1: Emitter properties parsed for update\n");
        const char* json = R"({
            "version": 2,
            "particle_emitters": [{
                "position": [5, 10, 15],
                "spawn_rate": 100,
                "color_start": [1, 0, 0, 1],
                "color_end": [0, 0, 1, 0.5],
                "emission": 2.0,
                "region": {"shape": "sphere", "radius": 3}
            }]
        })";
        std::ofstream("/tmp/test_inc_emitter.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_inc_emitter.json");
        check(scene.gs_particle_emitters.size() == 1, "1 emitter loaded");
        auto& cfg = scene.gs_particle_emitters[0].config;
        check(approx(cfg.position.x, 5), "emitter x = 5");
        check(approx(cfg.spawn_rate, 100), "spawn_rate = 100");
        check(approx(cfg.emission, 2.0f), "emission = 2.0");
        check(cfg.spawn_region.shape == gseurat::GsAnimRegion::Shape::Sphere, "region shape = sphere");
    }

    {
        std::printf("Test 3.2: Animation with params parsed for update\n");
        const char* json = R"({
            "version": 2,
            "animations": [{
                "effect": "pulse",
                "region": {"shape": "box", "center": [10, 20, 30], "half_extents": [5, 3, 7]},
                "lifetime": 2,
                "loop": true,
                "params": {"pulse_frequency": 8, "wave_speed": 10}
            }]
        })";
        std::ofstream("/tmp/test_inc_anim.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_inc_anim.json");
        check(scene.gs_animations.size() == 1, "1 animation loaded");
        check(scene.gs_animations[0].effect == "pulse", "effect = pulse");
        check(scene.gs_animations[0].loop, "loop = true");
        check(approx(scene.gs_animations[0].params.pulse_frequency, 8), "pulse_frequency = 8");
    }

    {
        std::printf("Test 3.3: Multiple lights parsed for update\n");
        const char* json = R"({
            "version": 2,
            "lights": [
                {"position": [10, 50, 20], "radius": 30, "color": [1,0,0], "intensity": 5},
                {"position": [40, 30, 60], "radius": 20, "color": [0,1,0], "intensity": 3}
            ]
        })";
        std::ofstream("/tmp/test_inc_lights.json") << json;
        auto scene = gseurat::SceneLoader::load("/tmp/test_inc_lights.json");
        check(scene.static_lights.size() == 2, "2 lights loaded");
        check(approx(scene.static_lights[0].color.a, 5), "light 0 intensity = 5");
        check(approx(scene.static_lights[1].color.a, 3), "light 1 intensity = 3");
    }

    // ── Summary ──
    std::printf("\n========================================\n");
    std::printf("  %d passed, %d failed\n", passed, failed);
    std::printf("========================================\n");
    return failed > 0 ? 1 : 0;
}
