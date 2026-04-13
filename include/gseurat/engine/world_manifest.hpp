#pragma once

#include <glm/glm.hpp>
#include <nlohmann/json_fwd.hpp>
#include <string>
#include <utility>
#include <vector>

namespace gseurat {

struct WorldChunk {
    glm::ivec3 grid{0};
    std::string ply_file;
    std::string scene_file;  // empty if not set
};

struct StreamingVolume {
    std::string id;
    std::string shape{"box"};  // "box" or "sphere"
    glm::vec3 position{0.0f};
    glm::vec3 half_extents{8.0f};
    float radius{8.0f};
    std::vector<std::string> preload_target_ids;

    bool contains(const glm::vec3& point) const;
};

struct WorldPortal {
    std::string id;
    glm::vec3 position{0.0f};
    std::string region_shape{"sphere"};
    float region_radius{2.0f};
    glm::vec3 region_half_extents{1.0f};
    std::string target_instance_id;
    glm::vec3 spawn_position{0.0f};
    std::string spawn_facing;
};

struct WorldInstance {
    std::string id;
    std::string display_name;
    std::string scene_file;
};

struct WorldManifest {
    int version{1};
    glm::vec3 grid_cell_size{64.0f, 32.0f, 64.0f};
    std::vector<WorldChunk> chunks;
    std::vector<StreamingVolume> streaming_volumes;
    std::vector<WorldPortal> portals;
    std::vector<WorldInstance> instances;

    std::pair<glm::vec3, glm::vec3> chunk_aabb(size_t index) const;

    static WorldManifest from_json(const nlohmann::json& j);
    static nlohmann::json to_json(const WorldManifest& m);
};

}  // namespace gseurat
