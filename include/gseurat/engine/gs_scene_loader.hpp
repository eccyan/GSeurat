#pragma once

#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/types.hpp"

#include <glm/glm.hpp>
#include <cstdint>
#include <vector>

namespace gseurat {

struct SceneLoadContext;

struct GsSceneOptions {
    bool add_default_light = false;
    bool set_god_rays = false;
};

// Output of the CPU-only parse phase. Contains everything `GsSceneLoader::load`
// produced from PLY parsing + merging, ready for the main-thread GPU/ECS phase.
// Designed to be moved out of a worker thread and consumed once on the main
// thread.
struct ParsedScene {
    GaussianCloud cloud;                                     // merged terrain + game-object Gaussians
    bool has_terrain = false;
    float gs_scale_multiplier = 1.0f;
    AABB terrain_aabb{};
    glm::vec3 cloud_center{0.0f};
    float cloud_extent = 0.0f;

    std::vector<GameObjectData> snapped_objects;
    std::vector<coord::WorldPos> world_positions;
    std::vector<GsTerrainState::BoneAllocation> bone_allocations;
    uint32_t bone_slot_counter = 8;

    std::vector<glm::vec3> pbd_anchors;
    std::vector<PbdConfig> pbd_configs;
};

class GsSceneLoader {
public:
    // Synchronous full load (parse on calling thread, then GPU/ECS finalize).
    void load(SceneLoadContext& ctx, const SceneData& scene_data,
              const GsSceneOptions& opts = {});

    // CPU-only parse phase: PLY parsing, geometry merging, transform of game-object
    // Gaussians, bone-allocation enumeration, PBD anchor extraction. Safe to call
    // from a worker thread because it touches no Vulkan/ECS/GPU state. The result
    // is consumed by `finalize_on_main` to perform the GPU/ECS phase.
    static ParsedScene parse(const SceneData& scene_data);

    // GPU/ECS finalize phase, must run on the main (Vulkan) thread. Uses the
    // already-parsed cloud + metadata in `parsed` plus the live `ctx`.
    void finalize_on_main(SceneLoadContext& ctx, const SceneData& scene_data,
                          ParsedScene&& parsed, const GsSceneOptions& opts);
};

}  // namespace gseurat
