#include "gseurat/engine/trigger_systems.hpp"
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/bone_animation_registry.hpp"
#include "gseurat/engine/ecs/default_components.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace gseurat {

void proximity_trigger_system(ecs::World& world, float dt) {
    (void)dt;
    glm::vec3 player_pos{0.0f};
    bool found = false;
    world.view<PlayerTag, ecs::Transform>().each(
        [&](ecs::Entity, PlayerTag&, ecs::Transform& t) {
            player_pos = t.position.vec();
            found = true;
        });
    if (!found) return;

    world.view<ProximityTrigger, ecs::Transform>().each(
        [&](ecs::Entity, ProximityTrigger& pt, ecs::Transform& t) {
            if (pt.one_shot && pt.was_triggered) {
                pt.triggered = true;
                return;
            }
            float dx = t.position.x() - player_pos.x;
            float dz = t.position.z() - player_pos.z;
            float dist = std::sqrt(dx * dx + dz * dz);
            bool was = pt.triggered;
            pt.triggered = dist < pt.radius;
            if (pt.triggered && !was) {
                std::fprintf(stderr, "[ProximityTrigger] ENTER at (%.1f, %.1f, %.1f) dist=%.1f\n",
                    t.position.x(), t.position.y(), t.position.z(), dist);
            }
            if (pt.triggered && pt.one_shot) {
                pt.was_triggered = true;
            }
        });
}

void linked_trigger_system(ecs::World& world, float dt) {
    (void)dt;
    world.view<LinkedTrigger, ProximityTrigger>().each(
        [&](ecs::Entity, LinkedTrigger& lt, ProximityTrigger& pt) {
            if (!pt.triggered || lt.fired) return;
            lt.fired = true;
            ecs::Entity target{lt.target_entity};
            auto* target_pt = world.try_get<ProximityTrigger>(target);
            if (target_pt) {
                target_pt->triggered = true;
                target_pt->was_triggered = true;
            }
            auto* target_et = world.try_get<EmissiveToggle>(target);
            if (target_et) {
                target_et->current_emission = target_et->emission;
            }
        });
}

void emissive_toggle_system(ecs::World& world, float dt) {
    world.view<EmissiveToggle, ProximityTrigger>().each(
        [&](ecs::Entity, EmissiveToggle& et, ProximityTrigger& pt) {
            float target = pt.triggered ? et.emission : 0.0f;
            et.current_emission += (target - et.current_emission) * std::min(1.0f, dt * 3.0f);
        });
}

void npc_walker_system(ecs::World& world, float dt, BoneAnimationRegistry& registry) {
    const CollisionGrid* grid = nullptr;
    float grid_ox = 0.0f, grid_oz = 0.0f;
    world.view<CollisionGridRef>().each(
        [&](ecs::Entity, CollisionGridRef& ref) {
            grid = ref.grid;
            grid_ox = ref.origin_x;
            grid_oz = ref.origin_z;
        });

    world.view<NpcWalker, ecs::Transform>().each(
        [&](ecs::Entity entity, NpcWalker& npc, ecs::Transform& t) {
            if (!npc.initialized) {
                npc.initialized = true;
                npc.home_x = t.position.x();
                npc.home_z = t.position.z();
                npc.target_x = npc.home_x;
                npc.target_z = npc.home_z;
                npc.paused = true;
                npc.pause_timer = 0.5f;
            }

            if (npc.paused) {
                npc.pause_timer -= dt;
                if (npc.pause_timer <= 0.0f) {
                    npc.paused = false;
                    float angle = static_cast<float>(std::rand()) / RAND_MAX * 6.28318f;
                    float dist = static_cast<float>(std::rand()) / RAND_MAX * npc.patrol_radius;
                    npc.target_x = npc.home_x + std::cos(angle) * dist;
                    npc.target_z = npc.home_z + std::sin(angle) * dist;
                }
                auto* ba_entry = registry.get_by_entity(entity);
                if (ba_entry) {
                    ba_entry->requested_clip = "idle";
                }
                return;
            }

            float dx = npc.target_x - t.position.x();
            float dz = npc.target_z - t.position.z();
            float dist = std::sqrt(dx * dx + dz * dz);

            if (dist < 1.0f) {
                npc.paused = true;
                npc.pause_timer = npc.pause_duration;
                return;
            }

            float step = npc.speed * dt;
            if (step > dist) step = dist;
            t.position.vec().x += (dx / dist) * step;
            t.position.vec().z += (dz / dist) * step;

            if (grid && grid->width > 0 && !grid->elevation.empty()) {
                int gx = static_cast<int>((t.position.x() - grid_ox) / grid->cell_size);
                int gz = static_cast<int>((t.position.z() - grid_oz) / grid->cell_size);
                if (gx >= 0 && gx < static_cast<int>(grid->width) &&
                    gz >= 0 && gz < static_cast<int>(grid->height)) {
                    if (grid->is_solid(static_cast<uint32_t>(gx),
                                       static_cast<uint32_t>(gz))) {
                        t.position.vec().x -= (dx / dist) * step;
                        t.position.vec().z -= (dz / dist) * step;
                        npc.paused = true;
                        npc.pause_timer = 0.5f;
                        return;
                    }
                    t.position.vec().y = grid->get_elevation(
                        static_cast<uint32_t>(gx), static_cast<uint32_t>(gz));
                }
            }

            auto* ba_entry = registry.get_by_entity(entity);
            if (ba_entry) {
                ba_entry->requested_clip = npc.paused ? "idle" : "walk";
                if (!npc.paused) {
                    float ddx = npc.target_x - t.position.x();
                    float ddz = npc.target_z - t.position.z();
                    if (ddx * ddx + ddz * ddz > 0.01f) {
                        ba_entry->facing_angle = std::atan2(ddx, ddz);
                    }
                }
            }
        });
}

}  // namespace gseurat
