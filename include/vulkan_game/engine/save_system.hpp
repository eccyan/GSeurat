#pragma once

#include "vulkan_game/engine/direction.hpp"

#include <glm/glm.hpp>
#include <nlohmann/json.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace vulkan_game {

struct NpcSaveData {
    glm::vec3 position{0.0f};
    Direction facing = Direction::Down;
    Direction patrol_dir = Direction::Right;
    float patrol_timer = 0.0f;
};

struct SaveData {
    glm::vec3 player_position{0.0f};
    Direction player_facing = Direction::Down;
    std::vector<NpcSaveData> npcs;
    std::unordered_map<std::string, bool> game_flags;
    float play_time = 0.0f;
};

struct SaveMetadata {
    std::string slot_name;
    std::string timestamp;
    float play_time = 0.0f;
    bool exists = false;
};

class SaveSystem {
public:
    void set_save_directory(const std::string& dir) { save_dir_ = dir; }

    bool save(int slot, const SaveData& data);
    std::optional<SaveData> load(int slot) const;
    bool delete_slot(int slot);

    SaveMetadata get_metadata(int slot) const;
    std::vector<SaveMetadata> all_metadata() const;
    int most_recent_slot() const;

    static constexpr int kMaxSlots = 3;

private:
    std::string slot_path(int slot) const;
    static nlohmann::json to_json(const SaveData& data);
    static SaveData from_json(const nlohmann::json& j);
    static std::string direction_to_string(Direction d);
    static Direction string_to_direction(const std::string& s);

    std::string save_dir_ = "saves";
};

}  // namespace vulkan_game
