#pragma once

#include "gseurat/engine/ecs/types.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/world_manifest.hpp"

#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace gseurat {

struct SceneObjectState {
    std::string current_scene_path = "assets/scenes/test_scene.json";
    std::vector<GameObjectData> game_objects;
    bool transitioning = false;
    uint32_t scene_data_version = 0;  // incremented by update_scene_data
    std::optional<WorldManifest> world_manifest;

    /// Map from collider ID to ECS entity — avoids fragile position-based lookup
    std::unordered_map<std::string, ecs::Entity> collider_entity_map;
};

}  // namespace gseurat
