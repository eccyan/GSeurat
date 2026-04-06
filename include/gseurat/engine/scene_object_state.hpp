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
};

}  // namespace gseurat
