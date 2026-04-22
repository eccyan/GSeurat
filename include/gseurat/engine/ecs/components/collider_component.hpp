#pragma once

#include "gseurat/engine/collision/primitive.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <nlohmann/json.hpp>

#include <cstdint>
#include <string>

namespace gseurat {

struct ColliderComponent {
    ColliderShape shape{SphereData{0.5f}};
    glm::vec3 offset{0.0f};
    glm::quat local_rotation{1, 0, 0, 0};  // w, x, y, z — identity
    uint32_t collision_mask{0xFFFFFFFF};
    bool is_trigger{false};
    bool is_dynamic{false};
};

// ── JSON serialization ────────────────────────────────────────────

inline ColliderComponent collider_from_json(const nlohmann::json& j) {
    ColliderComponent c;

    // Parse shape
    if (j.contains("shape") && j["shape"].is_object()) {
        const auto& s = j["shape"];
        std::string type = s.value("type", "sphere");
        if (type == "box") {
            BoxData box;
            if (s.contains("half_extents") && s["half_extents"].is_array()) {
                const auto& he = s["half_extents"];
                box.half_extents = glm::vec3(he[0].get<float>(), he[1].get<float>(), he[2].get<float>());
            }
            c.shape = box;
        } else if (type == "capsule") {
            CapsuleData cap;
            if (s.contains("radius")) cap.radius = s["radius"].get<float>();
            if (s.contains("half_height")) cap.half_height = s["half_height"].get<float>();
            c.shape = cap;
        } else {
            // Default: sphere (also handles unknown types)
            SphereData sph;
            if (s.contains("radius")) sph.radius = s["radius"].get<float>();
            c.shape = sph;
        }
    }

    // Parse offset
    if (j.contains("offset") && j["offset"].is_array()) {
        const auto& o = j["offset"];
        c.offset = glm::vec3(o[0].get<float>(), o[1].get<float>(), o[2].get<float>());
    }

    // Parse local_rotation as [x, y, z, w]
    if (j.contains("local_rotation") && j["local_rotation"].is_array()) {
        const auto& r = j["local_rotation"];
        c.local_rotation = glm::quat(r[3].get<float>(), r[0].get<float>(), r[1].get<float>(), r[2].get<float>());
    }

    if (j.contains("collision_mask")) c.collision_mask = j["collision_mask"].get<uint32_t>();
    if (j.contains("is_trigger")) c.is_trigger = j["is_trigger"].get<bool>();
    if (j.contains("is_dynamic")) c.is_dynamic = j["is_dynamic"].get<bool>();

    return c;
}

inline nlohmann::json collider_to_json(const ColliderComponent& c) {
    nlohmann::json j;

    // Serialize shape
    std::visit([&](const auto& s) {
        using T = std::decay_t<decltype(s)>;
        if constexpr (std::is_same_v<T, BoxData>) {
            j["shape"] = {
                {"type", "box"},
                {"half_extents", {s.half_extents.x, s.half_extents.y, s.half_extents.z}}
            };
        } else if constexpr (std::is_same_v<T, SphereData>) {
            j["shape"] = {{"type", "sphere"}, {"radius", s.radius}};
        } else if constexpr (std::is_same_v<T, CapsuleData>) {
            j["shape"] = {{"type", "capsule"}, {"radius", s.radius}, {"half_height", s.half_height}};
        }
    }, c.shape);

    j["offset"] = {c.offset.x, c.offset.y, c.offset.z};
    j["local_rotation"] = {c.local_rotation.x, c.local_rotation.y, c.local_rotation.z, c.local_rotation.w};
    j["collision_mask"] = c.collision_mask;
    j["is_trigger"] = c.is_trigger;
    j["is_dynamic"] = c.is_dynamic;

    return j;
}

}  // namespace gseurat
