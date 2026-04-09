#include "gseurat/staging/visual_state.hpp"

namespace gseurat {

nlohmann::json VisualState::to_json() const {
    nlohmann::json j;

    // Panels
    j["panels"] = nlohmann::json::array();
    for (auto& p : panels) {
        j["panels"].push_back({
            {"name", p.name},
            {"visible", p.visible},
            {"on_screen", p.is_on_screen()},
            {"pos", {p.pos_x, p.pos_y}},
            {"size", {p.size_w, p.size_h}},
        });
    }

    // Gizmos — keyed by name
    j["gizmos"] = nlohmann::json::object();
    for (auto& g : gizmos) {
        j["gizmos"][g.name] = {{"enabled", g.enabled}, {"count", g.count}};
    }

    // Scene
    j["scene"] = {
        {"gaussians_visible", scene.gaussians_visible},
        {"gaussians_total", scene.gaussians_total},
        {"game_objects_loaded", scene.game_objects_loaded},
        {"terrain_loaded", scene.terrain_loaded},
        {"character_visible", scene.character_visible},
    };

    // Features
    j["features"] = nlohmann::json::object();
    for (auto& [k, v] : features) {
        j["features"][k] = v;
    }

    // Camera review
    j["camera_review"] = {
        {"active", camera_review.active},
        {"player_pos", {camera_review.player_x, camera_review.player_y, camera_review.player_z}},
        {"active_zone", camera_review.active_zone},
    };

    return j;
}

// Flatten a JSON object to {"a.b.c": value} pairs
static void flatten(const nlohmann::json& j, const std::string& prefix,
                    std::unordered_map<std::string, nlohmann::json>& out) {
    if (j.is_object()) {
        for (auto& [k, v] : j.items()) {
            flatten(v, prefix.empty() ? k : prefix + "." + k, out);
        }
    } else if (j.is_array()) {
        for (size_t i = 0; i < j.size(); i++) {
            flatten(j[i], prefix + "[" + std::to_string(i) + "]", out);
        }
    } else {
        out[prefix] = j;
    }
}

nlohmann::json visual_state_diff(const nlohmann::json& before,
                                  const nlohmann::json& after) {
    std::unordered_map<std::string, nlohmann::json> flat_a, flat_b;
    flatten(before, "", flat_a);
    flatten(after, "", flat_b);

    nlohmann::json changed = nlohmann::json::object();
    nlohmann::json added = nlohmann::json::object();
    nlohmann::json removed = nlohmann::json::object();

    for (auto& [k, v] : flat_a) {
        auto it = flat_b.find(k);
        if (it == flat_b.end()) {
            removed[k] = {{"was", v}};
        } else if (it->second != v) {
            changed[k] = {{"was", v}, {"now", it->second}};
        }
    }
    for (auto& [k, v] : flat_b) {
        if (flat_a.find(k) == flat_a.end()) {
            added[k] = {{"now", v}};
        }
    }

    return {{"changed", changed}, {"added", added}, {"removed", removed}};
}

} // namespace gseurat
