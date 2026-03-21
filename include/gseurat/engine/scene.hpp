#pragma once

#include "gseurat/engine/parallax_layer.hpp"
#include "gseurat/engine/tilemap.hpp"
#include "gseurat/engine/types.hpp"

#include <glm/glm.hpp>
#include <optional>
#include <vector>

namespace gseurat {

class Scene {
public:
    void set_tile_layer(TileLayer layer);
    const std::optional<TileLayer>& tile_layer() const { return tile_layer_; }

    void set_tile_animator(TileAnimator animator) { tile_animator_ = std::move(animator); }
    TileAnimator* tile_animator() { return tile_animator_ ? &*tile_animator_ : nullptr; }
    const TileAnimator* tile_animator() const { return tile_animator_ ? &*tile_animator_ : nullptr; }

    void set_ambient_color(const glm::vec4& color) { ambient_color_ = color; }
    const glm::vec4& ambient_color() const { return ambient_color_; }

    void add_light(const PointLight& light) { lights_.push_back(light); }
    void clear_lights() { lights_.clear(); }
    const std::vector<PointLight>& lights() const { return lights_; }

    void set_background_layers(std::vector<ParallaxLayer> layers) { background_layers_ = std::move(layers); }
    const std::vector<ParallaxLayer>& background_layers() const { return background_layers_; }

    void set_fog_density(float d) { fog_density_ = d; }
    float fog_density() const { return fog_density_; }
    void set_fog_color(const glm::vec3& c) { fog_color_ = c; }
    const glm::vec3& fog_color() const { return fog_color_; }

private:
    std::optional<TileLayer> tile_layer_;
    std::optional<TileAnimator> tile_animator_;
    glm::vec4 ambient_color_{0.25f, 0.28f, 0.45f, 1.0f};
    std::vector<PointLight> lights_;
    std::vector<ParallaxLayer> background_layers_;
    float fog_density_ = 0.0f;
    glm::vec3 fog_color_{0.3f, 0.35f, 0.45f};
};

}  // namespace gseurat
