#include "vulkan_game/engine/scene_loader.hpp"

#include <fstream>
#include <stdexcept>

namespace vulkan_game {

Direction SceneLoader::parse_direction(const std::string& s) {
    if (s == "up")    return Direction::Up;
    if (s == "down")  return Direction::Down;
    if (s == "left")  return Direction::Left;
    if (s == "right") return Direction::Right;
    return Direction::Down;
}

ParticleTile SceneLoader::parse_tile(const std::string& s) {
    if (s == "Circle")    return ParticleTile::Circle;
    if (s == "SoftGlow")  return ParticleTile::SoftGlow;
    if (s == "Spark")     return ParticleTile::Spark;
    if (s == "SmokePuff") return ParticleTile::SmokePuff;
    if (s == "Raindrop")  return ParticleTile::Raindrop;
    if (s == "Snowflake") return ParticleTile::Snowflake;
    return ParticleTile::Circle;
}

glm::vec2 SceneLoader::parse_vec2(const nlohmann::json& j) {
    return {j[0].get<float>(), j[1].get<float>()};
}

glm::vec3 SceneLoader::parse_vec3(const nlohmann::json& j) {
    return {j[0].get<float>(), j[1].get<float>(), j[2].get<float>()};
}

glm::vec4 SceneLoader::parse_vec4(const nlohmann::json& j) {
    if (j.size() == 3) return {j[0].get<float>(), j[1].get<float>(), j[2].get<float>(), 1.0f};
    return {j[0].get<float>(), j[1].get<float>(), j[2].get<float>(), j[3].get<float>()};
}

EmitterConfig SceneLoader::parse_emitter(const nlohmann::json& j) {
    EmitterConfig cfg;
    if (j.contains("spawn_rate"))            cfg.spawn_rate = j["spawn_rate"];
    if (j.contains("particle_lifetime_min")) cfg.particle_lifetime_min = j["particle_lifetime_min"];
    if (j.contains("particle_lifetime_max")) cfg.particle_lifetime_max = j["particle_lifetime_max"];
    if (j.contains("velocity_min"))          cfg.velocity_min = parse_vec2(j["velocity_min"]);
    if (j.contains("velocity_max"))          cfg.velocity_max = parse_vec2(j["velocity_max"]);
    if (j.contains("acceleration"))          cfg.acceleration = parse_vec2(j["acceleration"]);
    if (j.contains("size_min"))              cfg.size_min = j["size_min"];
    if (j.contains("size_max"))              cfg.size_max = j["size_max"];
    if (j.contains("size_end_scale"))        cfg.size_end_scale = j["size_end_scale"];
    if (j.contains("color_start"))           cfg.color_start = parse_vec4(j["color_start"]);
    if (j.contains("color_end"))             cfg.color_end = parse_vec4(j["color_end"]);
    if (j.contains("tile"))                  cfg.tile = parse_tile(j["tile"]);
    if (j.contains("z"))                     cfg.z = j["z"];
    if (j.contains("spawn_offset_min"))      cfg.spawn_offset_min = parse_vec2(j["spawn_offset_min"]);
    if (j.contains("spawn_offset_max"))      cfg.spawn_offset_max = parse_vec2(j["spawn_offset_max"]);
    return cfg;
}

SceneData SceneLoader::load(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open scene file: " + path);
    }
    nlohmann::json j = nlohmann::json::parse(file);
    return from_json(j);
}

SceneData SceneLoader::from_json(const nlohmann::json& j) {
    SceneData data;

    // Tilemap
    if (j.contains("tilemap")) {
        const auto& tm = j["tilemap"];
        const auto& ts = tm["tileset"];
        data.tilemap.tileset = Tileset{
            ts["tile_width"], ts["tile_height"], ts["columns"],
            ts["sheet_width"], ts["sheet_height"]
        };
        data.tilemap.width = tm["width"];
        data.tilemap.height = tm["height"];
        data.tilemap.tile_size = tm["tile_size"];
        data.tilemap.z = tm["z"];

        const auto& tiles = tm["tiles"];
        data.tilemap.tiles.resize(tiles.size());
        data.tilemap.solid.resize(tiles.size(), false);
        for (size_t i = 0; i < tiles.size(); i++) {
            data.tilemap.tiles[i] = tiles[i].get<uint16_t>();
            // Tile 1 = wall, tile 8 = wall torch = solid
            data.tilemap.solid[i] = (data.tilemap.tiles[i] == 1 || data.tilemap.tiles[i] == 8);
        }

        if (tm.contains("tile_animations")) {
            for (const auto& anim_j : tm["tile_animations"]) {
                TileAnimationDef def;
                def.base_tile_id = anim_j["base_tile"].get<uint16_t>();
                for (const auto& f : anim_j["frames"]) {
                    def.frame_tile_ids.push_back(f.get<uint16_t>());
                }
                def.frame_duration = anim_j["frame_duration"].get<float>();
                data.tile_animations.push_back(std::move(def));
            }
        }
    }

    // Ambient color
    if (j.contains("ambient_color")) {
        data.ambient_color = parse_vec4(j["ambient_color"]);
    }

    // Static lights
    if (j.contains("static_lights")) {
        for (const auto& light_j : j["static_lights"]) {
            PointLight pl;
            auto pos = parse_vec2(light_j["position"]);
            float radius = light_j["radius"];
            float height = light_j.value("height", 3.0f);
            pl.position_and_radius = {pos.x, pos.y, height, radius};
            auto color = parse_vec4(light_j["color"]);
            float intensity = light_j.value("intensity", 1.0f);
            pl.color = {color.r, color.g, color.b, intensity};
            data.static_lights.push_back(pl);
        }
    }

    // Torch emitter config + positions
    if (j.contains("torch_emitter")) {
        data.torch_emitter = parse_emitter(j["torch_emitter"]);
    }
    if (j.contains("torch_positions")) {
        for (const auto& p : j["torch_positions"]) {
            data.torch_positions.push_back(parse_vec2(p));
        }
    }
    if (j.contains("torch_audio_positions")) {
        for (const auto& p : j["torch_audio_positions"]) {
            data.torch_audio_positions.push_back(parse_vec3(p));
        }
    }

    // Footstep emitter
    if (j.contains("footstep_emitter")) {
        data.footstep_emitter = parse_emitter(j["footstep_emitter"]);
    }

    // NPC aura emitter template
    if (j.contains("npc_aura_emitter")) {
        data.npc_aura_emitter = parse_emitter(j["npc_aura_emitter"]);
    }

    // Player
    if (j.contains("player")) {
        const auto& p = j["player"];
        data.player_position = parse_vec3(p["position"]);
        if (p.contains("tint")) data.player_tint = parse_vec4(p["tint"]);
        if (p.contains("facing")) data.player_facing = parse_direction(p["facing"]);
    }

    // NPCs
    if (j.contains("npcs")) {
        for (const auto& npc_j : j["npcs"]) {
            NpcData npc;
            npc.name = npc_j.value("name", "");
            npc.position = parse_vec3(npc_j["position"]);
            if (npc_j.contains("tint")) npc.tint = parse_vec4(npc_j["tint"]);
            if (npc_j.contains("facing")) npc.facing = parse_direction(npc_j["facing"]);
            if (npc_j.contains("reverse_facing"))
                npc.reverse_facing = parse_direction(npc_j["reverse_facing"]);
            npc.patrol_interval = npc_j.value("patrol_interval", 2.0f);
            npc.patrol_speed = npc_j.value("patrol_speed", 2.0f);
            if (npc_j.contains("dialog")) {
                for (const auto& line_j : npc_j["dialog"]) {
                    npc.dialog.lines.push_back({
                        line_j["speaker_key"].get<std::string>(),
                        line_j["text_key"].get<std::string>()
                    });
                }
            }
            if (npc_j.contains("light_color")) npc.light_color = parse_vec4(npc_j["light_color"]);
            npc.light_radius = npc_j.value("light_radius", 3.0f);
            if (npc_j.contains("aura_color_start"))
                npc.aura_color_start = parse_vec4(npc_j["aura_color_start"]);
            if (npc_j.contains("aura_color_end"))
                npc.aura_color_end = parse_vec4(npc_j["aura_color_end"]);
            npc.script_module = npc_j.value("script_module", "");
            npc.script_class = npc_j.value("script_class", "");
            data.npcs.push_back(std::move(npc));
        }
    }

    // Background parallax layers
    if (j.contains("background_layers")) {
        for (const auto& layer_j : j["background_layers"]) {
            ParallaxLayerData layer;
            layer.texture_key = layer_j.value("texture", "");
            layer.z = layer_j.value("z", 5.0f);
            layer.parallax_factor = layer_j.value("parallax_factor", 0.0f);
            layer.quad_width = layer_j.value("quad_width", 40.0f);
            layer.quad_height = layer_j.value("quad_height", 25.0f);
            layer.uv_repeat_x = layer_j.value("uv_repeat_x", 1.0f);
            layer.uv_repeat_y = layer_j.value("uv_repeat_y", 1.0f);
            if (layer_j.contains("tint")) layer.tint = parse_vec4(layer_j["tint"]);
            data.background_layers.push_back(std::move(layer));
        }
    }

    // Portals
    if (j.contains("portals")) {
        for (const auto& portal_j : j["portals"]) {
            PortalData portal;
            portal.position = parse_vec2(portal_j["position"]);
            if (portal_j.contains("size")) portal.size = parse_vec2(portal_j["size"]);
            portal.target_scene = portal_j["target_scene"].get<std::string>();
            portal.spawn_position = parse_vec3(portal_j["spawn_position"]);
            if (portal_j.contains("spawn_facing"))
                portal.spawn_facing = parse_direction(portal_j["spawn_facing"]);
            data.portals.push_back(std::move(portal));
        }
    }

    // Weather
    if (j.contains("weather")) {
        const auto& w = j["weather"];
        data.weather.enabled = w.value("enabled", false);
        data.weather.type = w.value("type", "clear");
        if (w.contains("emitter")) data.weather.emitter = parse_emitter(w["emitter"]);
        if (w.contains("ambient_override")) data.weather.ambient_override = parse_vec4(w["ambient_override"]);
        data.weather.fog_density = w.value("fog_density", 0.0f);
        if (w.contains("fog_color")) {
            auto fc = parse_vec3(w["fog_color"]);
            data.weather.fog_color = fc;
        }
        data.weather.transition_speed = w.value("transition_speed", 1.0f);
    }

    // Minimap
    if (j.contains("minimap")) {
        const auto& m = j["minimap"];
        Minimap::Config cfg;
        cfg.screen_x = m.value("x", cfg.screen_x);
        cfg.screen_y = m.value("y", cfg.screen_y);
        cfg.size = m.value("size", cfg.size);
        cfg.border = m.value("border", cfg.border);
        if (m.contains("border_color")) cfg.border_color = parse_vec4(m["border_color"]);
        if (m.contains("bg_color")) cfg.bg_color = parse_vec4(m["bg_color"]);
        data.minimap_config = cfg;
    }

    return data;
}

}  // namespace vulkan_game
