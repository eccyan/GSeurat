#include "gseurat/engine/character_data.hpp"

#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

namespace gseurat {

std::optional<CharacterAnimData> load_character_anims(const std::string& path) {
    if (!std::filesystem::exists(path)) {
        return std::nullopt;
    }

    std::ifstream file(path);
    if (!file.is_open()) {
        return std::nullopt;
    }

    nlohmann::json j = nlohmann::json::parse(file);
    CharacterAnimData data;

    // Parse tileset
    if (j.contains("tileset")) {
        const auto& ts = j["tileset"];
        data.tileset.tile_width = ts["tile_width"];
        data.tileset.tile_height = ts["tile_height"];
        data.tileset.columns = ts["columns"];
        data.tileset.sheet_width = ts["sheet_width"];
        data.tileset.sheet_height = ts["sheet_height"];
    }

    // Parse clips
    if (j.contains("clips")) {
        for (const auto& clip_j : j["clips"]) {
            AnimationClip clip;
            clip.name = clip_j["name"].get<std::string>();
            clip.looping = clip_j.value("loop", true);
            for (const auto& frame_j : clip_j["frames"]) {
                AnimationFrame frame;
                frame.tile_id = frame_j["tile_id"];
                frame.duration = frame_j["duration"];
                clip.frames.push_back(frame);
            }
            data.clips.push_back(std::move(clip));
        }
    }

    return data;
}

}  // namespace gseurat
