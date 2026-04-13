#pragma once

#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"

#include <glm/glm.hpp>
#include <string>
#include <vector>

namespace gseurat {

struct GsTerrainState {
    AABB terrain_aabb{};
    glm::vec3 cloud_center{0.0f};
    float cloud_extent = 100.0f;
    std::vector<glm::vec3> pbd_anchors;
    std::vector<PbdConfig> pbd_configs;

    // Bone-animated game object allocations (populated by scene loader)
    struct BoneAllocation {
        std::string manifest_path;
        std::string default_clip;
        uint32_t first_bone_index = 0;
        uint32_t bone_count = 0;
        float char_scale = 1.0f;
        float gs_scale_multiplier = 1.0f;
        glm::vec3 world_pos{0.0f};
        size_t game_object_index = 0;  // index into snapped_objects for entity lookup
    };
    std::vector<BoneAllocation> bone_allocations;
    uint32_t bone_slot_counter = 8;  // first 8 reserved for player

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
