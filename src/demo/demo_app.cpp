#include "gseurat/demo/demo_app.hpp"
#include "gseurat/demo/gs_demo_state.hpp"
#include "gseurat/demo/island_demo_state.hpp"
#include "gseurat/demo/island_components.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/project_root.hpp"
#include <nlohmann/json.hpp>
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/gs_vfx.hpp"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <string_view>
#include <vector>

namespace gseurat {

void DemoApp::parse_args(int argc, char* argv[]) {
    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg == "--scene" && i + 1 < argc) {
            scene_path_ = argv[++i];
            scene_path_explicit_ = true;
        } else if (arg == "--viewer") {
            viewer_mode_ = true;
        }
    }
}

void DemoApp::run() {
    command_dispatcher_.register_default_commands();
    init_game_object_system();
    init_game_content();

    if (viewer_mode_) {
        std::string path = scene_path_explicit_ ? scene_path_ : resolve_asset_path("assets/scenes/gs_demo.json").string();
        scene_objects_.current_scene_path = path;
        state_stack_.push(std::make_unique<GsDemoState>(), *this);
    } else {
        auto state = std::make_unique<IslandDemoState>();
        if (scene_path_explicit_) state->set_scene_path(scene_path_);
        state_stack_.push(std::move(state), *this);
    }

    main_loop();
    cleanup();
}

void DemoApp::init_game_content() {
    init_window();

    // Font atlas with ASCII only (no locale needed for GS demo)
    std::vector<uint32_t> codepoints;
    for (uint32_t cp = 32; cp <= 126; cp++) codepoints.push_back(cp);
    font_atlas_.init(resolve_asset_path("assets/fonts/NotoSans-Regular.ttf").string(), 32.0f, codepoints);
    text_renderer_.init(font_atlas_);

    renderer_.init(window_, resources_);
    feature_flags_.apply_platform_defaults(renderer_.context().is_apple_gpu());
    renderer_.init_font(font_atlas_, resources_);
    renderer_.init_particles(resources_);
    renderer_.init_shadows(resources_);

    ui_ctx_.init(font_atlas_, text_renderer_);
    audio_.init(resolve_asset_path("assets").string());

    // Register demo-specific components (engine registers generic ones)
    component_registry_.register_component<PlayerController>("PlayerController",
        [](const nlohmann::json& j) -> PlayerController {
            PlayerController c;
            if (j.contains("speed")) c.speed = j["speed"].get<float>();
            if (j.contains("acceleration")) c.acceleration = j["acceleration"].get<float>();
            return c;
        },
        [](const PlayerController& c) -> nlohmann::json {
            return {{"speed", c.speed}, {"acceleration", c.acceleration}};
        });

    component_registry_.register_component<BurstEffect>("BurstEffect",
        [](const nlohmann::json& j) -> BurstEffect {
            BurstEffect c;
            if (j.contains("emitter_index")) c.emitter_index = j["emitter_index"].get<uint32_t>();
            return c;
        },
        [](const BurstEffect& c) -> nlohmann::json {
            return {{"emitter_index", c.emitter_index}};
        });

    component_registry_.register_component<ScatterEffect>("ScatterEffect",
        [](const nlohmann::json& j) -> ScatterEffect {
            ScatterEffect c;
            if (j.contains("radius")) c.radius = j["radius"].get<float>();
            if (j.contains("lifetime")) c.lifetime = j["lifetime"].get<float>();
            return c;
        },
        [](const ScatterEffect& c) -> nlohmann::json {
            return {{"radius", c.radius}, {"lifetime", c.lifetime}};
        });

    component_registry_.register_component<AnimationTrigger>("AnimationTrigger",
        [](const nlohmann::json& j) -> AnimationTrigger {
            AnimationTrigger c;
            if (j.contains("effect_name")) {
                auto name = j["effect_name"].get<std::string>();
                std::strncpy(c.effect_name, name.c_str(), sizeof(c.effect_name) - 1);
                c.effect_name[sizeof(c.effect_name) - 1] = '\0';
            }
            if (j.contains("anim_radius")) c.anim_radius = j["anim_radius"].get<float>();
            if (j.contains("lifetime")) c.lifetime = j["lifetime"].get<float>();
            if (j.contains("loop")) c.loop = j["loop"].get<bool>();
            return c;
        },
        [](const AnimationTrigger& c) -> nlohmann::json {
            return {{"effect_name", std::string(c.effect_name)},
                    {"anim_radius", c.anim_radius},
                    {"lifetime", c.lifetime},
                    {"loop", c.loop}};
        });

    component_registry_.register_component<DiscoveryZone>("DiscoveryZone",
        [](const nlohmann::json& j) -> DiscoveryZone {
            DiscoveryZone c;
            if (j.contains("color_r")) c.color_r = j["color_r"].get<float>();
            if (j.contains("color_g")) c.color_g = j["color_g"].get<float>();
            if (j.contains("color_b")) c.color_b = j["color_b"].get<float>();
            if (j.contains("burst_height")) c.burst_height = j["burst_height"].get<float>();
            return c;
        },
        [](const DiscoveryZone& c) -> nlohmann::json {
            return {{"color_r", c.color_r}, {"color_g", c.color_g},
                    {"color_b", c.color_b}, {"burst_height", c.burst_height}};
        });

    component_registry_.register_component<VfxTrigger>("VfxTrigger",
        [](const nlohmann::json& j) -> VfxTrigger {
            VfxTrigger c;
            if (j.contains("vfx_path")) {
                auto path = j["vfx_path"].get<std::string>();
                std::strncpy(c.vfx_path, path.c_str(), sizeof(c.vfx_path) - 1);
                c.vfx_path[sizeof(c.vfx_path) - 1] = '\0';
            }
            return c;
        },
        [](const VfxTrigger& c) -> nlohmann::json {
            return {{"vfx_path", std::string(c.vfx_path)}};
        });
}

void DemoApp::init_scene(const std::string& scene_path) {
    scene_objects_.current_scene_path = scene_path;
    auto scene_data = SceneLoader::load(scene_path);
    load_gs_scene(scene_data, { .add_default_light = true, .set_god_rays = true });
}

void DemoApp::clear_scene() {
    // Forward to AppBase to clear the ECS world + bone registry.
    // DemoApp itself has no additional global state to drop.
    AppBase::clear_scene();
}

void DemoApp::transition_scene(const std::string& target_scene,
                                const glm::vec3& target_position) {
    if (portal_handler_) {
        // Active GameState (IslandDemoState) owns the recovery work.
        portal_handler_(target_scene, target_position);
        return;
    }
    // No state-specific handler — generic transition.
    AppBase::transition_scene(target_scene, target_position);
}

}  // namespace gseurat
