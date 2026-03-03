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
            // Tile 1 = wall = solid
            data.tilemap.solid[i] = (data.tilemap.tiles[i] == 1);
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
            pl.position_and_radius = {pos.x, pos.y, 0.0f, radius};
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
            data.npcs.push_back(std::move(npc));
        }
    }

    return data;
}

}  // namespace vulkan_game
