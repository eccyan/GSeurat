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
            // Skip kinematic body entities — they're swept, not static obstacles
            if (world.has<KinematicBody>(entity)) return;

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

    // Scan heightfield entities
    heightfield_cache_.clear();
    world.view<ecs::Transform, HeightfieldComponent>().each(
        [&](ecs::Entity entity, ecs::Transform& transform,
            HeightfieldComponent& hfc) {
            if (hfc.data.img_width == 0 || hfc.data.img_height == 0) return;

            HeightfieldInstance inst;
            inst.entity        = entity;
            inst.origin        = transform.position.vec();
            inst.width         = hfc.width;
            inst.length        = hfc.length;
            inst.min_height    = hfc.min_height;
            inst.max_height    = hfc.max_height;
            inst.collision_mask = hfc.collision_mask;
            inst.data          = &hfc.data;

            inst.world_aabb.min = inst.origin + glm::vec3(0.0f, inst.min_height, 0.0f);
            inst.world_aabb.max = inst.origin + glm::vec3(inst.width, inst.max_height, inst.length);

            hfc.world_aabb = inst.world_aabb;
            heightfield_cache_.push_back(inst);
        });

    rebuild_bvh();
    dirty_ = false;
}

void CollisionSystem::rebuild_bvh() {
    bvh_aabbs_.clear();
    bvh_indices_.clear();

    size_t total = static_cache_.size() + heightfield_cache_.size();
    bvh_aabbs_.reserve(total);
    bvh_indices_.resize(total);

    for (size_t i = 0; i < static_cache_.size(); ++i) {
        bvh_aabbs_.push_back(static_cache_[i].world_aabb);
    }
    for (size_t i = 0; i < heightfield_cache_.size(); ++i) {
        bvh_aabbs_.push_back(heightfield_cache_[i].world_aabb);
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

    // Collect broad-phase candidates from static BVH (includes heightfields)
    std::vector<uint32_t> candidates;
    bvh_.query_aabb(swept_aabb, bvh_aabbs_, bvh_indices_, candidates);

    uint32_t static_count = static_cast<uint32_t>(static_cache_.size());

    // Narrow phase: find closest non-trigger hit
    std::optional<SweepResult> best;

    // BVH candidates: primitives [0, static_count) or heightfields [static_count, ...)
    for (uint32_t idx : candidates) {
        if (idx < static_count) {
            // Primitive collider
            const auto& inst = static_cache_[idx];
            if ((inst.collision_mask & mask) == 0) continue;
            if (inst.is_trigger) continue;

            auto hit = sweep_capsule(pos, rot, capsule, dir_norm, max_distance,
                                     inst.shape, inst.world_position,
                                     inst.world_rotation);
            if (hit && (!best || hit->t < best->hit.t)) {
                best = SweepResult{*hit, inst.entity, inst.is_trigger};
            }
        } else {
            // Heightfield
            uint32_t hf_idx = idx - static_count;
            if (hf_idx >= heightfield_cache_.size()) continue;
            const auto& hf = heightfield_cache_[hf_idx];
            if ((hf.collision_mask & mask) == 0) continue;

            auto hit = sweep_capsule_vs_heightfield(
                pos, rot, capsule, dir_norm, max_distance, hf);
            if (hit && (!best || hit->t < best->hit.t)) {
                best = SweepResult{*hit, hf.entity, false};
            }
        }
    }

    // Dynamic colliders (linear scan)
    for (const auto& d : dynamic_cache_) {
        if ((d.collision_mask & mask) == 0) continue;
        if (d.is_trigger) continue;
        if (!aabb_overlaps(swept_aabb, d.world_aabb)) continue;

        auto hit = sweep_capsule(pos, rot, capsule, dir_norm, max_distance,
                                 d.shape, d.world_position, d.world_rotation);
        if (hit && (!best || hit->t < best->hit.t)) {
            best = SweepResult{*hit, d.entity, d.is_trigger};
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

    uint32_t static_count = static_cast<uint32_t>(static_cache_.size());
    for (uint32_t idx : candidates) {
        if (idx < static_count) {
            const auto& inst = static_cache_[idx];
            if ((inst.collision_mask & mask) == 0) continue;
            results.push_back(OverlapResult{inst.entity, inst.is_trigger});
        } else {
            // Heightfield — skip for AABB overlap (heightfield AABB is coarse)
            uint32_t hf_idx = idx - static_count;
            if (hf_idx >= heightfield_cache_.size()) continue;
            const auto& hf = heightfield_cache_[hf_idx];
            if ((hf.collision_mask & mask) == 0) continue;
            results.push_back(OverlapResult{hf.entity, false});
        }
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
        if (idx < static_cast<uint32_t>(static_cache_.size())) {
            const auto& inst = static_cache_[idx];
            if ((inst.collision_mask & mask) == 0) continue;

            auto hit = ray_intersect(origin, dir_norm, inst.shape,
                                     inst.world_position, inst.world_rotation);
            if (!hit || hit->t > max_dist) continue;
            if (!best || hit->t < best->t) best = *hit;
        } else {
            uint32_t hf_idx = idx - static_cast<uint32_t>(static_cache_.size());
            if (hf_idx >= heightfield_cache_.size()) continue;
            const auto& hf = heightfield_cache_[hf_idx];
            if ((hf.collision_mask & mask) == 0) continue;

            auto hit = ray_vs_heightfield(origin, dir_norm, hf);
            if (!hit || hit->t > max_dist) continue;
            if (!best || hit->t < best->t) best = *hit;
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

void CollisionSystem::run_kcc(ecs::World& world, float dt) {
    world.view<ecs::Transform, KinematicBody, ColliderComponent>().each(
        [&](ecs::Entity entity, ecs::Transform& transform,
            KinematicBody& body, ColliderComponent& collider) {
            // Only process capsule-shaped kinematic bodies
            auto* capsule_ptr = std::get_if<CapsuleData>(&collider.shape);
            if (!capsule_ptr) return;
            const CapsuleData& capsule = *capsule_ptr;

            glm::vec3 position = transform.position.vec();
            glm::vec3 velocity = body.velocity;
            glm::quat rot = collider.local_rotation;
            bool grounded = body.grounded;
            glm::vec3 ground_normal = body.ground_normal;

            // Step 1: Apply gravity
            if (velocity.y > 0.0f) {
                // Jump ascent — use designer-tuned derived_gravity
                velocity.y -= body.derived_gravity * dt;
            } else if (!grounded) {
                // Fall — use world gravity (fast-fall feel)
                velocity.y -= world_gravity * body.gravity_scale * dt;
            } else if (velocity.y < 0.0f) {
                // Grounded, stop downward velocity
                velocity.y = 0.0f;
            }

            // Step 2: Horizontal sweep (XZ)
            glm::vec3 h_delta(velocity.x * dt, 0.0f, velocity.z * dt);
            std::optional<SweepResult> wall_hit;

            if (glm::length(h_delta) > 1e-6f) {
                glm::vec3 h_dir = glm::normalize(h_delta);
                float h_dist = glm::length(h_delta);

                auto hit = sweep(position, rot, capsule, h_dir, h_dist,
                                 collider.collision_mask);
                if (hit && !hit->is_trigger) {
                    float safe_t = std::max(hit->hit.t * h_dist - skin_width, 0.0f);
                    position += h_dir * safe_t;
                    wall_hit = hit;
                } else {
                    position += h_delta;
                }
            }

            // Step 3: Wall sliding
            if (wall_hit) {
                float remaining_frac = 1.0f - wall_hit->hit.t;
                glm::vec3 remaining = h_delta * remaining_frac;
                glm::vec3 wall_normal = wall_hit->hit.normal;

                // Project remaining movement onto wall plane
                glm::vec3 projected = remaining -
                    glm::dot(remaining, wall_normal) * wall_normal;

                if (glm::length(projected) > 1e-6f) {
                    glm::vec3 slide_dir = glm::normalize(projected);
                    float slide_dist = glm::length(projected);

                    auto slide_hit = sweep(position, rot, capsule, slide_dir,
                                           slide_dist, collider.collision_mask);
                    if (slide_hit && !slide_hit->is_trigger) {
                        float safe_t = std::max(
                            slide_hit->hit.t * slide_dist - skin_width, 0.0f);
                        position += slide_dir * safe_t;
                    } else {
                        position += projected;
                    }
                }

                // Project velocity for next frame
                glm::vec3 vel_xz(velocity.x, 0.0f, velocity.z);
                vel_xz -= glm::dot(vel_xz, wall_normal) * wall_normal;
                velocity.x = vel_xz.x;
                velocity.z = vel_xz.z;
            }

            // Step 4: Vertical sweep (Y)
            glm::vec3 v_delta(0.0f, velocity.y * dt, 0.0f);

            if (std::abs(v_delta.y) > 1e-6f) {
                glm::vec3 v_dir = glm::normalize(v_delta);
                float v_dist = std::abs(v_delta.y);

                auto hit = sweep(position, rot, capsule, v_dir, v_dist,
                                 collider.collision_mask);
                if (hit && !hit->is_trigger) {
                    float safe_t = std::max(hit->hit.t * v_dist - skin_width, 0.0f);
                    position += v_dir * safe_t;

                    if (v_delta.y > 0.0f) {
                        // Hit ceiling — kill upward velocity
                        velocity.y = 0.0f;
                    }
                    // If falling and hit floor, ground detection in step 5 handles it
                } else {
                    position += v_delta;
                }
            }

            // Step 5: Ground probe
            auto probe = sweep(position, rot, capsule,
                               glm::vec3(0.0f, -1.0f, 0.0f),
                               ground_probe_distance,
                               collider.collision_mask);

            if (probe && !probe->is_trigger &&
                glm::dot(probe->hit.normal, glm::vec3(0, 1, 0)) > ground_angle_cos) {
                grounded = true;
                ground_normal = probe->hit.normal;
                // Snap to ground
                float snap_dist = std::max(
                    probe->hit.t * ground_probe_distance - skin_width, 0.0f);
                position.y -= snap_dist;
            } else {
                grounded = false;
                ground_normal = glm::vec3(0.0f, 1.0f, 0.0f);
            }

            // Step 6: Write back
            transform.position = coord::WorldPos(position);
            body.velocity = velocity;
            body.grounded = grounded;
            body.ground_normal = ground_normal;
        });
}

}  // namespace gseurat
