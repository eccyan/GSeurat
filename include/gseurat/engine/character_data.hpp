#pragma once

#include "gseurat/engine/animation.hpp"
#include "gseurat/engine/tilemap.hpp"

#include <optional>
#include <string>
#include <vector>

namespace gseurat {

struct CharacterAnimData {
    Tileset tileset;
    std::vector<AnimationClip> clips;
};

// Load character animation definitions from an animations.json file.
// Returns nullopt if the file doesn't exist.
std::optional<CharacterAnimData> load_character_anims(const std::string& path);

}  // namespace gseurat
