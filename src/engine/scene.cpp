#include "vulkan_game/engine/scene.hpp"

#include <memory>

namespace vulkan_game {

Entity* Scene::create_entity() {
    entities_.push_back(std::make_unique<Entity>());
    return entities_.back().get();
}

void Scene::set_tile_layer(TileLayer layer) {
    tile_layer_ = std::move(layer);
}

}  // namespace vulkan_game
