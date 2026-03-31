#include "gseurat/engine/island_systems.hpp"
#include "gseurat/engine/island_components.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include <cmath>

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
    if (!found) return;

    world.view<ProximityTrigger, ecs::Transform>().each(
        [&](ecs::Entity, ProximityTrigger& pt, ecs::Transform& t) {
            if (pt.one_shot && pt.was_triggered) {
                pt.triggered = true;
                return;
            }
            float dx = t.position.x - player_pos.x;
            float dz = t.position.z - player_pos.z;
            float dist = std::sqrt(dx * dx + dz * dz);
            pt.triggered = dist < pt.radius;
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
    world.view<EmissiveToggle, ProximityTrigger>().each(
        [&](ecs::Entity, EmissiveToggle& et, ProximityTrigger& pt) {
            float target = pt.triggered ? et.emission : 0.0f;
            et.current_emission += (target - et.current_emission) * std::min(1.0f, dt * 3.0f);
        });
}

}  // namespace gseurat
