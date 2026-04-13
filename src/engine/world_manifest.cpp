#include "gseurat/engine/world_manifest.hpp"

#include <glm/glm.hpp>
#include <nlohmann/json.hpp>
#include <string>

namespace gseurat {

bool StreamingVolume::contains(const glm::vec3& point) const {
    if (shape == "sphere") {
        float dist2 = glm::dot(point - position, point - position);
        return dist2 <= radius * radius;
    }
    // box
    glm::vec3 d = glm::abs(point - position);
    return d.x <= half_extents.x && d.y <= half_extents.y && d.z <= half_extents.z;
}

std::pair<glm::vec3, glm::vec3> WorldManifest::chunk_aabb(size_t index) const {
    const auto& g = chunks[index].grid;
    glm::vec3 mn(
        static_cast<float>(g.x) * grid_cell_size.x,
        static_cast<float>(g.y) * grid_cell_size.y,
        static_cast<float>(g.z) * grid_cell_size.z);
    return {mn, mn + grid_cell_size};
}

static glm::vec3 parse_vec3(const nlohmann::json& j) {
    return glm::vec3(j[0].get<float>(), j[1].get<float>(), j[2].get<float>());
}

static glm::ivec3 parse_ivec3(const nlohmann::json& j) {
    return glm::ivec3(j[0].get<int>(), j[1].get<int>(), j[2].get<int>());
}

static nlohmann::json vec3_to_json(const glm::vec3& v) {
    return nlohmann::json::array({v.x, v.y, v.z});
}

static nlohmann::json ivec3_to_json(const glm::ivec3& v) {
    return nlohmann::json::array({v.x, v.y, v.z});
}

WorldManifest WorldManifest::from_json(const nlohmann::json& j) {
    WorldManifest m;
    m.version = j.value("version", 1);
    m.grid_cell_size = parse_vec3(j.at("grid_cell_size"));

    for (const auto& cj : j.at("chunks")) {
        WorldChunk c;
        c.grid = parse_ivec3(cj.at("grid"));
        c.ply_file = cj.at("ply_file").get<std::string>();
        if (c.ply_file.find("..") != std::string::npos) {
            throw std::runtime_error("path traversal rejected in ply_file: " + c.ply_file);
        }
        if (cj.contains("scene_file")) {
            c.scene_file = cj["scene_file"].get<std::string>();
            if (c.scene_file.find("..") != std::string::npos) {
                throw std::runtime_error("path traversal rejected in scene_file: " + c.scene_file);
            }
        }
        m.chunks.push_back(std::move(c));
    }

    if (j.contains("streaming_volumes")) {
        for (const auto& vj : j["streaming_volumes"]) {
            StreamingVolume v;
            v.id = vj.at("id").get<std::string>();
            v.shape = vj.at("shape").get<std::string>();
            v.position = parse_vec3(vj.at("position"));
            if (vj.contains("half_extents")) v.half_extents = parse_vec3(vj["half_extents"]);
            if (vj.contains("radius")) v.radius = vj["radius"].get<float>();
            for (const auto& tid : vj.at("preload_target_ids")) {
                v.preload_target_ids.push_back(tid.get<std::string>());
            }
            m.streaming_volumes.push_back(std::move(v));
        }
    }

    if (j.contains("portals")) {
        for (const auto& pj : j["portals"]) {
            WorldPortal p;
            p.id = pj.at("id").get<std::string>();
            p.position = parse_vec3(pj.at("position"));
            p.region_shape = pj.value("region_shape", std::string{"sphere"});
            if (pj.contains("region_radius")) p.region_radius = pj["region_radius"].get<float>();
            if (pj.contains("region_half_extents")) p.region_half_extents = parse_vec3(pj["region_half_extents"]);
            p.target_instance_id = pj.at("target_instance_id").get<std::string>();
            if (pj.contains("spawn_position")) p.spawn_position = parse_vec3(pj["spawn_position"]);
            p.spawn_facing = pj.value("spawn_facing", std::string{});
            m.portals.push_back(std::move(p));
        }
    }

    return m;
}

nlohmann::json WorldManifest::to_json(const WorldManifest& m) {
    nlohmann::json j;
    j["version"] = m.version;
    j["grid_cell_size"] = vec3_to_json(m.grid_cell_size);

    j["chunks"] = nlohmann::json::array();
    for (const auto& c : m.chunks) {
        nlohmann::json cj;
        cj["grid"] = ivec3_to_json(c.grid);
        cj["ply_file"] = c.ply_file;
        if (!c.scene_file.empty()) cj["scene_file"] = c.scene_file;
        j["chunks"].push_back(std::move(cj));
    }

    j["streaming_volumes"] = nlohmann::json::array();
    for (const auto& v : m.streaming_volumes) {
        nlohmann::json vj;
        vj["id"] = v.id;
        vj["shape"] = v.shape;
        vj["position"] = vec3_to_json(v.position);
        if (v.shape == "box") vj["half_extents"] = vec3_to_json(v.half_extents);
        if (v.shape == "sphere") vj["radius"] = v.radius;
        vj["preload_target_ids"] = v.preload_target_ids;
        j["streaming_volumes"].push_back(std::move(vj));
    }

    j["portals"] = nlohmann::json::array();
    for (const auto& p : m.portals) {
        nlohmann::json pj;
        pj["id"] = p.id;
        pj["position"] = vec3_to_json(p.position);
        pj["region_shape"] = p.region_shape;
        if (p.region_shape == "sphere") pj["region_radius"] = p.region_radius;
        if (p.region_shape == "box") pj["region_half_extents"] = vec3_to_json(p.region_half_extents);
        pj["target_instance_id"] = p.target_instance_id;
        if (p.spawn_position != glm::vec3(0.0f)) pj["spawn_position"] = vec3_to_json(p.spawn_position);
        if (!p.spawn_facing.empty()) pj["spawn_facing"] = p.spawn_facing;
        j["portals"].push_back(std::move(pj));
    }

    return j;
}

}  // namespace gseurat
