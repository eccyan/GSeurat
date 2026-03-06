#pragma once

#include "vulkan_game/engine/animation.hpp"
#include "vulkan_game/engine/tilemap.hpp"

#include <optional>
#include <string>
#include <vector>

namespace vulkan_game {

struct CharacterAnimData {
    Tileset tileset;
    std::vector<AnimationClip> clips;
};

// Load character animation definitions from an animations.json file.
// Returns nullopt if the file doesn't exist.
std::optional<CharacterAnimData> load_character_anims(const std::string& path);

}  // namespace vulkan_game
