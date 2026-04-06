#pragma once

#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"

#include <glm/glm.hpp>
#include <vector>

namespace gseurat {

struct GsTerrainState {
    AABB terrain_aabb{};
    glm::vec3 cloud_center{0.0f};
    float cloud_extent = 100.0f;
    std::vector<glm::vec3> pbd_anchors;
    std::vector<PbdConfig> pbd_configs;
    CollisionGrid collision_grid;
    GsParallaxCamera parallax_camera;
    bool parallax_active = false;
    uint32_t frame_counter = 0;
    uint32_t render_interval = 4;
    glm::vec2 last_compute_offset{0.0f};

    glm::vec2 aabb_offset() const {
        return {terrain_aabb.min.x, terrain_aabb.min.y};
    }

    void reset() {
        *this = GsTerrainState{};
    }
};

}  // namespace gseurat
