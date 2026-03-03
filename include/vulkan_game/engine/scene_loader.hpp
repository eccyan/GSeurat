#pragma once

#include "vulkan_game/engine/dialog.hpp"
#include "vulkan_game/engine/direction.hpp"
#include "vulkan_game/engine/particle.hpp"
#include "vulkan_game/engine/tilemap.hpp"
#include "vulkan_game/engine/types.hpp"

#include <glm/glm.hpp>
#include <nlohmann/json.hpp>

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
};

struct SceneData {
    TileLayer tilemap;
    glm::vec4 ambient_color{0.25f, 0.28f, 0.45f, 1.0f};
    std::vector<PointLight> static_lights;

    // Player
    glm::vec3 player_position{0.0f};
    glm::vec4 player_tint{1.0f};
    Direction player_facing = Direction::Down;

    // NPCs
    std::vector<NpcData> npcs;

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
