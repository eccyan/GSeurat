#include "gseurat/demo/island_systems.hpp"
#include "gseurat/demo/island_components.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include <cmath>
#include <cstdio>

namespace gseurat {

void proximity_trigger_system(ecs::World& world, float dt) {
    (void)dt;
    glm::vec3 player_pos{0.0f};
    bool found = false;
    world.view<PlayerController, ecs::Transform>().each(
        [&](ecs::Entity, PlayerController&, ecs::Transform& t) {
            player_pos = t.position;
            found = true;
        });
    if (!found) {
        std::fprintf(stderr, "[ProximityTrigger] No PlayerController entity found!\n");
        return;
    }

    int trigger_count = 0;
    int triggered_count = 0;
    world.view<ProximityTrigger, ecs::Transform>().each(
        [&](ecs::Entity, ProximityTrigger& pt, ecs::Transform& t) {
            trigger_count++;
            if (pt.one_shot && pt.was_triggered) {
                pt.triggered = true;
                triggered_count++;
                return;
            }
            float dx = t.position.x - player_pos.x;
            float dz = t.position.z - player_pos.z;
            float dist = std::sqrt(dx * dx + dz * dz);
            bool was = pt.triggered;
            pt.triggered = dist < pt.radius;
            if (pt.triggered && !was) {
                std::fprintf(stderr, "[ProximityTrigger] ENTER at (%.1f, %.1f, %.1f) dist=%.1f radius=%.1f\n",
                    t.position.x, t.position.y, t.position.z, dist, pt.radius);
            }
            if (!pt.triggered && was) {
                std::fprintf(stderr, "[ProximityTrigger] EXIT at (%.1f, %.1f, %.1f)\n",
                    t.position.x, t.position.y, t.position.z);
            }
            if (pt.triggered) triggered_count++;
            if (pt.triggered && pt.one_shot) {
                pt.was_triggered = true;
            }
        });

    // Log once at startup to verify system is running
    static bool logged_once = false;
    if (!logged_once) {
        std::fprintf(stderr, "[ProximityTrigger] System running: %d triggers, player at (%.1f, %.1f, %.1f)\n",
            trigger_count, player_pos.x, player_pos.y, player_pos.z);
        logged_once = true;
    }
}

void linked_trigger_system(ecs::World& world, float dt) {
    (void)dt;
    world.view<LinkedTrigger, ProximityTrigger>().each(
        [&](ecs::Entity, LinkedTrigger& lt, ProximityTrigger& pt) {
            if (!pt.triggered || lt.fired) return;
            lt.fired = true;
            // Find target entity and set its triggered state
            ecs::Entity target{lt.target_entity};
            auto* target_pt = world.try_get<ProximityTrigger>(target);
            if (target_pt) {
                target_pt->triggered = true;
                target_pt->was_triggered = true;
            }
            // Also trigger EmissiveToggle directly if target has one
            auto* target_et = world.try_get<EmissiveToggle>(target);
            if (target_et) {
                target_et->current_emission = target_et->emission;
            }
        });
}

void emissive_toggle_system(ecs::World& world, float dt) {
    int count = 0;
    world.view<EmissiveToggle, ProximityTrigger>().each(
        [&](ecs::Entity, EmissiveToggle& et, ProximityTrigger& pt) {
            count++;
            float target = pt.triggered ? et.emission : 0.0f;
            float prev = et.current_emission;
            et.current_emission += (target - et.current_emission) * std::min(1.0f, dt * 3.0f);
            if (prev < 0.1f && et.current_emission >= 0.1f) {
                std::fprintf(stderr, "[EmissiveToggle] Glow ON (emission=%.2f, color=%.1f,%.1f,%.1f)\n",
                    et.current_emission, et.color_r, et.color_g, et.color_b);
            }
            if (prev >= 0.1f && et.current_emission < 0.1f) {
                std::fprintf(stderr, "[EmissiveToggle] Glow OFF\n");
            }
        });
    static bool logged_once = false;
    if (!logged_once) {
        std::fprintf(stderr, "[EmissiveToggle] System running: %d entities with EmissiveToggle+ProximityTrigger\n", count);
        logged_once = true;
    }
}

}  // namespace gseurat
