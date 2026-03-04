#pragma once

#include "vulkan_game/engine/dialog.hpp"
#include "vulkan_game/engine/direction.hpp"
#include "vulkan_game/engine/minimap.hpp"
#include "vulkan_game/engine/particle.hpp"
#include "vulkan_game/engine/tilemap.hpp"
#include "vulkan_game/engine/types.hpp"

#include <glm/glm.hpp>
#include <nlohmann/json.hpp>

#include <optional>
#include <string>
#include <vector>

namespace vulkan_game {

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

struct PortalData {
    glm::vec2 position{0.0f};
    glm::vec2 size{1.0f};
    std::string target_scene;
    glm::vec3 spawn_position{0.0f};
    Direction spawn_facing = Direction::Down;
};

struct SceneData {
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

    // NPCs
    std::vector<NpcData> npcs;

    // Portals
    std::vector<PortalData> portals;

    // Minimap
    std::optional<Minimap::Config> minimap_config;

    // Emitter templates
    EmitterConfig torch_emitter;
    std::vector<glm::vec2> torch_positions;
    std::vector<glm::vec3> torch_audio_positions;
    EmitterConfig footstep_emitter;
    EmitterConfig npc_aura_emitter;
};

class SceneLoader {
public:
    static SceneData load(const std::string& path);
    static SceneData from_json(const nlohmann::json& j);

private:
    static Direction parse_direction(const std::string& s);
    static ParticleTile parse_tile(const std::string& s);
    static EmitterConfig parse_emitter(const nlohmann::json& j);
    static glm::vec2 parse_vec2(const nlohmann::json& j);
    static glm::vec3 parse_vec3(const nlohmann::json& j);
    static glm::vec4 parse_vec4(const nlohmann::json& j);
};

}  // namespace vulkan_game
