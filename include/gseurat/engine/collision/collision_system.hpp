#pragma once

#include "gseurat/engine/collision/primitive.hpp"
#include "gseurat/engine/collision/intersect.hpp"
#include "gseurat/engine/collision/bvh.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/engine/ecs/components/collider_component.hpp"
#include "gseurat/engine/ecs/components/kinematic_body.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cstdint>
#include <optional>
#include <vector>

namespace gseurat {

struct ColliderInstance {
    ecs::Entity entity;
    uint32_t collider_index{0};
    glm::vec3 world_position{0.0f};
    glm::quat world_rotation{1, 0, 0, 0};
    ColliderShape shape{SphereData{0.5f}};
    AABB world_aabb;
    uint32_t collision_mask{0xFFFFFFFF};
    bool is_trigger{false};
};

class CollisionSystem {
public:
    // -- Configuration -------------------------------------------------------
    float world_gravity{20.0f};
    float skin_width{0.01f};
    float ground_probe_distance{0.1f};
    float ground_angle_cos{0.707f};      // cos(45deg)
    uint32_t max_slide_iterations{1};
    float jump_cut_multiplier{0.5f};

    // -- Cache management ----------------------------------------------------
    void rebuild_cache(ecs::World& world);
    void sync_dynamics(ecs::World& world);
    void mark_dirty();

    // -- Queries -------------------------------------------------------------
    struct SweepResult {
        SweepHit hit;
        ecs::Entity entity;
        bool is_trigger;
    };

    struct OverlapResult {
        ecs::Entity entity;
        bool is_trigger;
    };

    std::optional<SweepResult> sweep(
        const glm::vec3& pos, const glm::quat& rot,
        const CapsuleData& capsule,
        const glm::vec3& direction, float max_distance,
        uint32_t mask) const;

    std::vector<OverlapResult> overlap_aabb(const AABB& query, uint32_t mask) const;

    std::optional<RayHit> raycast(
        const glm::vec3& origin, const glm::vec3& direction,
        float max_dist, uint32_t mask) const;

    // -- Per-frame update ----------------------------------------------------
    void update(ecs::World& world, float dt);

    // -- Accessors (for tests & debug dump) ------------------------------------
    const std::vector<ColliderInstance>& static_cache() const { return static_cache_; }
    const std::vector<ColliderInstance>& dynamic_cache() const { return dynamic_cache_; }
    const BVH& bvh() const { return bvh_; }
    bool is_dirty() const { return dirty_; }
    const std::vector<HeightfieldInstance>& heightfield_cache() const { return heightfield_cache_; }

private:
    std::vector<ColliderInstance> static_cache_;
    std::vector<ColliderInstance> dynamic_cache_;

    // BVH data
    BVH bvh_;
    std::vector<AABB> bvh_aabbs_;       // AABBs indexed by original order
    std::vector<uint32_t> bvh_indices_;  // Reordered indices into static_cache_

    bool dirty_{true};

    std::vector<HeightfieldInstance> heightfield_cache_;

    void rebuild_bvh();
    void run_kcc(ecs::World& world, float dt);  // Implemented in Task 9
};

}  // namespace gseurat
