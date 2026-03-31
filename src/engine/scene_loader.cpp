#include "gseurat/engine/scene_loader.hpp"

#include <fstream>
#include <stdexcept>

namespace gseurat {

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

    // Check version (v2 format expected)
    int version = j.value("version", 1);
    (void)version;  // Currently we only support v2 layout below

    // Gaussian splatting
    if (j.contains("gaussian_splat")) {
        const auto& gs = j["gaussian_splat"];
        GaussianSplatData gsd;
        gsd.ply_file = gs.value("ply_file", "");
        if (gs.contains("camera")) {
            const auto& cam = gs["camera"];
            if (cam.contains("position")) gsd.camera_position = parse_vec3(cam["position"]);
            if (cam.contains("target")) gsd.camera_target = parse_vec3(cam["target"]);
            gsd.camera_fov = cam.value("fov", 45.0f);
        }
        gsd.render_width = gs.value("render_width", 320u);
        gsd.render_height = gs.value("render_height", 240u);
        gsd.scale_multiplier = gs.value("scale_multiplier", 1.0f);
        gsd.background_image = gs.value("background_image", "");
        if (gs.contains("parallax")) {
            const auto& px = gs["parallax"];
            GsParallaxConfig pcfg;
            pcfg.azimuth_range = px.value("azimuth_range", 0.30f);
            pcfg.elevation_min = px.value("elevation_min", 0.35f);
            pcfg.elevation_max = px.value("elevation_max", 0.87f);
            pcfg.distance_range = px.value("distance_range", 0.20f);
            pcfg.parallax_strength = px.value("parallax_strength", 1.0f);
            gsd.parallax = pcfg;
        }
        data.gaussian_splat = std::move(gsd);
    }

    // Collision grid
    if (j.contains("collision")) {
        const auto& col = j["collision"];
        CollisionGrid grid;
        grid.width = col.value("width", 0u);
        grid.height = col.value("height", 0u);
        grid.cell_size = col.value("cell_size", 1.0f);
        size_t total = static_cast<size_t>(grid.width) * grid.height;
        if (col.contains("solid")) {
            const auto& solid_arr = col["solid"];
            grid.solid.resize(solid_arr.size(), false);
            for (size_t i = 0; i < solid_arr.size(); ++i) {
                grid.solid[i] = solid_arr[i].get<bool>();
            }
        } else {
            grid.solid.resize(total, false);
        }
        if (col.contains("elevation")) {
            const auto& elev_arr = col["elevation"];
            grid.elevation.resize(elev_arr.size(), 0.0f);
            for (size_t i = 0; i < elev_arr.size(); ++i) {
                grid.elevation[i] = elev_arr[i].get<float>();
            }
        } else {
            grid.elevation.resize(total, 0.0f);
        }
        if (col.contains("nav_zone")) {
            const auto& zone_arr = col["nav_zone"];
            grid.nav_zone.resize(zone_arr.size(), 0);
            for (size_t i = 0; i < zone_arr.size(); ++i) {
                grid.nav_zone[i] = zone_arr[i].get<uint8_t>();
            }
        } else {
            grid.nav_zone.resize(total, 0);
        }
        if (col.contains("light_probe")) {
            const auto& lp_arr = col["light_probe"];
            grid.light_probe.resize(lp_arr.size() / 3, glm::vec3(0.5f));
            for (size_t i = 0; i < grid.light_probe.size(); ++i) {
                grid.light_probe[i] = glm::vec3(
                    lp_arr[i * 3].get<float>(),
                    lp_arr[i * 3 + 1].get<float>(),
                    lp_arr[i * 3 + 2].get<float>());
            }
        } else {
            grid.light_probe.resize(total, glm::vec3(0.5f));
        }
        data.collision = std::move(grid);
    }

    // Navigation zone names
    if (j.contains("nav_zones")) {
        for (const auto& name : j["nav_zones"]) {
            data.nav_zone_names.push_back(name.get<std::string>());
        }
    }

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

    // Lights
    if (j.contains("lights")) {
        for (const auto& light_j : j["lights"]) {
            PointLight pl;
            auto pos = parse_vec3(light_j["position"]);
            float radius = light_j["radius"];
            // Internal format: {x, z, y(height), radius}
            pl.position_and_radius = {pos[0], pos[2], pos[1], radius};
            auto color = parse_vec4(light_j["color"]);
            float intensity = light_j.value("intensity", 1.0f);
            pl.color = {color.r, color.g, color.b, intensity};
            // Spot light: optional direction + cone_angle (degrees)
            if (light_j.contains("direction")) {
                auto dir = parse_vec3(light_j["direction"]);
                float len = glm::length(dir);
                if (len > 0.001f) dir /= len;  // normalize
                float cone_deg = light_j.value("cone_angle", 180.0f);
                float cone_cos = std::cos(glm::radians(cone_deg * 0.5f));
                pl.direction_and_cone = {dir.x, dir.y, dir.z, cone_cos};
            }
            // Area light: optional width/height/normal
            if (light_j.contains("area_width")) {
                float aw = light_j.value("area_width", 0.0f);
                float ah = light_j.value("area_height", 0.0f);
                float nx = 0.0f, nz = 0.0f;
                if (light_j.contains("area_normal")) {
                    auto an = light_j["area_normal"];
                    nx = an[0].get<float>();
                    nz = an[1].get<float>();
                }
                pl.area_params = {aw, ah, nx, nz};
            }
            data.static_lights.push_back(pl);
        }
    }

    // Torch emitter config + positions
    if (j.contains("torch_emitter")) {
        data.torch_emitter = parse_emitter(j["torch_emitter"]);
    }
    if (j.contains("torch_positions")) {
        for (const auto& p : j["torch_positions"]) {
            data.torch_positions.push_back(parse_vec3(p));
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
        data.player_character_id = p.value("character_id", "");
    }

    // Game objects (new format)
    if (j.contains("game_objects")) {
        for (const auto& go : j["game_objects"]) {
            GameObjectData obj;
            obj.id = go.value("id", "");
            obj.name = go.value("name", "");
            if (go.contains("position")) obj.position = parse_vec3(go["position"]);
            if (go.contains("rotation")) obj.rotation = parse_vec3(go["rotation"]);
            obj.scale = go.value("scale", 1.0f);
            obj.ply_file = go.value("ply_file", "");
            if (go.contains("components")) obj.components = go["components"];
            else obj.components = nlohmann::json::object();
            data.game_objects.push_back(std::move(obj));
        }
    }

    // Migrate legacy npcs[] → game_objects[]
    if (j.contains("npcs")) {
        for (const auto& npc_j : j["npcs"]) {
            GameObjectData go;
            go.id = "npc_" + npc_j.value("name", "unnamed");
            go.name = npc_j.value("name", "");
            if (npc_j.contains("position")) go.position = parse_vec3(npc_j["position"]);
            go.scale = 1.0f;
            go.components = nlohmann::json::object();
            if (npc_j.contains("facing")) {
                go.components["Facing"] = {{"direction", npc_j["facing"]}};
            }
            if (npc_j.contains("waypoints") && npc_j["waypoints"].is_array() && !npc_j["waypoints"].empty()) {
                go.components["Patrol"] = {
                    {"speed", npc_j.value("patrol_speed", 2.0f)},
                    {"waypoints", npc_j["waypoints"]},
                    {"pause", npc_j.value("waypoint_pause", 1.0f)}
                };
            }
            std::string char_id = npc_j.value("character_id", "");
            if (!char_id.empty()) {
                go.components["CharacterModel"] = {{"character_id", char_id}};
            }
            data.game_objects.push_back(std::move(go));
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
            layer.wall = layer_j.value("wall", false);
            layer.wall_y_offset = layer_j.value("wall_y_offset", 15.0f);
            data.background_layers.push_back(std::move(layer));
        }
    }

    // Portals
    if (j.contains("portals")) {
        for (const auto& portal_j : j["portals"]) {
            PortalData portal;
            portal.position = parse_vec3(portal_j["position"]);
            if (portal_j.contains("size")) portal.size = parse_vec2(portal_j["size"]);
            portal.target_scene = portal_j["target_scene"].get<std::string>();
            portal.spawn_position = parse_vec3(portal_j["spawn_position"]);
            if (portal_j.contains("spawn_facing"))
                portal.spawn_facing = parse_direction(portal_j["spawn_facing"]);
            data.portals.push_back(std::move(portal));
        }
    }

    // Migrate legacy objects[] → game_objects[]
    if (j.contains("objects")) {
        for (const auto& obj_j : j["objects"]) {
            GameObjectData go;
            go.id = obj_j.value("id", "");
            go.name = go.id;
            if (obj_j.contains("position")) go.position = parse_vec3(obj_j["position"]);
            if (obj_j.contains("rotation")) go.rotation = parse_vec3(obj_j["rotation"]);
            go.scale = obj_j.value("scale", 1.0f);
            go.ply_file = obj_j.value("ply_file", "");
            go.components = nlohmann::json::object();
            std::string manifest = obj_j.value("character_manifest", "");
            if (!manifest.empty()) {
                go.components["CharacterModel"] = {{"manifest", manifest}};
            }
            data.game_objects.push_back(std::move(go));
        }
    }

    // Gaussian particle emitters
    if (j.contains("particle_emitters")) {
        for (const auto& em_j : j["particle_emitters"]) {
            GsEmitterData em;
            em.preset = em_j.value("preset", "");
            em.config = parse_gs_emitter_config(em_j);
            // Scene emitters default to continuous (loop forever)
            if (!em_j.contains("burst_duration")) {
                em.config.burst_duration = 0.0f;
            }
            data.gs_particle_emitters.push_back(std::move(em));
        }
    }

    // Gaussian animations
    if (j.contains("animations")) {
        for (const auto& anim_j : j["animations"]) {
            data.gs_animations.push_back(parse_gs_animation(anim_j));
        }
    }

    // VFX instances (Méliès presets placed on map)
    if (j.contains("vfx_instances")) {
        for (const auto& vi : j["vfx_instances"]) {
            SceneData::VfxInstanceRef inst;
            inst.vfx_file = vi.value("vfx_file", "");
            if (vi.contains("position")) inst.position = parse_vec3(vi["position"]);
            inst.rotation_y = vi.value("rotation_y", 0.0f);
            inst.radius = vi.value("radius", 5.0f);
            inst.trigger = vi.value("trigger", "auto");
            inst.loop = vi.value("loop", true);
            data.vfx_instances.push_back(std::move(inst));
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

    // Day/night cycle
    if (j.contains("day_night")) {
        const auto& dn = j["day_night"];
        data.day_night.enabled = dn.value("enabled", false);
        data.day_night.cycle_speed = dn.value("cycle_speed", 0.02f);
        data.day_night.initial_time = dn.value("initial_time", 0.35f);
        if (dn.contains("keyframes")) {
            for (const auto& kf_j : dn["keyframes"]) {
                DayNightKeyframe kf;
                kf.time = kf_j["time"].get<float>();
                kf.ambient = parse_vec4(kf_j["ambient"]);
                kf.torch_intensity = kf_j.value("torch_intensity", 1.0f);
                data.day_night.keyframes.push_back(kf);
            }
        }
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

std::string SceneLoader::direction_to_string(Direction d) {
    switch (d) {
        case Direction::Up:    return "up";
        case Direction::Down:  return "down";
        case Direction::Left:  return "left";
        case Direction::Right: return "right";
    }
    return "down";
}

std::string SceneLoader::tile_to_string(ParticleTile t) {
    switch (t) {
        case ParticleTile::Circle:    return "Circle";
        case ParticleTile::SoftGlow:  return "SoftGlow";
        case ParticleTile::Spark:     return "Spark";
        case ParticleTile::SmokePuff: return "SmokePuff";
        case ParticleTile::Raindrop:  return "Raindrop";
        case ParticleTile::Snowflake: return "Snowflake";
    }
    return "Circle";
}

nlohmann::json SceneLoader::vec2_json(const glm::vec2& v) {
    return {v.x, v.y};
}

nlohmann::json SceneLoader::vec3_json(const glm::vec3& v) {
    return {v.x, v.y, v.z};
}

nlohmann::json SceneLoader::vec4_json(const glm::vec4& v) {
    return {v.x, v.y, v.z, v.w};
}

GsEmitterConfig SceneLoader::parse_gs_emitter_config(const nlohmann::json& j) {
    GsEmitterConfig cfg;

    // Start from preset if specified
    if (j.contains("preset")) {
        auto preset = gs_resolve_preset(j["preset"].get<std::string>());
        if (preset) cfg = *preset;
    }

    // Override individual fields (all optional)
    if (j.contains("spawn_rate"))       cfg.spawn_rate = j["spawn_rate"];
    if (j.contains("lifetime_min"))     cfg.lifetime_min = j["lifetime_min"];
    if (j.contains("lifetime_max"))     cfg.lifetime_max = j["lifetime_max"];
    if (j.contains("position"))         cfg.position = parse_vec3(j["position"]);
    if (j.contains("velocity_min"))     cfg.velocity_min = parse_vec3(j["velocity_min"]);
    if (j.contains("velocity_max"))     cfg.velocity_max = parse_vec3(j["velocity_max"]);
    if (j.contains("acceleration"))     cfg.acceleration = parse_vec3(j["acceleration"]);
    if (j.contains("color_start"))      cfg.color_start = parse_vec3(j["color_start"]);
    if (j.contains("color_end"))        cfg.color_end = parse_vec3(j["color_end"]);
    if (j.contains("scale_min"))        cfg.scale_min = parse_vec3(j["scale_min"]);
    if (j.contains("scale_max"))        cfg.scale_max = parse_vec3(j["scale_max"]);
    if (j.contains("scale_end_factor")) cfg.scale_end_factor = j["scale_end_factor"];
    if (j.contains("opacity_start"))    cfg.opacity_start = j["opacity_start"];
    if (j.contains("opacity_end"))      cfg.opacity_end = j["opacity_end"];
    if (j.contains("emission"))         cfg.emission = j["emission"];
    // Region-based spawn area (v2) or backward-compat spawn_offset (v1)
    if (j.contains("region")) {
        const auto& r = j["region"];
        std::string shape_str = r.value("shape", "box");
        cfg.spawn_region.shape = (shape_str == "sphere")
            ? GsAnimRegion::Shape::Sphere : GsAnimRegion::Shape::Box;
        if (r.contains("center")) cfg.spawn_region.center = parse_vec3(r["center"]);
        cfg.spawn_region.radius = r.value("radius", 0.0f);
        if (r.contains("half_extents")) cfg.spawn_region.half_extents = parse_vec3(r["half_extents"]);
    } else if (j.contains("spawn_offset_min") && j.contains("spawn_offset_max")) {
        // Backward compat: convert old offset min/max to box region
        auto omin = parse_vec3(j["spawn_offset_min"]);
        auto omax = parse_vec3(j["spawn_offset_max"]);
        cfg.spawn_region.shape = GsAnimRegion::Shape::Box;
        cfg.spawn_region.center = (omin + omax) * 0.5f;
        cfg.spawn_region.half_extents = (omax - omin) * 0.5f;
    }
    if (j.contains("burst_duration"))   cfg.burst_duration = j["burst_duration"];

    // Spline path (optional)
    if (j.contains("spline")) {
        const auto& s = j["spline"];
        SplineConfig sc;
        std::string mode_str = s.value("mode", "none");
        if (mode_str == "emitter_path") sc.mode = SplineMode::EmitterPath;
        else if (mode_str == "particle_path") sc.mode = SplineMode::ParticlePath;
        if (s.contains("control_points")) {
            for (const auto& pt : s["control_points"]) {
                sc.path.control_points.push_back(parse_vec3(pt));
            }
        }
        sc.emitter_speed = s.value("emitter_speed", 1.0f);
        sc.path_spread = s.value("path_spread", 0.0f);
        sc.align_to_tangent = s.value("align_to_tangent", false);
        if (sc.mode != SplineMode::None && sc.path.valid()) {
            cfg.spline = sc;
        }
    }

    return cfg;
}

nlohmann::json SceneLoader::gs_emitter_config_json(const GsEmitterData& em) {
    nlohmann::json j;
    if (!em.preset.empty()) j["preset"] = em.preset;
    const auto& c = em.config;
    j["position"] = vec3_json(c.position);
    j["spawn_rate"] = c.spawn_rate;
    j["lifetime_min"] = c.lifetime_min;
    j["lifetime_max"] = c.lifetime_max;
    j["velocity_min"] = vec3_json(c.velocity_min);
    j["velocity_max"] = vec3_json(c.velocity_max);
    j["acceleration"] = vec3_json(c.acceleration);
    j["color_start"] = vec3_json(c.color_start);
    j["color_end"] = vec3_json(c.color_end);
    j["scale_min"] = vec3_json(c.scale_min);
    j["scale_max"] = vec3_json(c.scale_max);
    j["scale_end_factor"] = c.scale_end_factor;
    j["opacity_start"] = c.opacity_start;
    j["opacity_end"] = c.opacity_end;
    j["emission"] = c.emission;
    // Write region instead of deprecated spawn_offset_min/max
    {
        nlohmann::json region;
        region["shape"] = (c.spawn_region.shape == GsAnimRegion::Shape::Sphere) ? "sphere" : "box";
        if (c.spawn_region.center != glm::vec3(0.0f)) region["center"] = vec3_json(c.spawn_region.center);
        if (c.spawn_region.shape == GsAnimRegion::Shape::Sphere) {
            region["radius"] = c.spawn_region.radius;
        } else {
            region["half_extents"] = vec3_json(c.spawn_region.half_extents);
        }
        j["region"] = region;
    }
    if (c.burst_duration > 0.0f) j["burst_duration"] = c.burst_duration;

    // Spline path
    if (c.spline && c.spline->mode != SplineMode::None && c.spline->path.valid()) {
        nlohmann::json spline;
        spline["mode"] = (c.spline->mode == SplineMode::EmitterPath) ? "emitter_path" : "particle_path";
        nlohmann::json pts = nlohmann::json::array();
        for (const auto& pt : c.spline->path.control_points) {
            pts.push_back(vec3_json(pt));
        }
        spline["control_points"] = pts;
        if (c.spline->emitter_speed != 1.0f) spline["emitter_speed"] = c.spline->emitter_speed;
        if (c.spline->path_spread > 0.0f) spline["path_spread"] = c.spline->path_spread;
        if (c.spline->align_to_tangent) spline["align_to_tangent"] = true;
        j["spline"] = spline;
    }

    return j;
}

GsAnimationData SceneLoader::parse_gs_animation(const nlohmann::json& j) {
    GsAnimationData anim;
    anim.effect = j.value("effect", "detach");
    anim.lifetime = j.value("lifetime", 3.0f);
    anim.loop = j.value("loop", false);

    if (j.contains("region")) {
        const auto& r = j["region"];
        std::string shape_str = r.value("shape", "sphere");
        anim.region.shape = (shape_str == "box")
            ? GsAnimRegion::Shape::Box : GsAnimRegion::Shape::Sphere;
        if (r.contains("center")) anim.region.center = parse_vec3(r["center"]);
        anim.region.radius = r.value("radius", 5.0f);
        if (r.contains("half_extents")) anim.region.half_extents = parse_vec3(r["half_extents"]);
    }

    if (j.contains("params")) {
        anim.params = parse_gs_anim_params(j["params"]);
    }

    // Optional reform config
    if (j.contains("reform")) {
        GsAnimReformConfig reform;
        const auto& r = j["reform"];
        reform.lifetime = r.value("lifetime", 2.0f);
        anim.reform = reform;
    }

    return anim;
}

GsAnimParams SceneLoader::parse_gs_anim_params(const nlohmann::json& p) {
    GsAnimParams params;
    auto parse_easing = [](const std::string& s) -> GsEasing {
        if (s == "in_quad"      || s == "ease_in")     return GsEasing::InQuad;
        if (s == "out_quad"     || s == "ease_out")    return GsEasing::OutQuad;
        if (s == "in_out_quad"  || s == "ease_in_out") return GsEasing::InOutQuad;
        if (s == "in_cubic")     return GsEasing::InCubic;
        if (s == "out_cubic")    return GsEasing::OutCubic;
        if (s == "in_out_cubic") return GsEasing::InOutCubic;
        if (s == "in_quart")     return GsEasing::InQuart;
        if (s == "out_quart")    return GsEasing::OutQuart;
        if (s == "in_out_quart") return GsEasing::InOutQuart;
        if (s == "in_quint")     return GsEasing::InQuint;
        if (s == "out_quint")    return GsEasing::OutQuint;
        if (s == "in_out_quint") return GsEasing::InOutQuint;
        if (s == "in_sine")      return GsEasing::InSine;
        if (s == "out_sine")     return GsEasing::OutSine;
        if (s == "in_out_sine")  return GsEasing::InOutSine;
        if (s == "in_expo")      return GsEasing::InExpo;
        if (s == "out_expo")     return GsEasing::OutExpo;
        if (s == "in_out_expo")  return GsEasing::InOutExpo;
        if (s == "in_circ")      return GsEasing::InCirc;
        if (s == "out_circ")     return GsEasing::OutCirc;
        if (s == "in_out_circ")  return GsEasing::InOutCirc;
        if (s == "in_back")      return GsEasing::InBack;
        if (s == "out_back")     return GsEasing::OutBack;
        if (s == "in_out_back")  return GsEasing::InOutBack;
        if (s == "in_elastic")      return GsEasing::InElastic;
        if (s == "out_elastic")     return GsEasing::OutElastic;
        if (s == "in_out_elastic")  return GsEasing::InOutElastic;
        if (s == "in_bounce")       return GsEasing::InBounce;
        if (s == "out_bounce")      return GsEasing::OutBounce;
        if (s == "in_out_bounce")   return GsEasing::InOutBounce;
        return GsEasing::Linear;
    };
    params.rotations = p.value("rotations", params.rotations);
    if (p.contains("rotations_easing")) params.rotations_easing = parse_easing(p["rotations_easing"]);
    params.expansion = p.value("expansion", params.expansion);
    if (p.contains("expansion_easing")) params.expansion_easing = parse_easing(p["expansion_easing"]);
    params.height_rise = p.value("height_rise", params.height_rise);
    if (p.contains("height_easing")) params.height_easing = parse_easing(p["height_easing"]);
    params.opacity_end = p.value("opacity_end", params.opacity_end);
    if (p.contains("opacity_easing")) params.opacity_easing = parse_easing(p["opacity_easing"]);
    params.scale_end = p.value("scale_end", params.scale_end);
    if (p.contains("scale_easing")) params.scale_easing = parse_easing(p["scale_easing"]);
    params.velocity = p.value("velocity", params.velocity);
    if (p.contains("gravity")) params.gravity = parse_vec3(p["gravity"]);
    params.noise = p.value("noise", params.noise);
    params.wave_speed = p.value("wave_speed", params.wave_speed);
    params.pulse_frequency = p.value("pulse_frequency", params.pulse_frequency);
    return params;
}

nlohmann::json SceneLoader::gs_animation_json(const GsAnimationData& anim) {
    nlohmann::json j;
    j["effect"] = anim.effect;
    j["lifetime"] = anim.lifetime;
    if (anim.loop) j["loop"] = true;

    nlohmann::json region;
    region["shape"] = (anim.region.shape == GsAnimRegion::Shape::Box) ? "box" : "sphere";
    region["center"] = vec3_json(anim.region.center);
    if (anim.region.shape == GsAnimRegion::Shape::Sphere) {
        region["radius"] = anim.region.radius;
    } else {
        region["half_extents"] = vec3_json(anim.region.half_extents);
    }
    j["region"] = region;

    // Only write params if any differ from defaults
    auto easing_str = [](GsEasing e) -> std::string {
        switch (e) {
            case GsEasing::InQuad:      return "in_quad";
            case GsEasing::OutQuad:     return "out_quad";
            case GsEasing::InOutQuad:   return "in_out_quad";
            case GsEasing::InCubic:     return "in_cubic";
            case GsEasing::OutCubic:    return "out_cubic";
            case GsEasing::InOutCubic:  return "in_out_cubic";
            case GsEasing::InQuart:     return "in_quart";
            case GsEasing::OutQuart:    return "out_quart";
            case GsEasing::InOutQuart:  return "in_out_quart";
            case GsEasing::InQuint:     return "in_quint";
            case GsEasing::OutQuint:    return "out_quint";
            case GsEasing::InOutQuint:  return "in_out_quint";
            case GsEasing::InSine:      return "in_sine";
            case GsEasing::OutSine:     return "out_sine";
            case GsEasing::InOutSine:   return "in_out_sine";
            case GsEasing::InExpo:      return "in_expo";
            case GsEasing::OutExpo:     return "out_expo";
            case GsEasing::InOutExpo:   return "in_out_expo";
            case GsEasing::InCirc:      return "in_circ";
            case GsEasing::OutCirc:     return "out_circ";
            case GsEasing::InOutCirc:   return "in_out_circ";
            case GsEasing::InBack:      return "in_back";
            case GsEasing::OutBack:     return "out_back";
            case GsEasing::InOutBack:   return "in_out_back";
            case GsEasing::InElastic:   return "in_elastic";
            case GsEasing::OutElastic:  return "out_elastic";
            case GsEasing::InOutElastic:return "in_out_elastic";
            case GsEasing::InBounce:    return "in_bounce";
            case GsEasing::OutBounce:   return "out_bounce";
            case GsEasing::InOutBounce: return "in_out_bounce";
            default:                    return "linear";
        }
    };
    const auto& p = anim.params;
    GsAnimParams def;
    nlohmann::json params;
    if (p.rotations != def.rotations) params["rotations"] = p.rotations;
    if (p.rotations_easing != def.rotations_easing) params["rotations_easing"] = easing_str(p.rotations_easing);
    if (p.expansion != def.expansion) params["expansion"] = p.expansion;
    if (p.expansion_easing != def.expansion_easing) params["expansion_easing"] = easing_str(p.expansion_easing);
    if (p.height_rise != def.height_rise) params["height_rise"] = p.height_rise;
    if (p.height_easing != def.height_easing) params["height_easing"] = easing_str(p.height_easing);
    if (p.opacity_end != def.opacity_end) params["opacity_end"] = p.opacity_end;
    if (p.opacity_easing != def.opacity_easing) params["opacity_easing"] = easing_str(p.opacity_easing);
    if (p.scale_end != def.scale_end) params["scale_end"] = p.scale_end;
    if (p.scale_easing != def.scale_easing) params["scale_easing"] = easing_str(p.scale_easing);
    if (p.velocity != def.velocity) params["velocity"] = p.velocity;
    if (p.gravity != def.gravity) params["gravity"] = vec3_json(p.gravity);
    if (p.noise != def.noise) params["noise"] = p.noise;
    if (p.wave_speed != def.wave_speed) params["wave_speed"] = p.wave_speed;
    if (p.pulse_frequency != def.pulse_frequency) params["pulse_frequency"] = p.pulse_frequency;
    if (!params.empty()) j["params"] = params;

    if (anim.reform) {
        nlohmann::json reform;
        reform["lifetime"] = anim.reform->lifetime;
        j["reform"] = reform;
    }

    return j;
}

nlohmann::json SceneLoader::emitter_json(const EmitterConfig& cfg) {
    nlohmann::json j;
    j["spawn_rate"] = cfg.spawn_rate;
    j["particle_lifetime_min"] = cfg.particle_lifetime_min;
    j["particle_lifetime_max"] = cfg.particle_lifetime_max;
    j["velocity_min"] = vec2_json(cfg.velocity_min);
    j["velocity_max"] = vec2_json(cfg.velocity_max);
    j["acceleration"] = vec2_json(cfg.acceleration);
    j["size_min"] = cfg.size_min;
    j["size_max"] = cfg.size_max;
    j["size_end_scale"] = cfg.size_end_scale;
    j["color_start"] = vec4_json(cfg.color_start);
    j["color_end"] = vec4_json(cfg.color_end);
    j["tile"] = tile_to_string(cfg.tile);
    j["z"] = cfg.z;
    j["spawn_offset_min"] = vec2_json(cfg.spawn_offset_min);
    j["spawn_offset_max"] = vec2_json(cfg.spawn_offset_max);
    return j;
}

nlohmann::json SceneLoader::to_json(const SceneData& data) {
    nlohmann::json j;
    j["version"] = 2;

    // Gaussian splatting
    if (data.gaussian_splat) {
        const auto& gs = *data.gaussian_splat;
        nlohmann::json gs_j;
        gs_j["ply_file"] = gs.ply_file;
        gs_j["camera"] = {
            {"position", vec3_json(gs.camera_position)},
            {"target", vec3_json(gs.camera_target)},
            {"fov", gs.camera_fov}
        };
        gs_j["render_width"] = gs.render_width;
        gs_j["render_height"] = gs.render_height;
        if (gs.scale_multiplier != 1.0f) {
            gs_j["scale_multiplier"] = gs.scale_multiplier;
        }
        if (!gs.background_image.empty()) {
            gs_j["background_image"] = gs.background_image;
        }
        if (gs.parallax) {
            const auto& px = *gs.parallax;
            gs_j["parallax"] = {
                {"azimuth_range", px.azimuth_range},
                {"elevation_min", px.elevation_min},
                {"elevation_max", px.elevation_max},
                {"distance_range", px.distance_range},
                {"parallax_strength", px.parallax_strength}
            };
        }
        j["gaussian_splat"] = gs_j;
    }

    // Collision grid
    if (data.collision) {
        const auto& grid = *data.collision;
        nlohmann::json col;
        col["width"] = grid.width;
        col["height"] = grid.height;
        col["cell_size"] = grid.cell_size;
        nlohmann::json solid_arr = nlohmann::json::array();
        for (bool s : grid.solid) solid_arr.push_back(s);
        col["solid"] = solid_arr;
        if (!grid.elevation.empty()) {
            nlohmann::json elev_arr = nlohmann::json::array();
            for (float e : grid.elevation) elev_arr.push_back(e);
            col["elevation"] = elev_arr;
        }
        if (!grid.nav_zone.empty()) {
            nlohmann::json zone_arr = nlohmann::json::array();
            for (uint8_t z : grid.nav_zone) zone_arr.push_back(z);
            col["nav_zone"] = zone_arr;
        }
        if (!grid.light_probe.empty()) {
            nlohmann::json lp_arr = nlohmann::json::array();
            for (const auto& lp : grid.light_probe) {
                lp_arr.push_back(lp.x);
                lp_arr.push_back(lp.y);
                lp_arr.push_back(lp.z);
            }
            col["light_probe"] = lp_arr;
        }
        j["collision"] = col;
    }

    // Tilemap
    {
        nlohmann::json tm;
        tm["tileset"] = {
            {"tile_width", data.tilemap.tileset.tile_width},
            {"tile_height", data.tilemap.tileset.tile_height},
            {"columns", data.tilemap.tileset.columns},
            {"sheet_width", data.tilemap.tileset.sheet_width},
            {"sheet_height", data.tilemap.tileset.sheet_height}
        };
        tm["width"] = data.tilemap.width;
        tm["height"] = data.tilemap.height;
        tm["tile_size"] = data.tilemap.tile_size;
        tm["z"] = data.tilemap.z;

        nlohmann::json tiles = nlohmann::json::array();
        for (auto t : data.tilemap.tiles) tiles.push_back(t);
        tm["tiles"] = tiles;

        if (!data.tile_animations.empty()) {
            nlohmann::json anims = nlohmann::json::array();
            for (const auto& def : data.tile_animations) {
                nlohmann::json anim_j;
                anim_j["base_tile"] = def.base_tile_id;
                nlohmann::json frames = nlohmann::json::array();
                for (auto f : def.frame_tile_ids) frames.push_back(f);
                anim_j["frames"] = frames;
                anim_j["frame_duration"] = def.frame_duration;
                anims.push_back(anim_j);
            }
            tm["tile_animations"] = anims;
        }

        j["tilemap"] = tm;
    }

    // Ambient color
    j["ambient_color"] = vec4_json(data.ambient_color);

    // Lights
    if (!data.static_lights.empty()) {
        nlohmann::json lights = nlohmann::json::array();
        for (const auto& pl : data.static_lights) {
            // Internal format: position_and_radius = {x, z, height, radius}
            // JSON v2 format: position = [x, height, z]
            nlohmann::json light_obj = {
                {"position", {pl.position_and_radius.x, pl.position_and_radius.z, pl.position_and_radius.y}},
                {"radius", pl.position_and_radius.w},
                {"color", {pl.color.r, pl.color.g, pl.color.b}},
                {"intensity", pl.color.a}
            };
            // Save spot light fields if not a point light (cone_cos == -1)
            float cone_cos = pl.direction_and_cone.w;
            if (cone_cos > -0.99f) {
                light_obj["direction"] = {
                    pl.direction_and_cone.x,
                    pl.direction_and_cone.y,
                    pl.direction_and_cone.z
                };
                float cone_deg = glm::degrees(std::acos(cone_cos)) * 2.0f;
                light_obj["cone_angle"] = cone_deg;
            }
            if (pl.area_params.x > 0.001f || pl.area_params.y > 0.001f) {
                light_obj["area_width"] = pl.area_params.x;
                light_obj["area_height"] = pl.area_params.y;
                if (std::abs(pl.area_params.z) > 0.001f || std::abs(pl.area_params.w) > 0.001f) {
                    light_obj["area_normal"] = {pl.area_params.z, pl.area_params.w};
                }
            }
            lights.push_back(light_obj);
        }
        j["lights"] = lights;
    }

    // Torch emitter + positions
    j["torch_emitter"] = emitter_json(data.torch_emitter);
    if (!data.torch_positions.empty()) {
        nlohmann::json positions = nlohmann::json::array();
        for (const auto& p : data.torch_positions) positions.push_back(vec3_json(p));
        j["torch_positions"] = positions;
    }
    if (!data.torch_audio_positions.empty()) {
        nlohmann::json positions = nlohmann::json::array();
        for (const auto& p : data.torch_audio_positions) positions.push_back(vec3_json(p));
        j["torch_audio_positions"] = positions;
    }

    // Footstep emitter
    j["footstep_emitter"] = emitter_json(data.footstep_emitter);

    // NPC aura emitter
    j["npc_aura_emitter"] = emitter_json(data.npc_aura_emitter);

    // Player
    {
        nlohmann::json p;
        p["position"] = vec3_json(data.player_position);
        p["tint"] = vec4_json(data.player_tint);
        p["facing"] = direction_to_string(data.player_facing);
        if (!data.player_character_id.empty())
            p["character_id"] = data.player_character_id;
        j["player"] = p;
    }

    // Game objects
    if (!data.game_objects.empty()) {
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& go : data.game_objects) {
            nlohmann::json obj;
            obj["id"] = go.id;
            obj["name"] = go.name;
            obj["position"] = vec3_json(go.position);
            obj["rotation"] = vec3_json(go.rotation);
            obj["scale"] = go.scale;
            if (!go.ply_file.empty()) obj["ply_file"] = go.ply_file;
            obj["components"] = go.components.is_null() ? nlohmann::json::object() : go.components;
            arr.push_back(obj);
        }
        j["game_objects"] = arr;
    }

    // Background parallax layers
    if (!data.background_layers.empty()) {
        nlohmann::json layers = nlohmann::json::array();
        for (const auto& layer : data.background_layers) {
            nlohmann::json layer_j;
            layer_j["texture"] = layer.texture_key;
            layer_j["z"] = layer.z;
            layer_j["parallax_factor"] = layer.parallax_factor;
            layer_j["quad_width"] = layer.quad_width;
            layer_j["quad_height"] = layer.quad_height;
            layer_j["uv_repeat_x"] = layer.uv_repeat_x;
            layer_j["uv_repeat_y"] = layer.uv_repeat_y;
            layer_j["tint"] = vec4_json(layer.tint);
            layer_j["wall"] = layer.wall;
            layer_j["wall_y_offset"] = layer.wall_y_offset;
            layers.push_back(layer_j);
        }
        j["background_layers"] = layers;
    }

    // Portals
    if (!data.portals.empty()) {
        nlohmann::json portals = nlohmann::json::array();
        for (const auto& portal : data.portals) {
            portals.push_back({
                {"position", vec3_json(portal.position)},
                {"size", vec2_json(portal.size)},
                {"target_scene", portal.target_scene},
                {"spawn_position", vec3_json(portal.spawn_position)},
                {"spawn_facing", direction_to_string(portal.spawn_facing)}
            });
        }
        j["portals"] = portals;
    }


    // Gaussian particle emitters
    if (!data.gs_particle_emitters.empty()) {
        nlohmann::json emitters = nlohmann::json::array();
        for (const auto& em : data.gs_particle_emitters) {
            emitters.push_back(gs_emitter_config_json(em));
        }
        j["particle_emitters"] = emitters;
    }

    // Gaussian animations
    if (!data.gs_animations.empty()) {
        nlohmann::json anims = nlohmann::json::array();
        for (const auto& anim : data.gs_animations) {
            anims.push_back(gs_animation_json(anim));
        }
        j["animations"] = anims;
    }

    // Navigation zone names
    if (!data.nav_zone_names.empty()) {
        j["nav_zones"] = data.nav_zone_names;
    }

    // Weather
    if (data.weather.enabled) {
        nlohmann::json w;
        w["enabled"] = true;
        w["type"] = data.weather.type;
        w["emitter"] = emitter_json(data.weather.emitter);
        w["ambient_override"] = vec4_json(data.weather.ambient_override);
        w["fog_density"] = data.weather.fog_density;
        w["fog_color"] = vec3_json(data.weather.fog_color);
        w["transition_speed"] = data.weather.transition_speed;
        j["weather"] = w;
    }

    // Day/night cycle
    if (data.day_night.enabled) {
        nlohmann::json dn;
        dn["enabled"] = true;
        dn["cycle_speed"] = data.day_night.cycle_speed;
        dn["initial_time"] = data.day_night.initial_time;
        if (!data.day_night.keyframes.empty()) {
            nlohmann::json kfs = nlohmann::json::array();
            for (const auto& kf : data.day_night.keyframes) {
                kfs.push_back({
                    {"time", kf.time},
                    {"ambient", vec4_json(kf.ambient)},
                    {"torch_intensity", kf.torch_intensity}
                });
            }
            dn["keyframes"] = kfs;
        }
        j["day_night"] = dn;
    }

    // Minimap
    if (data.minimap_config) {
        const auto& cfg = *data.minimap_config;
        j["minimap"] = {
            {"x", cfg.screen_x},
            {"y", cfg.screen_y},
            {"size", cfg.size},
            {"border", cfg.border},
            {"border_color", vec4_json(cfg.border_color)},
            {"bg_color", vec4_json(cfg.bg_color)}
        };
    }

    return j;
}

}  // namespace gseurat
