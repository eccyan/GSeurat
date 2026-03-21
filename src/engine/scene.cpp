#include "gseurat/engine/scene.hpp"

namespace gseurat {

void Scene::set_tile_layer(TileLayer layer) {
    if (!layer.tiles.empty()) {
        tile_layer_ = std::move(layer);
    } else {
        tile_layer_.reset();
    }
}

}  // namespace gseurat
