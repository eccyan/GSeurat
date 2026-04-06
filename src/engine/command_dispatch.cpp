#include "gseurat/engine/command_dispatch.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/demo/island_components.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <filesystem>
#include <fstream>

namespace gseurat {

void CommandDispatcher::register_command(std::string name, CommandHandler handler) {
    handlers_.emplace(std::move(name), std::move(handler));
}

void CommandDispatcher::dispatch(const nlohmann::json& cmd, nlohmann::json& response) {
    const auto cmd_name = cmd.value("cmd", "");
    auto it = handlers_.find(cmd_name);
    if (it == handlers_.end()) {
        response["type"] = "error";
        response["message"] = "Unknown command: " + cmd_name;
        return;
    }

    auto result = it->second(cmd);
    if (result) {
        response = std::move(*result);
    } else {
        response["type"] = "error";
        response["message"] = std::move(result.error());
    }
}

void CommandDispatcher::register_default_commands() {
    using json = nlohmann::json;
    auto ok = []() -> CommandResult { return json{{"type", "ok"}}; };

    register_command("get_features", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "features";
        response["features"] = json::array();
        auto add = [&](const char* name, bool enabled, const char* label) {
            response["features"].push_back({{"name", name}, {"enabled", enabled}, {"label", label}});
        };
        auto& f = app_.feature_flags();
        add("gs_rendering", f.gs_rendering, "GS Rendering");
        add("gs_chunk_culling", f.gs_chunk_culling, "Chunk Culling");
        add("gs_lod", f.gs_lod, "LOD");
        add("gs_adaptive_budget", f.gs_adaptive_budget, "Adaptive Budget");
        add("gs_parallax", f.gs_parallax, "Parallax");
        add("bloom", f.bloom, "Bloom");
        add("depth_of_field", f.depth_of_field, "Depth of Field");
        add("vignette", f.vignette, "Vignette");
        add("tone_mapping", f.tone_mapping, "Tone Mapping");
        add("fog", f.fog, "Fog");
        add("point_lights", f.point_lights, "Point Lights");
        add("particles", f.particles, "Particles");
        add("weather", f.weather, "Weather");
        add("screen_effects", f.screen_effects, "Screen Effects");
        add("music", f.music, "Music");
        add("sfx", f.sfx, "SFX");
        return response;
    });

    register_command("set_feature", [this, ok](const json& cmd) -> CommandResult {
        auto name = cmd.value("feature", "");
        bool enabled = cmd.value("enabled", false);
        auto& f = app_.feature_flags();
        if (name == "gs_rendering") f.gs_rendering = enabled;
        else if (name == "gs_chunk_culling") f.gs_chunk_culling = enabled;
        else if (name == "gs_lod") f.gs_lod = enabled;
        else if (name == "gs_adaptive_budget") f.gs_adaptive_budget = enabled;
        else if (name == "gs_parallax") f.gs_parallax = enabled;
        else if (name == "bloom") f.bloom = enabled;
        else if (name == "depth_of_field") f.depth_of_field = enabled;
        else if (name == "vignette") f.vignette = enabled;
        else if (name == "tone_mapping") f.tone_mapping = enabled;
        else if (name == "fog") f.fog = enabled;
        else if (name == "point_lights") f.point_lights = enabled;
        else if (name == "particles") f.particles = enabled;
        else if (name == "weather") f.weather = enabled;
        else if (name == "screen_effects") f.screen_effects = enabled;
        else if (name == "music") f.music = enabled;
        else if (name == "sfx") f.sfx = enabled;
        return ok();
    });

    register_command("get_render_params", [this](const json&) -> CommandResult {
        auto& pp = app_.renderer().post_process_params();
        auto& gs = app_.renderer().gs_renderer();
        return json{
            {"type", "render_params"},
            {"params", {
                {"bloom_threshold", pp.bloom_threshold},
                {"bloom_soft_knee", pp.bloom_soft_knee},
                {"bloom_intensity", pp.bloom_intensity},
                {"exposure", pp.exposure},
                {"vignette_radius", pp.vignette_radius},
                {"vignette_softness", pp.vignette_softness},
                {"dof_focus_distance", pp.dof_focus_distance},
                {"dof_focus_range", pp.dof_focus_range},
                {"dof_max_blur", pp.dof_max_blur},
                {"fog_density", pp.fog_density},
                {"fog_color_r", pp.fog_color_r},
                {"fog_color_g", pp.fog_color_g},
                {"fog_color_b", pp.fog_color_b},
                {"god_rays_intensity", app_.renderer().god_rays_intensity()},
                {"scale_multiplier", gs.scale_multiplier()},
                {"toon_bands", gs.toon_bands()},
                {"light_mode", gs.light_mode()},
                {"light_intensity", gs.light_intensity()},
                {"ground_color_r", app_.renderer().gs_bg_ground_color().r},
                {"ground_color_g", app_.renderer().gs_bg_ground_color().g},
                {"ground_color_b", app_.renderer().gs_bg_ground_color().b},
                {"sky_color_r", app_.renderer().gs_bg_sky_color().r},
                {"sky_color_g", app_.renderer().gs_bg_sky_color().g},
                {"sky_color_b", app_.renderer().gs_bg_sky_color().b},
                {"background_enabled", app_.renderer().gs_bg_colors_enabled() ? 1.0f : 0.0f},
            }},
        };
    });

    register_command("set_render_param", [this, ok](const json& cmd) -> CommandResult {
        auto name = cmd.value("name", "");
        float value = cmd.value("value", 0.0f);
        auto& pp = app_.renderer().post_process_params();
        auto& gs = app_.renderer().gs_renderer();
        if (name == "bloom_threshold") pp.bloom_threshold = value;
        else if (name == "bloom_soft_knee") pp.bloom_soft_knee = value;
        else if (name == "bloom_intensity") pp.bloom_intensity = value;
        else if (name == "exposure") pp.exposure = value;
        else if (name == "vignette_radius") pp.vignette_radius = value;
        else if (name == "vignette_softness") pp.vignette_softness = value;
        else if (name == "dof_focus_distance") pp.dof_focus_distance = value;
        else if (name == "dof_focus_range") pp.dof_focus_range = value;
        else if (name == "dof_max_blur") pp.dof_max_blur = value;
        else if (name == "fog_density") pp.fog_density = value;
        else if (name == "fog_color_r") pp.fog_color_r = value;
        else if (name == "fog_color_g") pp.fog_color_g = value;
        else if (name == "fog_color_b") pp.fog_color_b = value;
        else if (name == "god_rays_intensity") app_.renderer().set_god_rays_intensity(value);
        else if (name == "scale_multiplier") gs.set_scale_multiplier(value);
        else if (name == "toon_bands") gs.set_toon_bands(static_cast<int>(value));
        else if (name == "light_mode") gs.set_light_mode(static_cast<int>(value));
        else if (name == "light_intensity") gs.set_light_intensity(value);
        else if (name == "ground_color_r") {
            auto c = app_.renderer().gs_bg_ground_color(); c.r = value;
            app_.renderer().set_gs_background_colors(c, app_.renderer().gs_bg_sky_color());
        }
        else if (name == "ground_color_g") {
            auto c = app_.renderer().gs_bg_ground_color(); c.g = value;
            app_.renderer().set_gs_background_colors(c, app_.renderer().gs_bg_sky_color());
        }
        else if (name == "ground_color_b") {
            auto c = app_.renderer().gs_bg_ground_color(); c.b = value;
            app_.renderer().set_gs_background_colors(c, app_.renderer().gs_bg_sky_color());
        }
        else if (name == "sky_color_r") {
            auto c = app_.renderer().gs_bg_sky_color(); c.r = value;
            app_.renderer().set_gs_background_colors(app_.renderer().gs_bg_ground_color(), c);
        }
        else if (name == "sky_color_g") {
            auto c = app_.renderer().gs_bg_sky_color(); c.g = value;
            app_.renderer().set_gs_background_colors(app_.renderer().gs_bg_ground_color(), c);
        }
        else if (name == "sky_color_b") {
            auto c = app_.renderer().gs_bg_sky_color(); c.b = value;
            app_.renderer().set_gs_background_colors(app_.renderer().gs_bg_ground_color(), c);
        }
        return ok();
    });

    register_command("get_perf", [this](const json&) -> CommandResult {
        auto& gs = app_.renderer().gs_renderer();
        return json{
            {"type", "perf"},
            {"gaussian_count", gs.gaussian_count()},
            {"visible_count", gs.visible_count()},
            {"max_capacity", gs.max_gaussian_count()},
        };
    });

    register_command("set_ambient", [this, ok](const json& cmd) -> CommandResult {
        float r = cmd.value("r", 0.0f);
        float g = cmd.value("g", 0.0f);
        float b = cmd.value("b", 0.0f);
        float s = cmd.value("strength", 1.0f);
        app_.scene().set_ambient_color({r, g, b, s});
        return ok();
    });

    register_command("get_scene", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "scene";
        response["path"] = app_.current_scene_path();
        auto ac = app_.scene().ambient_color();
        response["ambient_r"] = ac.r;
        response["ambient_g"] = ac.g;
        response["ambient_b"] = ac.b;
        response["ambient_strength"] = ac.a;
        response["lights"] = json::array();
        for (const auto& l : app_.scene().lights()) {
            response["lights"].push_back({
                {"x", l.position_and_radius.x},
                {"y", l.position_and_radius.y},
                {"z", l.position_and_radius.z},
                {"radius", l.position_and_radius.w},
                {"r", l.color.r},
                {"g", l.color.g},
                {"b", l.color.b},
                {"intensity", l.color.a},
            });
        }
        return response;
    });

    register_command("reload_scene", [this, ok](const json&) -> CommandResult {
        app_.clear_scene();
        app_.init_scene(app_.current_scene_path());
        return ok();
    });

    register_command("write_temp_file", [](const json& cmd) -> CommandResult {
        auto path = cmd.value("path", "");
        auto content = cmd.value("content", "");
        if (path.empty() || content.empty())
            return std::unexpected(std::string("Missing 'path' or 'content'"));

        auto parent = std::filesystem::path(path).parent_path();
        if (!parent.empty())
            std::filesystem::create_directories(parent);

        std::ofstream ofs(path);
        if (!ofs.is_open())
            return std::unexpected("Failed to write file: " + path);

        ofs << content;
        return json{{"type", "ok"}};
    });

    register_command("load_scene_json", [this](const json& cmd) -> CommandResult {
        auto json_str = cmd.value("json", "");
        if (json_str.empty())
            return std::unexpected(std::string("Missing 'json' parameter"));

        try {
            std::string temp_path = "/tmp/gseurat_live_scene.json";
            std::ofstream ofs(temp_path);
            ofs << json_str;
            ofs.close();
            vkDeviceWaitIdle(app_.renderer().context().device());
            app_.clear_scene();
            app_.init_scene(temp_path);
            app_.set_current_scene_path(temp_path);
            return json{{"type", "ok"}};
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[load_scene_json] ERROR: %s\n", e.what());
            return std::unexpected(std::string("Failed to load scene: ") + e.what());
        }
    });

    register_command("update_scene_data", [this](const json& cmd) -> CommandResult {
        auto json_str = cmd.value("json", "");
        if (json_str.empty())
            return std::unexpected(std::string("Missing 'json' parameter"));

        try {
            std::string temp_path = "/tmp/gseurat_live_scene.json";
            std::ofstream ofs(temp_path);
            ofs << json_str;
            ofs.close();
            auto scene_data = SceneLoader::load(temp_path);

            const auto& aabb = app_.terrain_aabb();

            // Update ambient + lights
            app_.scene().clear_lights();
            app_.scene().set_ambient_color(scene_data.ambient_color);
            for (const auto& pl : scene_data.static_lights) {
                app_.scene().add_light(pl);
            }

            // Transform lights with AABB offset and push to GS renderer
            std::vector<PointLight> gs_lights;
            for (const auto& pl : scene_data.static_lights) {
                PointLight t = pl;
                t.position_and_radius.x += aabb.min.x;
                t.position_and_radius.z += aabb.min.y;
                gs_lights.push_back(t);
            }
            if (!gs_lights.empty()) {
                app_.renderer().gs_renderer().set_light_mode(2);
                app_.renderer().gs_renderer().set_point_lights(gs_lights);
                app_.renderer().set_gs_static_lights(gs_lights);
            } else {
                app_.renderer().gs_renderer().set_light_mode(0);
            }

            // Apply weather fog directly to scene (no WeatherSystem in Staging)
            app_.scene().set_fog_density(scene_data.weather.fog_density);
            app_.scene().set_fog_color(scene_data.weather.fog_color);

            // Rebuild emitters
            app_.renderer().clear_gs_particle_emitters();
            for (const auto& em : scene_data.gs_particle_emitters) {
                auto config = em.config;
                auto world_pos = coord::to_world(coord::GridPos(config.position), aabb);
                config.position = world_pos.vec();
                app_.renderer().add_gs_particle_emitter(config);
            }

            // Rebuild animations
            app_.renderer().clear_gs_animations();
            for (const auto& anim : scene_data.gs_animations) {
                auto region = anim.region;
                auto world_center = coord::to_world(coord::GridPos(region.center), aabb);
                region.center = world_center.vec();
                std::optional<Renderer::ReformConfig> reform;
                if (anim.reform) reform = Renderer::ReformConfig{anim.reform->lifetime};
                app_.renderer().add_gs_animation(anim.effect, region, anim.lifetime, anim.loop, anim.params, reform);
            }

            // Rebuild VFX instances
            app_.renderer().clear_vfx_instances();
            for (const auto& vi : scene_data.vfx_instances) {
                if (vi.trigger != "auto") continue;
                auto preset = load_vfx_preset(vi.vfx_file);
                if (preset.elements.empty()) continue;
                VfxInstance inst;
                auto world_pos = coord::to_world(vi.position, aabb);
                inst.init(preset, world_pos.vec(), vi.loop, vi.rotation_y);
                app_.renderer().add_vfx_instance(std::move(inst));
            }

            // Update stored game object data with world positions for gizmo rendering
            app_.scene_game_object_data_mutable() = scene_data.game_objects;

            std::vector<coord::WorldPos> world_positions;
            world_positions.reserve(scene_data.game_objects.size());
            for (const auto& go : scene_data.game_objects) {
                world_positions.push_back(coord::to_world(go.position, aabb));
            }

            for (size_t i = 0; i < scene_data.game_objects.size(); ++i) {
                const auto& go = scene_data.game_objects[i];
                if (go.components.empty() || go.components.is_null()) continue;
                auto entity = app_.world().create();
                app_.world().add<ecs::Transform>(entity, {world_positions[i], {go.scale, go.scale}});
                for (auto& [name, data] : go.components.items()) {
                    app_.component_registry().attach(app_.world(), entity, name, data);
                }
            }

            return json{{"type", "ok"}};
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[update_scene_data] ERROR: %s\n", e.what());
            return std::unexpected(std::string("Failed: ") + e.what());
        }
    });

    register_command("update_vfx_positions", [this](const json& cmd) -> CommandResult {
        if (!cmd.contains("vfx_instances"))
            return std::unexpected(std::string("Missing 'vfx_instances' array"));

        const auto& aabb = app_.terrain_aabb();
        auto& vfx = app_.renderer().vfx_instances_mutable();
        const auto& vi_arr = cmd["vfx_instances"];
        for (size_t i = 0; i < std::min(vfx.size(), vi_arr.size()); i++) {
            if (vi_arr[i].contains("position")) {
                auto pos = vi_arr[i]["position"];
                glm::vec3 new_pos{pos[0].get<float>(), pos[1].get<float>(), pos[2].get<float>()};
                auto world_pos = coord::to_world(coord::GridPos(new_pos), aabb);
                new_pos = world_pos.vec();
                auto preset = vfx[i].preset();
                vfx[i].init(preset, new_pos, true);
            }
        }
        return json{{"type", "ok"}};
    });

    register_command("open_scene", [this](const json& cmd) -> CommandResult {
        auto scene = cmd.value("scene", "");
        if (scene.empty())
            return std::unexpected(std::string("Missing 'scene' parameter"));

        app_.clear_scene();
        app_.init_scene(scene);
        app_.set_current_scene_path(scene);
        return json{{"type", "ok"}};
    });

    register_command("list_scenes", [](const json&) -> CommandResult {
        json response;
        response["type"] = "scenes";
        response["files"] = json::array();
        if (std::filesystem::exists("assets/scenes")) {
            for (const auto& entry : std::filesystem::directory_iterator("assets/scenes")) {
                if (entry.path().extension() == ".json") {
                    response["files"].push_back(entry.path().string());
                }
            }
        }
        return response;
    });

    register_command("screenshot", [this](const json& cmd) -> CommandResult {
        auto path = cmd.value("path", "staging_screenshot.png");
        app_.renderer().request_screenshot(path);
        return json{{"type", "ok"}, {"path", path}};
    });

    register_command("inject_key", [this](const json& cmd) -> CommandResult {
        int key = cmd.value("key", 0);
        bool down = cmd.value("down", true);
        if (key <= 0 || key >= kKeyCount)
            return std::unexpected(std::string("Invalid key code"));
        app_.input().inject_key(key, down);
        return json{{"type", "ok"}};
    });

    register_command("inject_key_once", [this](const json& cmd) -> CommandResult {
        int key = cmd.value("key", 0);
        if (key <= 0 || key >= kKeyCount)
            return std::unexpected(std::string("Invalid key code"));
        app_.input().inject_key_once(key);
        return json{{"type", "ok"}};
    });

    register_command("clear_keys", [this](const json&) -> CommandResult {
        app_.input().clear_injections();
        return json{{"type", "ok"}};
    });

    register_command("get_player_state", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "player_state";
        bool found = false;
        app_.world().view<ecs::Transform, PlayerController>().each(
            [&](ecs::Entity, ecs::Transform& t, PlayerController&) {
                response["position"] = {t.position.x(), t.position.y(), t.position.z()};
                found = true;
            });
        if (!found)
            response["position"] = nullptr;
        return response;
    });

    register_command("get_triggers", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "triggers";
        auto triggers = json::array();
        app_.world().view<ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity, ProximityTrigger& pt, ecs::Transform& t) {
                triggers.push_back({
                    {"x", t.position.x()},
                    {"y", t.position.y()},
                    {"z", t.position.z()},
                    {"radius", pt.radius},
                    {"triggered", pt.triggered},
                    {"one_shot", pt.one_shot},
                });
            });
        response["triggers"] = triggers;
        response["emitter_count"] = app_.renderer().gs_particle_emitters().size();
        return response;
    });

    register_command("quit", [this](const json&) -> CommandResult {
        glfwSetWindowShouldClose(app_.window(), GLFW_TRUE);
        return json{{"type", "ok"}, {"message", "Shutting down"}};
    });
}

}  // namespace gseurat
