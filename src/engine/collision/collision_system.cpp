#include "gseurat/engine/collision/collision_system.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>

namespace gseurat {

// -- Cache management --------------------------------------------------------

void CollisionSystem::rebuild_cache(ecs::World& world) {
    static_cache_.clear();
    dynamic_cache_.clear();
    bvh_aabbs_.clear();
    bvh_indices_.clear();

    world.view<ecs::Transform, ColliderComponent>().each(
        [&](ecs::Entity entity, ecs::Transform& transform,
            ColliderComponent& collider) {
            ColliderInstance inst;
            inst.entity = entity;
            inst.collider_index = 0;
            inst.world_position =
                transform.position.vec() + collider.offset;
            inst.world_rotation = collider.local_rotation;
            inst.shape = collider.shape;
            inst.world_aabb = compute_aabb(collider.shape,
                                           inst.world_position,
                                           inst.world_rotation);
            inst.collision_mask = collider.collision_mask;
            inst.is_trigger = collider.is_trigger;

            if (collider.is_dynamic) {
                dynamic_cache_.push_back(inst);
            } else {
                static_cache_.push_back(inst);
            }
        });

    rebuild_bvh();
    dirty_ = false;
}

void CollisionSystem::rebuild_bvh() {
    bvh_aabbs_.clear();
    bvh_indices_.clear();

    bvh_aabbs_.reserve(static_cache_.size());
    bvh_indices_.resize(static_cache_.size());

    for (size_t i = 0; i < static_cache_.size(); ++i) {
        bvh_aabbs_.push_back(static_cache_[i].world_aabb);
    }
    std::iota(bvh_indices_.begin(), bvh_indices_.end(), 0u);

    bvh_.build(bvh_aabbs_, bvh_indices_);
}

void CollisionSystem::sync_dynamics(ecs::World& world) {
    for (auto& inst : dynamic_cache_) {
        auto* t = world.try_get<ecs::Transform>(inst.entity);
        auto* c = world.try_get<ColliderComponent>(inst.entity);
        if (!t || !c) continue;

        inst.world_position = t->position.vec() + c->offset;
        inst.world_rotation = c->local_rotation;
        inst.world_aabb =
            compute_aabb(inst.shape, inst.world_position, inst.world_rotation);
    }
}

void CollisionSystem::mark_dirty() { dirty_ = true; }

// -- Queries -----------------------------------------------------------------

std::optional<CollisionSystem::SweepResult> CollisionSystem::sweep(
    const glm::vec3& pos, const glm::quat& rot, const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance, uint32_t mask) const {
    if (max_distance <= 0.0f) return std::nullopt;

    float dir_len = glm::length(direction);
    if (dir_len < 1e-8f) return std::nullopt;
    glm::vec3 dir_norm = direction / dir_len;

    // Compute swept AABB (start + end capsule AABBs)
    AABB start_aabb = compute_aabb(capsule, pos, rot);
    glm::vec3 end_pos = pos + dir_norm * max_distance;
    AABB end_aabb = compute_aabb(capsule, end_pos, rot);

    AABB swept_aabb;
    swept_aabb.min = glm::min(start_aabb.min, end_aabb.min);
    swept_aabb.max = glm::max(start_aabb.max, end_aabb.max);

    // Collect broad-phase candidates from static BVH
    std::vector<uint32_t> candidates;
    bvh_.query_aabb(swept_aabb, bvh_aabbs_, bvh_indices_, candidates);

    // Also linear scan dynamic cache
    // Dynamic indices are encoded as (static_cache_.size() + dynamic_index)
    uint32_t static_count = static_cast<uint32_t>(static_cache_.size());
    for (uint32_t i = 0; i < static_cast<uint32_t>(dynamic_cache_.size()); ++i) {
        const auto& d = dynamic_cache_[i];
        if (aabb_overlaps(swept_aabb, d.world_aabb)) {
            candidates.push_back(static_count + i);
        }
    }

    // Narrow phase: find closest non-trigger hit
    std::optional<SweepResult> best;

    for (uint32_t idx : candidates) {
        const ColliderInstance& inst =
            (idx < static_count) ? static_cache_[idx]
                                 : dynamic_cache_[idx - static_count];

        // Check mask
        if ((inst.collision_mask & mask) == 0) continue;

        // Skip triggers for solid collision
        if (inst.is_trigger) continue;

        auto hit = sweep_capsule(pos, rot, capsule, dir_norm, max_distance,
                                 inst.shape, inst.world_position,
                                 inst.world_rotation);
        if (!hit) continue;

        if (!best || hit->t < best->hit.t) {
            best = SweepResult{*hit, inst.entity, inst.is_trigger};
        }
    }

    return best;
}

std::vector<CollisionSystem::OverlapResult> CollisionSystem::overlap_aabb(
    const AABB& query, uint32_t mask) const {
    std::vector<OverlapResult> results;

    // BVH query for statics
    std::vector<uint32_t> candidates;
    bvh_.query_aabb(query, bvh_aabbs_, bvh_indices_, candidates);

    for (uint32_t idx : candidates) {
        const auto& inst = static_cache_[idx];
        if ((inst.collision_mask & mask) == 0) continue;
        // Actual AABB overlap already verified by BVH leaf test
        results.push_back(OverlapResult{inst.entity, inst.is_trigger});
    }

    // Linear scan dynamics
    for (const auto& inst : dynamic_cache_) {
        if ((inst.collision_mask & mask) == 0) continue;
        if (aabb_overlaps(query, inst.world_aabb)) {
            results.push_back(OverlapResult{inst.entity, inst.is_trigger});
        }
    }

    return results;
}

std::optional<RayHit> CollisionSystem::raycast(const glm::vec3& origin,
                                                const glm::vec3& direction,
                                                float max_dist,
                                                uint32_t mask) const {
    float dir_len = glm::length(direction);
    if (dir_len < 1e-8f) return std::nullopt;
    glm::vec3 dir_norm = direction / dir_len;

    // Compute inv_dir with safe handling for zeros
    glm::vec3 inv_dir;
    constexpr float eps = 1e-8f;
    inv_dir.x = (std::abs(dir_norm.x) > eps) ? (1.0f / dir_norm.x)
                                               : std::copysign(1.0f / eps, dir_norm.x);
    inv_dir.y = (std::abs(dir_norm.y) > eps) ? (1.0f / dir_norm.y)
                                               : std::copysign(1.0f / eps, dir_norm.y);
    inv_dir.z = (std::abs(dir_norm.z) > eps) ? (1.0f / dir_norm.z)
                                               : std::copysign(1.0f / eps, dir_norm.z);

    std::optional<RayHit> best;

    // BVH broad-phase for statics: get candidates via raycast
    // We iterate candidates found via AABB query of a ray-swept bounding box
    // For simplicity, compute a ray bounding box and query it
    AABB ray_aabb;
    glm::vec3 end_pt = origin + dir_norm * max_dist;
    ray_aabb.min = glm::min(origin, end_pt);
    ray_aabb.max = glm::max(origin, end_pt);

    std::vector<uint32_t> candidates;
    bvh_.query_aabb(ray_aabb, bvh_aabbs_, bvh_indices_, candidates);

    for (uint32_t idx : candidates) {
        const auto& inst = static_cache_[idx];
        if ((inst.collision_mask & mask) == 0) continue;

        auto hit = ray_intersect(origin, dir_norm, inst.shape,
                                 inst.world_position, inst.world_rotation);
        if (!hit) continue;
        if (hit->t > max_dist) continue;
        if (!best || hit->t < best->t) {
            best = *hit;
        }
    }

    // Linear scan dynamics
    for (const auto& inst : dynamic_cache_) {
        if ((inst.collision_mask & mask) == 0) continue;
        if (!aabb_overlaps(ray_aabb, inst.world_aabb)) continue;

        auto hit = ray_intersect(origin, dir_norm, inst.shape,
                                 inst.world_position, inst.world_rotation);
        if (!hit) continue;
        if (hit->t > max_dist) continue;
        if (!best || hit->t < best->t) {
            best = *hit;
        }
    }

    return best;
}

// -- Per-frame update --------------------------------------------------------

void CollisionSystem::update(ecs::World& world, float dt) {
    if (dirty_) {
        rebuild_cache(world);
    }
    sync_dynamics(world);
    run_kcc(world, dt);
}

// Stub — implemented in Task 9
void CollisionSystem::run_kcc([[maybe_unused]] ecs::World& world,
                               [[maybe_unused]] float dt) {}

}  // namespace gseurat
