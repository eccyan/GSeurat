#include "vulkan_game/engine/scene.hpp"

namespace vulkan_game {

void Scene::set_tile_layer(TileLayer layer) {
    tile_layer_ = std::move(layer);
}

}  // namespace vulkan_game
