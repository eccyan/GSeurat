#pragma once

#include "vulkan_game/engine/tilemap.hpp"

#include <glm/glm.hpp>
#include <memory>
#include <optional>
#include <vector>

namespace vulkan_game {

struct Transform {
    glm::vec3 position{0.0f};
    glm::vec2 scale{1.0f, 1.0f};
};

struct Entity {
    Transform transform;
    glm::vec4 tint{1.0f, 1.0f, 1.0f, 1.0f};
};

class Scene {
public:
    Entity* create_entity();

    const std::vector<std::unique_ptr<Entity>>& entities() const { return entities_; }

    void set_tile_layer(TileLayer layer);
    const std::optional<TileLayer>& tile_layer() const { return tile_layer_; }

private:
    std::vector<std::unique_ptr<Entity>> entities_;
    std::optional<TileLayer> tile_layer_;
};

}  // namespace vulkan_game
