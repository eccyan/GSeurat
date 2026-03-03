#pragma once

#include "vulkan_game/engine/tilemap.hpp"
#include "vulkan_game/engine/types.hpp"

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
    glm::vec2 uv_min{0.0f, 0.0f};
    glm::vec2 uv_max{1.0f, 1.0f};
};

class Scene {
public:
    Entity* create_entity();

    const std::vector<std::unique_ptr<Entity>>& entities() const { return entities_; }

    void set_tile_layer(TileLayer layer);
    const std::optional<TileLayer>& tile_layer() const { return tile_layer_; }

    void set_ambient_color(const glm::vec4& color) { ambient_color_ = color; }
    const glm::vec4& ambient_color() const { return ambient_color_; }

    void add_light(const PointLight& light) { lights_.push_back(light); }
    void clear_lights() { lights_.clear(); }
    const std::vector<PointLight>& lights() const { return lights_; }

private:
    std::vector<std::unique_ptr<Entity>> entities_;
    std::optional<TileLayer> tile_layer_;
    glm::vec4 ambient_color_{0.25f, 0.28f, 0.45f, 1.0f};
    std::vector<PointLight> lights_;
};

}  // namespace vulkan_game
