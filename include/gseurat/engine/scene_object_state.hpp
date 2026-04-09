#pragma once

#include "gseurat/engine/scene_loader.hpp"

#include <string>
#include <vector>

namespace gseurat {

struct SceneObjectState {
    std::string current_scene_path = "assets/scenes/test_scene.json";
    std::vector<GameObjectData> game_objects;
    std::vector<PortalData> portals;
    bool transitioning = false;
    uint32_t scene_data_version = 0;  // incremented by update_scene_data
};

}  // namespace gseurat
