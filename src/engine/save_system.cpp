#include "vulkan_game/engine/save_system.hpp"

#include <chrono>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>

namespace vulkan_game {

std::string SaveSystem::slot_path(int slot) const {
    return save_dir_ + "/slot_" + std::to_string(slot) + ".json";
}

std::string SaveSystem::direction_to_string(Direction d) {
    switch (d) {
        case Direction::Up: return "up";
        case Direction::Down: return "down";
        case Direction::Left: return "left";
        case Direction::Right: return "right";
    }
    return "down";
}

Direction SaveSystem::string_to_direction(const std::string& s) {
    if (s == "up")    return Direction::Up;
    if (s == "down")  return Direction::Down;
    if (s == "left")  return Direction::Left;
    if (s == "right") return Direction::Right;
    return Direction::Down;
}

nlohmann::json SaveSystem::to_json(const SaveData& data) {
    nlohmann::json j;
    j["player"] = {
        {"position", {data.player_position.x, data.player_position.y, data.player_position.z}},
        {"facing", direction_to_string(data.player_facing)}
    };

    nlohmann::json npcs = nlohmann::json::array();
    for (const auto& npc : data.npcs) {
        npcs.push_back({
            {"position", {npc.position.x, npc.position.y, npc.position.z}},
            {"facing", direction_to_string(npc.facing)},
            {"patrol_dir", direction_to_string(npc.patrol_dir)},
            {"patrol_timer", npc.patrol_timer}
        });
    }
    j["npcs"] = npcs;

    nlohmann::json flags = nlohmann::json::object();
    for (const auto& [key, val] : data.game_flags) {
        flags[key] = val;
    }
    j["game_flags"] = flags;
    j["play_time"] = data.play_time;
    j["scene_path"] = data.scene_path;
    j["time_of_day"] = data.time_of_day;

    // Add timestamp
    auto now = std::chrono::system_clock::now();
    auto t = std::chrono::system_clock::to_time_t(now);
    std::stringstream ss;
    ss << std::put_time(std::localtime(&t), "%Y-%m-%d %H:%M:%S");
    j["timestamp"] = ss.str();

    return j;
}

SaveData SaveSystem::from_json(const nlohmann::json& j) {
    SaveData data;

    if (j.contains("player")) {
        const auto& p = j["player"];
        if (p.contains("position")) {
            const auto& pos = p["position"];
            data.player_position = {pos[0].get<float>(), pos[1].get<float>(), pos[2].get<float>()};
        }
        if (p.contains("facing")) {
            data.player_facing = string_to_direction(p["facing"]);
        }
    }

    if (j.contains("npcs")) {
        for (const auto& npc_j : j["npcs"]) {
            NpcSaveData npc;
            if (npc_j.contains("position")) {
                const auto& pos = npc_j["position"];
                npc.position = {pos[0].get<float>(), pos[1].get<float>(), pos[2].get<float>()};
            }
            if (npc_j.contains("facing"))
                npc.facing = string_to_direction(npc_j["facing"]);
            if (npc_j.contains("patrol_dir"))
                npc.patrol_dir = string_to_direction(npc_j["patrol_dir"]);
            npc.patrol_timer = npc_j.value("patrol_timer", 0.0f);
            data.npcs.push_back(npc);
        }
    }

    if (j.contains("game_flags") && j["game_flags"].is_object()) {
        for (auto& [key, val] : j["game_flags"].items()) {
            data.game_flags[key] = val.get<bool>();
        }
    }

    data.play_time = j.value("play_time", 0.0f);
    data.scene_path = j.value("scene_path", std::string("assets/scenes/test_scene.json"));
    data.time_of_day = j.value("time_of_day", 0.35f);

    return data;
}

bool SaveSystem::save(int slot, const SaveData& data) {
    if (slot < 0 || slot >= kMaxSlots) return false;

    std::filesystem::create_directories(save_dir_);
    std::ofstream file(slot_path(slot));
    if (!file.is_open()) return false;

    file << to_json(data).dump(2);
    return true;
}

std::optional<SaveData> SaveSystem::load(int slot) const {
    if (slot < 0 || slot >= kMaxSlots) return std::nullopt;

    std::ifstream file(slot_path(slot));
    if (!file.is_open()) return std::nullopt;

    try {
        auto j = nlohmann::json::parse(file);
        return from_json(j);
    } catch (...) {
        return std::nullopt;
    }
}

bool SaveSystem::delete_slot(int slot) {
    if (slot < 0 || slot >= kMaxSlots) return false;
    return std::filesystem::remove(slot_path(slot));
}

SaveMetadata SaveSystem::get_metadata(int slot) const {
    SaveMetadata meta;
    meta.slot_name = "Slot " + std::to_string(slot + 1);

    std::ifstream file(slot_path(slot));
    if (!file.is_open()) {
        meta.exists = false;
        return meta;
    }

    try {
        auto j = nlohmann::json::parse(file);
        meta.exists = true;
        meta.timestamp = j.value("timestamp", "");
        meta.play_time = j.value("play_time", 0.0f);
    } catch (...) {
        meta.exists = false;
    }

    return meta;
}

std::vector<SaveMetadata> SaveSystem::all_metadata() const {
    std::vector<SaveMetadata> result;
    for (int i = 0; i < kMaxSlots; i++) {
        result.push_back(get_metadata(i));
    }
    return result;
}

int SaveSystem::most_recent_slot() const {
    int best = -1;
    std::string best_ts;
    for (int i = 0; i < kMaxSlots; i++) {
        auto meta = get_metadata(i);
        if (meta.exists && meta.timestamp > best_ts) {
            best_ts = meta.timestamp;
            best = i;
        }
    }
    return best;
}

}  // namespace vulkan_game
