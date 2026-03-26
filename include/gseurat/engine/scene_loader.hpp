#pragma once

#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/day_night_system.hpp"
#include "gseurat/engine/dialog.hpp"
#include "gseurat/engine/direction.hpp"
#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/minimap.hpp"
#include "gseurat/engine/particle.hpp"
#include "gseurat/engine/tilemap.hpp"
#include "gseurat/engine/types.hpp"

#include <glm/glm.hpp>
#include <nlohmann/json.hpp>

#include <optional>
#include <string>
#include <vector>

namespace gseurat {

struct NpcData {
    std::string name;
    glm::vec3 position{0.0f};
    glm::vec4 tint{1.0f};
    Direction facing = Direction::Down;
    Direction reverse_facing = Direction::Up;
    float patrol_interval = 2.0f;
    float patrol_speed = 2.0f;
    DialogScript dialog;
    glm::vec4 light_color{1.0f};
    float light_radius = 3.0f;
    glm::vec4 aura_color_start{1.0f};
    glm::vec4 aura_color_end{0.0f};
    std::string script_module;  // empty = no script
    std::string script_class;
    std::vector<glm::vec2> waypoints;  // empty = use NpcPatrol
    float waypoint_pause = 1.0f;
    std::string character_id;  // empty = use hardcoded anim setup
};

struct ParallaxLayerData {
    std::string texture_key;
    float z = 5.0f;
    float parallax_factor = 0.0f;
    float quad_width = 40.0f;
    float quad_height = 25.0f;
    float uv_repeat_x = 1.0f;
    float uv_repeat_y = 1.0f;
    glm::vec4 tint{1.0f};
    bool wall = false;
    float wall_y_offset = 15.0f;
};

struct WeatherData {
    bool enabled = false;
    std::string type = "clear";
    EmitterConfig emitter;
    glm::vec4 ambient_override{0.2f, 0.22f, 0.35f, 1.0f};
    float fog_density = 0.0f;
    glm::vec3 fog_color{0.3f, 0.35f, 0.45f};
    float transition_speed = 1.0f;
};

struct GsParallaxConfig {
    float azimuth_range = 0.15f;       // ±radians horizontal shift (~±8.5°)
    float elevation_min = -0.15f;      // minimum elevation (slight down)
    float elevation_max = 0.15f;       // maximum elevation (slight up)
    float distance_range = 0.10f;      // ±fraction of home distance
    float parallax_strength = 1.0f;    // mapping multiplier (0 = disabled)
};

struct GaussianSplatData {
    std::string ply_file;
    glm::vec3 camera_position{0.0f, 5.0f, 10.0f};
    glm::vec3 camera_target{0.0f, 0.0f, 0.0f};
    float camera_fov = 45.0f;
    uint32_t render_width = 320;
    uint32_t render_height = 240;
    float scale_multiplier = 1.0f;   // Applied to Gaussian scales at load time
    std::optional<GsParallaxConfig> parallax;  // Shadow-box parallax camera config
    std::string background_image;  // Optional background behind GS (sky, mountains, etc.)
};

struct PlacedObjectData {
    std::string id;
    std::string ply_file;                    // path to PLY asset
    glm::vec3 position{0.0f};
    glm::vec3 rotation{0.0f};               // euler angles in degrees
    float scale = 1.0f;
    bool is_static = true;                   // static = merge into terrain cloud
    std::string character_manifest;          // if animated, path to Echidna manifest JSON
};

struct GsEmitterData {
    std::string preset;          // optional preset name ("dust_puff", "spark_shower", "magic_spiral")
    GsEmitterConfig config;      // full config (preset values overridden by explicit fields)
};

struct PortalData {
    glm::vec2 position{0.0f};
    glm::vec2 size{1.0f};
    std::string target_scene;
    glm::vec3 spawn_position{0.0f};
    Direction spawn_facing = Direction::Down;
};

struct SceneData {
    // Gaussian splatting (optional — when present, tilemap is optional)
    std::optional<GaussianSplatData> gaussian_splat;
    std::optional<CollisionGrid> collision;

    TileLayer tilemap;
    std::vector<TileAnimationDef> tile_animations;
    glm::vec4 ambient_color{0.25f, 0.28f, 0.45f, 1.0f};
    std::vector<PointLight> static_lights;
    std::vector<ParallaxLayerData> background_layers;
    WeatherData weather;

    // Player
    glm::vec3 player_position{0.0f};
    glm::vec4 player_tint{1.0f};
    Direction player_facing = Direction::Down;
    std::string player_character_id;  // empty = use hardcoded anim setup

    // NPCs
    std::vector<NpcData> npcs;

    // Portals
    std::vector<PortalData> portals;

    // Placed objects (terrain chunks, props, characters)
    std::vector<PlacedObjectData> placed_objects;

    // Gaussian particle emitters (continuous effects in the scene)
    std::vector<GsEmitterData> gs_particle_emitters;

    // Minimap
    std::optional<Minimap::Config> minimap_config;

    // Day/night cycle
    DayNightConfig day_night;

    // Emitter templates
    EmitterConfig torch_emitter;
    std::vector<glm::vec2> torch_positions;
    std::vector<glm::vec3> torch_audio_positions;
    EmitterConfig footstep_emitter;
    EmitterConfig npc_aura_emitter;

    // Navigation zone names (index 0 = "default", 1+ = named zones)
    std::vector<std::string> nav_zone_names;
};

class SceneLoader {
public:
    static SceneData load(const std::string& path);
    static SceneData from_json(const nlohmann::json& j);
    static nlohmann::json to_json(const SceneData& data);

    // Public parse helpers (used by control server commands)
    static EmitterConfig parse_emitter(const nlohmann::json& j);

private:
    static Direction parse_direction(const std::string& s);
    static ParticleTile parse_tile(const std::string& s);
    static glm::vec2 parse_vec2(const nlohmann::json& j);
    static glm::vec3 parse_vec3(const nlohmann::json& j);
    static glm::vec4 parse_vec4(const nlohmann::json& j);

    static std::string direction_to_string(Direction d);
    static std::string tile_to_string(ParticleTile t);
    static nlohmann::json vec2_json(const glm::vec2& v);
    static nlohmann::json vec3_json(const glm::vec3& v);
    static nlohmann::json vec4_json(const glm::vec4& v);
    static nlohmann::json emitter_json(const EmitterConfig& cfg);
    static GsEmitterConfig parse_gs_emitter_config(const nlohmann::json& j);
    static nlohmann::json gs_emitter_config_json(const GsEmitterData& em);
};

}  // namespace gseurat
