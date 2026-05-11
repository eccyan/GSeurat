#include "gseurat/engine/camera_zone_system.hpp"
#include "gseurat/engine/collision/collision_system.hpp"
#include "gseurat/engine/command_dispatcher.hpp"
#include "gseurat/engine/component_registry.hpp"
#include "gseurat/engine/control_server.hpp"
#include "gseurat/engine/debug_dump.hpp"
#include "gseurat/engine/sim_clock.hpp"
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/ecs/components/collider_component.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/engine/ecs/ecs.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/input_manager.hpp"
#include "gseurat/engine/project_root.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/scene_object_state.hpp"
#include "gseurat/engine/vfx_events.hpp"
#include "gseurat/engine/world_manifest.hpp"
#include "gseurat/engine/trigger_components.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <chrono>
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
        auto& f = ctx_.feature_flags;
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
        const auto name = cmd.value("feature", "");
        const bool enabled = cmd.value("enabled", false);
        auto& f = ctx_.feature_flags;

        static const std::unordered_map<std::string, bool FeatureFlags::*> flag_map = {
            {"gs_rendering",       &FeatureFlags::gs_rendering},
            {"gs_chunk_culling",   &FeatureFlags::gs_chunk_culling},
            {"gs_lod",             &FeatureFlags::gs_lod},
            {"gs_adaptive_budget", &FeatureFlags::gs_adaptive_budget},
            {"gs_parallax",        &FeatureFlags::gs_parallax},
            {"bloom",              &FeatureFlags::bloom},
            {"depth_of_field",     &FeatureFlags::depth_of_field},
            {"vignette",           &FeatureFlags::vignette},
            {"tone_mapping",       &FeatureFlags::tone_mapping},
            {"fog",                &FeatureFlags::fog},
            {"point_lights",       &FeatureFlags::point_lights},
            {"particles",          &FeatureFlags::particles},
            {"weather",            &FeatureFlags::weather},
            {"screen_effects",     &FeatureFlags::screen_effects},
            {"music",              &FeatureFlags::music},
            {"sfx",                &FeatureFlags::sfx},
            {"debug_colliders",    &FeatureFlags::debug_colliders},
        };

        auto it = flag_map.find(name);
        if (it != flag_map.end()) {
            f.*(it->second) = enabled;
        }
        return ok();
    });

    register_command("get_render_params", [this](const json&) -> CommandResult {
        auto& pp = ctx_.renderer.post_process_params();
        auto& gs = ctx_.renderer.gs_renderer();
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
                {"god_rays_intensity", ctx_.renderer.god_rays_intensity()},
                {"scale_multiplier", gs.scale_multiplier()},
                {"toon_bands", gs.toon_bands()},
                {"light_mode", gs.light_mode()},
                {"light_intensity", gs.light_intensity()},
                {"ground_color_r", ctx_.renderer.gs_bg_ground_color().r},
                {"ground_color_g", ctx_.renderer.gs_bg_ground_color().g},
                {"ground_color_b", ctx_.renderer.gs_bg_ground_color().b},
                {"sky_color_r", ctx_.renderer.gs_bg_sky_color().r},
                {"sky_color_g", ctx_.renderer.gs_bg_sky_color().g},
                {"sky_color_b", ctx_.renderer.gs_bg_sky_color().b},
                {"background_enabled", ctx_.renderer.gs_bg_colors_enabled() ? 1.0f : 0.0f},
            }},
        };
    });

    register_command("set_render_param", [this, ok](const json& cmd) -> CommandResult {
        const auto name = cmd.value("name", "");
        const float value = cmd.value("value", 0.0f);
        auto& pp = ctx_.renderer.post_process_params();
        auto& gs = ctx_.renderer.gs_renderer();

        using Setter = std::function<void(float)>;
        const std::unordered_map<std::string, Setter> param_map = {
            // Post-process field assignments
            {"bloom_threshold",    [&](float v) { pp.bloom_threshold = v; }},
            {"bloom_soft_knee",    [&](float v) { pp.bloom_soft_knee = v; }},
            {"bloom_intensity",    [&](float v) { pp.bloom_intensity = v; }},
            {"exposure",           [&](float v) { pp.exposure = v; }},
            {"vignette_radius",    [&](float v) { pp.vignette_radius = v; }},
            {"vignette_softness",  [&](float v) { pp.vignette_softness = v; }},
            {"dof_focus_distance", [&](float v) { pp.dof_focus_distance = v; }},
            {"dof_focus_range",    [&](float v) { pp.dof_focus_range = v; }},
            {"dof_max_blur",       [&](float v) { pp.dof_max_blur = v; }},
            {"fog_density",        [&](float v) { pp.fog_density = v; }},
            {"fog_color_r",        [&](float v) { pp.fog_color_r = v; }},
            {"fog_color_g",        [&](float v) { pp.fog_color_g = v; }},
            {"fog_color_b",        [&](float v) { pp.fog_color_b = v; }},
            // Method calls
            {"god_rays_intensity", [&](float v) { ctx_.renderer.set_god_rays_intensity(v); }},
            {"scale_multiplier",   [&](float v) { gs.set_scale_multiplier(v); }},
            {"toon_bands",         [&](float v) { gs.set_toon_bands(static_cast<int>(v)); }},
            {"light_mode",         [&](float v) { gs.set_light_mode(static_cast<int>(v)); }},
            {"light_intensity",    [&](float v) { gs.set_light_intensity(v); }},
            // Ground color channels
            {"ground_color_r",     [&](float v) { auto c = ctx_.renderer.gs_bg_ground_color(); c.r = v; ctx_.renderer.set_gs_background_colors(c, ctx_.renderer.gs_bg_sky_color()); }},
            {"ground_color_g",     [&](float v) { auto c = ctx_.renderer.gs_bg_ground_color(); c.g = v; ctx_.renderer.set_gs_background_colors(c, ctx_.renderer.gs_bg_sky_color()); }},
            {"ground_color_b",     [&](float v) { auto c = ctx_.renderer.gs_bg_ground_color(); c.b = v; ctx_.renderer.set_gs_background_colors(c, ctx_.renderer.gs_bg_sky_color()); }},
            // Sky color channels
            {"sky_color_r",        [&](float v) { auto c = ctx_.renderer.gs_bg_sky_color(); c.r = v; ctx_.renderer.set_gs_background_colors(ctx_.renderer.gs_bg_ground_color(), c); }},
            {"sky_color_g",        [&](float v) { auto c = ctx_.renderer.gs_bg_sky_color(); c.g = v; ctx_.renderer.set_gs_background_colors(ctx_.renderer.gs_bg_ground_color(), c); }},
            {"sky_color_b",        [&](float v) { auto c = ctx_.renderer.gs_bg_sky_color(); c.b = v; ctx_.renderer.set_gs_background_colors(ctx_.renderer.gs_bg_ground_color(), c); }},
        };

        auto it = param_map.find(name);
        if (it != param_map.end()) {
            it->second(value);
        }
        return ok();
    });

    register_command("get_perf", [this](const json&) -> CommandResult {
        auto& gs = ctx_.renderer.gs_renderer();
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
        ctx_.scene.set_ambient_color({r, g, b, s});
        return ok();
    });

    register_command("get_scene", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "scene";
        response["path"] = ctx_.scene_objects.current_scene_path;
        auto ac = ctx_.scene.ambient_color();
        response["ambient_r"] = ac.r;
        response["ambient_g"] = ac.g;
        response["ambient_b"] = ac.b;
        response["ambient_strength"] = ac.a;
        response["lights"] = json::array();
        for (const auto& l : ctx_.scene.lights()) {
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
        ctx_.clear_scene();
        ctx_.init_scene(ctx_.scene_objects.current_scene_path);
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
            vkDeviceWaitIdle(ctx_.renderer.context().device());
            ctx_.clear_scene();
            ctx_.init_scene(temp_path);
            ctx_.scene_objects.current_scene_path = temp_path;
            return json{{"type", "ok"}};
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[load_scene_json] ERROR: %s\n", e.what());
            return std::unexpected(std::string("Failed to load scene: ") + e.what());
        }
    });

    register_command("load_character", [this, ok](const json& cmd) -> CommandResult {
        auto path = cmd.value("path", "");
        if (path.empty())
            return std::unexpected(std::string("Missing 'path' parameter"));
        if (ctx_.load_character) {
            try {
                ctx_.load_character(path);
            } catch (const std::exception& e) {
                return std::unexpected(std::string("Failed to load character: ") + e.what());
            }
        }
        return ok();
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

            const auto& aabb = ctx_.terrain.terrain_aabb;

            // Update ambient + lights
            ctx_.scene.clear_lights();
            ctx_.scene.set_ambient_color(scene_data.ambient_color);
            for (const auto& pl : scene_data.static_lights) {
                ctx_.scene.add_light(pl);
            }

            // Transform lights Grid→World via coord::to_world()
            std::vector<PointLight> gs_lights;
            for (const auto& pl : scene_data.static_lights) {
                PointLight t = pl;
                // Internal layout after parse: {json_x, json_z, json_y, radius}
                // Reconstruct original JSON [x, y, z] order for conversion:
                glm::vec3 grid_pos(t.position_and_radius.x,   // json_x
                                   t.position_and_radius.z,   // json_y (height)
                                   t.position_and_radius.y);  // json_z
                auto world = coord::to_world(coord::GridPos(grid_pos), aabb);
                // Re-swizzle back to internal layout: {world_x, world_z, world_y, radius}
                t.position_and_radius.x = world.vec().x;
                t.position_and_radius.y = world.vec().z;  // internal slot 1 = world Z
                t.position_and_radius.z = world.vec().y;  // internal slot 2 = world Y (height)
                gs_lights.push_back(t);
            }
            if (!gs_lights.empty()) {
                ctx_.renderer.gs_renderer().set_light_mode(2);
                ctx_.renderer.gs_renderer().set_point_lights(gs_lights);
                ctx_.renderer.set_gs_static_lights(gs_lights);
            } else {
                ctx_.renderer.gs_renderer().set_light_mode(0);
            }

            // Apply weather fog directly to scene (no WeatherSystem in Staging)
            ctx_.scene.set_fog_density(scene_data.weather.fog_density);
            ctx_.scene.set_fog_color(scene_data.weather.fog_color);

            // Rebuild emitters
            ctx_.renderer.clear_gs_particle_emitters();
            for (const auto& em : scene_data.gs_particle_emitters) {
                auto config = em.config;
                auto world_pos = coord::to_world(coord::GridPos(config.position), aabb);
                config.position = world_pos.vec();
                ctx_.renderer.add_gs_particle_emitter(config);
            }

            // Rebuild animations
            ctx_.renderer.clear_gs_animations();
            for (const auto& anim : scene_data.gs_animations) {
                auto region = anim.region;
                auto world_center = coord::to_world(coord::GridPos(region.center), aabb);
                region.center = world_center.vec();
                std::optional<Renderer::ReformConfig> reform;
                if (anim.reform) reform = Renderer::ReformConfig{anim.reform->lifetime};
                ctx_.renderer.add_gs_animation(anim.effect, region, anim.lifetime, anim.loop, anim.params, reform);
            }

            // Rebuild VFX instances. clear_vfx_instances() empties the
            // renderer's list synchronously; the new instances arrive via
            // VfxSpawnEvent → systems::VfxSystem during this same frame's
            // SystemScheduler::run_all (which runs after this command
            // dispatch completes, before render).
            ctx_.renderer.clear_vfx_instances();
            for (const auto& vi : scene_data.vfx_instances) {
                if (vi.trigger != "auto") continue;
                auto world_pos = coord::to_world(vi.position, aabb);
                ctx_.world.events<VfxSpawnEvent>().send({
                    .vfx_file = vi.vfx_file,
                    .position = world_pos.vec(),
                    .rotation_y = vi.rotation_y,
                    .loop = vi.loop,
                });
            }

            // Update stored game object data for gizmo rendering
            ctx_.scene_objects.game_objects = scene_data.game_objects;

            std::vector<coord::WorldPos> world_positions;
            world_positions.reserve(scene_data.game_objects.size());
            for (const auto& go : scene_data.game_objects) {
                world_positions.push_back(coord::to_world(go.position, aabb));
            }

            for (size_t i = 0; i < scene_data.game_objects.size(); ++i) {
                const auto& go = scene_data.game_objects[i];
                if (go.components.empty() || go.components.is_null()) continue;
                auto entity = ctx_.world.create();
                ctx_.world.add<ecs::Transform>(entity, {world_positions[i], {go.scale, go.scale}});
                for (auto& [name, data] : go.components.items()) {
                    ctx_.components.attach(ctx_.world, entity, name, data);
                }
            }

            // Notify staging_state that scene data has been updated
            ctx_.scene_objects.scene_data_version++;

            return json{{"type", "ok"}};
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[update_scene_data] ERROR: %s\n", e.what());
            return std::unexpected(std::string("Failed: ") + e.what());
        }
    });

    register_command("update_vfx_positions", [this](const json& cmd) -> CommandResult {
        if (!cmd.contains("vfx_instances"))
            return std::unexpected(std::string("Missing 'vfx_instances' array"));

        const auto& aabb = ctx_.terrain.terrain_aabb;
        auto& vfx = ctx_.renderer.vfx_instances_mutable();
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

        ctx_.clear_scene();
        ctx_.init_scene(scene);
        ctx_.scene_objects.current_scene_path = scene;
        return json{{"type", "ok"}};
    });

    register_command("list_scenes", [](const json&) -> CommandResult {
        json response;
        response["type"] = "scenes";
        response["files"] = json::array();
        auto scenes_dir = resolve_asset_path("assets/scenes");
        if (std::filesystem::exists(scenes_dir)) {
            for (const auto& entry : std::filesystem::directory_iterator(scenes_dir)) {
                if (entry.path().extension() == ".json") {
                    response["files"].push_back(entry.path().string());
                }
            }
        }
        return response;
    });

    register_command("screenshot", [this](const json& cmd) -> CommandResult {
        auto path = cmd.value("path", "staging_screenshot.png");
        ctx_.renderer.request_screenshot(path);
        return json{{"type", "ok"}, {"path", path}};
    });

    register_command("inject_key", [this](const json& cmd) -> CommandResult {
        int key = cmd.value("key", 0);
        bool down = cmd.value("down", true);
        if (key <= 0 || key >= kKeyCount)
            return std::unexpected(std::string("Invalid key code"));
        ctx_.input.inject_key(key, down);
        return json{{"type", "ok"}};
    });

    register_command("inject_key_once", [this](const json& cmd) -> CommandResult {
        int key = cmd.value("key", 0);
        if (key <= 0 || key >= kKeyCount)
            return std::unexpected(std::string("Invalid key code"));
        ctx_.input.inject_key_once(key);
        return json{{"type", "ok"}};
    });

    register_command("clear_keys", [this](const json&) -> CommandResult {
        ctx_.input.clear_injections();
        return json{{"type", "ok"}};
    });

    register_command("get_player_state", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "player_state";
        bool found = false;
        ctx_.world.view<ecs::Transform, PlayerTag>().each(
            [&](ecs::Entity, ecs::Transform& t, PlayerTag&) {
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
        ctx_.world.view<ProximityTrigger, ecs::Transform>().each(
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
        response["emitter_count"] = ctx_.renderer.gs_particle_emitters().size();
        return response;
    });

    register_command("get_game_objects", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "game_objects";

        // Scene-level game object data (only objects with components)
        auto objects = json::array();
        for (const auto& go : ctx_.scene_objects.game_objects) {
            if (go.components.empty() || go.components.is_null()) continue;
            json obj;
            obj["id"] = go.id;
            obj["name"] = go.name;
            obj["position"] = {
                go.position.x(), go.position.y(), go.position.z()
            };
            json comp_names = json::array();
            for (auto& [name, _] : go.components.items()) {
                comp_names.push_back(name);
            }
            obj["components"] = comp_names;
            objects.push_back(obj);
        }
        response["scene_objects"] = objects;

        // Live NPC positions from ECS
        auto npcs = json::array();
        ctx_.world.view<NpcWalker, ecs::Transform>().each(
            [&](ecs::Entity e, NpcWalker& npc, ecs::Transform& t) {
                npcs.push_back({
                    {"entity", e.id},
                    {"position", {t.position.x(), t.position.y(), t.position.z()}},
                    {"home", {npc.home_x, npc.home_z}},
                    {"target", {npc.target_x, npc.target_z}},
                    {"patrol_radius", npc.patrol_radius},
                    {"speed", npc.speed},
                    {"paused", npc.paused},
                });
            });
        response["live_npcs"] = npcs;

        return response;
    });

    register_command("set_project_root", [ok](const json& cmd) -> CommandResult {
        std::string p = cmd.value("path", "");
        set_project_root(p);
        std::fprintf(stderr, "[control_server] set_project_root: %s\n", p.c_str());
        return ok();
    });

    register_command("load_world_json", [this](const json& cmd) -> CommandResult {
        auto json_str = cmd.value("json", std::string{});
        if (json_str.empty()) {
            return std::unexpected(std::string("missing 'json' field"));
        }

        try {
            auto j = nlohmann::json::parse(json_str);
            auto manifest = WorldManifest::from_json(j);

            ctx_.renderer.gs_renderer().load_world(manifest);
            ctx_.scene_objects.world_manifest = manifest;

            return json{{"type", "ok"}, {"chunks", manifest.chunks.size()}};
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[load_world_json] ERROR: %s\n", e.what());
            return std::unexpected(std::string("Failed to parse world manifest: ") + e.what());
        }
    });

    register_command("reload_music_config", [this](const json& cmd) -> CommandResult {
        if (!ctx_.reload_music) {
            return std::unexpected(std::string("Audio engine not available"));
        }
        const std::string path = cmd.value("path", "");
        if (path.empty()) {
            return std::unexpected(std::string("Missing 'path' parameter"));
        }
        ctx_.reload_music(path);
        return json{{"type", "ok"}, {"message", "Music config reloaded: " + path}};
    });

    // ── On-demand self-reporting debug dump ──
    register_command("debug_dump", [this](const json& cmd) -> CommandResult {
        const std::string source = cmd.value("source", "staging");
        const std::string domain = cmd.value("domain", "");

        if (domain == "eyes") {
            return ctx_.debug_dump_registry.collect_domain(DebugDomain::Eyes);
        }
        if (domain == "ears") {
            return ctx_.debug_dump_registry.collect_domain(DebugDomain::Ears);
        }
        if (domain == "store") {
            return ctx_.debug_dump_registry.collect_domain(DebugDomain::Store);
        }
        return ctx_.debug_dump_registry.collect_all(source);
    });

    // ── Frame-determinism harness (Mode 1) ──
    // Triggers a hash-replay test: holds camera/PBD/animator/LOD frozen
    // and renders N frames, hashing the post-Onesweep tile_sort_a_
    // contents each frame. If the hashes differ across frames despite
    // identical inputs, the GS sort's input order is non-deterministic.
    register_command("start_determinism_test", [this](const json& cmd) -> CommandResult {
        const int frames = cmd.value("frames", 10);
        if (frames <= 0 || frames > 1000) {
            return std::unexpected(std::string("frames must be in (0, 1000]"));
        }
        ctx_.renderer.begin_determinism_test(frames);
        return json{{"type", "ok"}, {"frames", frames}};
    });

    register_command("get_determinism_test_result", [this](const json&) -> CommandResult {
        const auto& r = ctx_.renderer.determinism_test_result();
        const char* verdict_str = "idle";
        switch (r.verdict) {
            case Renderer::DeterminismVerdict::Idle:     verdict_str = "idle"; break;
            case Renderer::DeterminismVerdict::Running:  verdict_str = "running"; break;
            case Renderer::DeterminismVerdict::Stable:   verdict_str = "stable"; break;
            case Renderer::DeterminismVerdict::Unstable: verdict_str = "unstable"; break;
        }
        json hashes_arr = json::array();
        for (auto h : r.hashes) {
            char buf[32];
            std::snprintf(buf, sizeof(buf), "0x%016llx",
                          static_cast<unsigned long long>(h));
            hashes_arr.push_back(buf);
        }
        return json{
            {"type", "determinism_test_result"},
            {"verdict", verdict_str},
            {"total_frames", r.total_frames},
            {"captured_frames", r.captured_frames},
            {"unique_hashes", r.unique_hashes},
            {"live_entry_count", r.live_entry_count},
            {"hashes", hashes_arr},
        };
    });

    // ── Deterministic frame stepper ──
    // Enqueues N simulation frames to be processed by the main loop.
    // In deterministic mode (--deterministic flag) each queued frame advances
    // gs::SimClock by kFixedDt (1/60 s). In non-deterministic mode the main
    // loop simply runs N iterations at wall-clock pace.
    //
    // SYNCHRONOUS: response is deferred until all N frames have completed.
    // This makes screenshot/state queries that follow `step` see the post-step
    // engine state. Callers who want fire-and-forget should send `step` and
    // simply read the response when convenient — the response contract is
    // {"type":"ok","frames_completed":N} after the Nth frame renders.
    //
    // Only one synchronous step may be in flight at a time. If a second `step`
    // arrives while a deferred response is pending (deferred_step_response's
    // reply_target >= 0), it is rejected — callers must serialize step calls.
    register_command("step", [this](const json& cmd) -> CommandResult {
        const int n = cmd.value("n", 1);
        if (n <= 0 || n > 10000) {
            return std::unexpected(std::string("step: n must be in [1, 10000]"));
        }
        // P1: step is meaningful only when --deterministic gates the main
        // loop on pending_steps_. Outside deterministic mode the main loop
        // runs frames continuously regardless of pending_steps_, so the
        // deferred response would never fire and the caller would hang
        // forever waiting for {"frames_completed":N}.
        if (!gs::SimClock::is_deterministic()) {
            return std::unexpected(std::string(
                "step: requires --deterministic engine mode "
                "(otherwise the deferred response would never fire)"));
        }
        if (!ctx_.pending_steps || !ctx_.deferred_step_response ||
            !ctx_.control_server) {
            return std::unexpected(std::string(
                "step: control plane not wired up"));
        }
        if (ctx_.deferred_step_response->reply_target >= 0) {
            return std::unexpected(std::string(
                "step: a previous step is still in flight; serialize calls"));
        }
        ctx_.deferred_step_response->reply_target =
            ctx_.control_server->current_reply_target();
        ctx_.deferred_step_response->frames_total = n;
        // P2: preserve _bridge_id correlation from the request through to the
        // deferred completion response. Bridge clients route on _bridge_id
        // and treat unkeyed responses as broadcasts.
        if (cmd.contains("_bridge_id")) {
            ctx_.deferred_step_response->bridge_id = cmd["_bridge_id"];
        } else {
            ctx_.deferred_step_response->bridge_id = json(nullptr);
        }
        ctx_.deferred_step_response->per_frame_ms.clear();
        ctx_.deferred_step_response->per_frame_ms.reserve(static_cast<size_t>(n));
        // First stepped frame's duration is measured from command-issue time,
        // not from the previous frame: pre-step idle (in step_mode_) may be
        // unbounded while the loop spins waiting for `pending_steps_ > 0`.
        ctx_.deferred_step_response->last_step_frame_end =
            std::chrono::high_resolution_clock::now();
        ctx_.pending_steps->fetch_add(n, std::memory_order_relaxed);
        // Sentinel response — poll_control_server checks for "_deferred" key
        // and skips the immediate send.
        return json{{"_deferred", true}};
    });

    register_command("quit", [this](const json&) -> CommandResult {
        glfwSetWindowShouldClose(ctx_.window, GLFW_TRUE);
        return json{{"type", "ok"}, {"message", "Shutting down"}};
    });

    register_command("sync_camera", [this](const json& cmd) -> CommandResult {
        auto pos = cmd.value("position", std::vector<float>{0, 0, 0});
        auto tgt = cmd.value("target", std::vector<float>{0, 0, 0});

        if (pos.size() < 3 || tgt.size() < 3) {
            return std::unexpected(std::string("sync_camera requires position and target arrays of length 3"));
        }

        auto& cam = ctx_.renderer.camera();
        cam.set_position(glm::vec3(pos[0], pos[1], pos[2]));
        cam.set_target(glm::vec3(tgt[0], tgt[1], tgt[2]));
        ctx_.camera_sync_override = true;
        ctx_.camera_sync_source = cmd.value("source", std::string("engine"));

        return json{{"type", "ok"}};
    });

    register_command("set_cinematic_t", [this](const json& cmd) -> CommandResult {
        if (!ctx_.camera_zone_system) {
            return std::unexpected(std::string("camera_zone_system not available"));
        }
        if (cmd.contains("t")) {
            ctx_.camera_zone_system->set_cinematic_t(cmd["t"].get<float>());
        } else if (cmd.contains("delta_t")) {
            ctx_.camera_zone_system->advance_cinematic_t(cmd["delta_t"].get<float>());
        } else {
            return std::unexpected(std::string("set_cinematic_t requires 't' or 'delta_t' parameter"));
        }
        return json{{"type", "ok"}};
    });

    register_command("subscribe", [this](const json& cmd) -> CommandResult {
        if (!ctx_.control_server) {
            return std::unexpected(std::string("control_server not available"));
        }
        auto events = cmd.value("events", std::vector<std::string>{});
        ctx_.control_server->subscribe_events(events);
        return json{{"type", "ok"}, {"subscribed", events}};
    });

    register_command("unsubscribe", [this](const json&) -> CommandResult {
        if (!ctx_.control_server) {
            return std::unexpected(std::string("control_server not available"));
        }
        ctx_.control_server->unsubscribe_all();
        return json{{"type", "ok"}};
    });

    // --- Collider CRUD commands ---

    register_command("add_collider", [this, ok](const json& cmd) -> CommandResult {
        if (!ctx_.collision_system)
            return std::unexpected(std::string("collision_system not available"));

        std::string id = cmd.value("id", "");
        if (id.empty())
            return std::unexpected(std::string("missing 'id' field"));

        std::string name = cmd.value("name", id);

        // Parse position
        glm::vec3 pos{0.0f};
        if (cmd.contains("position") && cmd["position"].is_array()) {
            auto& p = cmd["position"];
            pos = glm::vec3(p[0].get<float>(), p[1].get<float>(), p[2].get<float>());
        }

        // Parse collider component from "collider" field
        ColliderComponent collider;
        if (cmd.contains("collider") && cmd["collider"].is_object()) {
            collider = collider_from_json(cmd["collider"]);
        }

        // Parse rotation as quaternion [x,y,z,w] and apply to collider's local_rotation
        if (cmd.contains("rotation") && cmd["rotation"].is_array()) {
            auto& r = cmd["rotation"];
            collider.local_rotation = glm::quat(
                r[3].get<float>(), r[0].get<float>(), r[1].get<float>(), r[2].get<float>());
        }

        // Create ECS entity
        auto entity = ctx_.world.create();
        ctx_.world.add<ecs::Transform>(entity,
            ecs::Transform{coord::WorldPos(pos), {1.0f, 1.0f}});
        ctx_.world.add<ColliderComponent>(entity, collider);

        // Store id→entity mapping for reliable lookup
        ctx_.scene_objects.collider_entity_map[id] = entity;

        // Store in scene_objects for ID tracking
        GameObjectData go_data;
        go_data.id = id;
        go_data.name = name;
        go_data.position = coord::GridPos(pos);
        go_data.components = cmd.contains("collider") ? json{{"ColliderComponent", cmd["collider"]}} : json::object();
        ctx_.scene_objects.game_objects.push_back(go_data);

        ctx_.collision_system->mark_dirty();

        json response = ok().value();
        response["id"] = id;
        return response;
    });

    register_command("update_collider", [this, ok](const json& cmd) -> CommandResult {
        if (!ctx_.collision_system)
            return std::unexpected(std::string("collision_system not available"));

        std::string id = cmd.value("id", "");
        if (id.empty())
            return std::unexpected(std::string("missing 'id' field"));

        // Look up entity by ID map
        auto entity_it = ctx_.scene_objects.collider_entity_map.find(id);
        if (entity_it == ctx_.scene_objects.collider_entity_map.end())
            return std::unexpected(std::string("entity not found for collider: " + id));
        ecs::Entity target_entity = entity_it->second;

        // Find the game object data for metadata updates
        auto& game_objects = ctx_.scene_objects.game_objects;
        auto go_it = std::find_if(game_objects.begin(), game_objects.end(),
            [&id](const GameObjectData& go) { return go.id == id; });

        // Update position
        if (cmd.contains("position") && cmd["position"].is_array()) {
            auto& p = cmd["position"];
            glm::vec3 new_pos(p[0].get<float>(), p[1].get<float>(), p[2].get<float>());
            ctx_.world.get<ecs::Transform>(target_entity).position = coord::WorldPos(new_pos);
            if (go_it != game_objects.end())
                go_it->position = coord::GridPos(new_pos);
        }

        // Update collider fields (partial)
        if (cmd.contains("collider") && cmd["collider"].is_object()) {
            auto& cc = ctx_.world.get<ColliderComponent>(target_entity);
            auto& cj = cmd["collider"];

            if (cj.contains("shape")) {
                // Re-parse the whole collider to get the new shape
                ColliderComponent updated = collider_from_json(cj);
                cc.shape = updated.shape;
            }
            if (cj.contains("is_trigger")) cc.is_trigger = cj["is_trigger"].get<bool>();
            if (cj.contains("is_dynamic")) cc.is_dynamic = cj["is_dynamic"].get<bool>();
            if (cj.contains("collision_mask")) cc.collision_mask = cj["collision_mask"].get<uint32_t>();
        }

        // Update rotation
        if (cmd.contains("rotation") && cmd["rotation"].is_array()) {
            auto& r = cmd["rotation"];
            auto& cc = ctx_.world.get<ColliderComponent>(target_entity);
            cc.local_rotation = glm::quat(
                r[3].get<float>(), r[0].get<float>(), r[1].get<float>(), r[2].get<float>());
        }

        ctx_.collision_system->mark_dirty();
        return ok();
    });

    register_command("remove_collider", [this, ok](const json& cmd) -> CommandResult {
        if (!ctx_.collision_system)
            return std::unexpected(std::string("collision_system not available"));

        std::string id = cmd.value("id", "");
        if (id.empty())
            return std::unexpected(std::string("missing 'id' field"));

        // Look up and destroy ECS entity by ID map
        auto entity_it = ctx_.scene_objects.collider_entity_map.find(id);
        if (entity_it != ctx_.scene_objects.collider_entity_map.end()) {
            ctx_.world.destroy(entity_it->second);
            ctx_.scene_objects.collider_entity_map.erase(entity_it);
        }

        // Remove from game_objects list
        auto& game_objects = ctx_.scene_objects.game_objects;
        auto go_it = std::find_if(game_objects.begin(), game_objects.end(),
            [&id](const GameObjectData& go) { return go.id == id; });
        if (go_it != game_objects.end())
            game_objects.erase(go_it);

        ctx_.collision_system->mark_dirty();
        return ok();
    });

    register_command("list_colliders", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "ok";

        auto colliders = json::array();
        for (const auto& [id, entity] : ctx_.scene_objects.collider_entity_map) {
            if (!ctx_.world.has<ecs::Transform>(entity) ||
                !ctx_.world.has<ColliderComponent>(entity))
                continue;

            auto& t = ctx_.world.get<ecs::Transform>(entity);
            auto& cc = ctx_.world.get<ColliderComponent>(entity);
            glm::vec3 pos = t.position.vec();

            // Find matching game object for name
            std::string name = id;
            for (const auto& go : ctx_.scene_objects.game_objects) {
                if (go.id == id) {
                    name = go.name;
                    break;
                }
            }

            json entry;
            entry["id"] = id;
            entry["name"] = name;
            entry["position"] = {pos.x, pos.y, pos.z};
            entry["rotation"] = {cc.local_rotation.x, cc.local_rotation.y,
                                  cc.local_rotation.z, cc.local_rotation.w};
            entry["collider"] = collider_to_json(cc);
            colliders.push_back(entry);
        }

        response["colliders"] = colliders;
        return response;
    });
}

}  // namespace gseurat
