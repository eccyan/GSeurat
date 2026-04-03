#pragma once

#include "gseurat/engine/ecs/world.hpp"

namespace gseurat {

// Pure ECS systems (no engine dependency)
void proximity_trigger_system(ecs::World& world, float dt);
void linked_trigger_system(ecs::World& world, float dt);
void emissive_toggle_system(ecs::World& world, float dt);
void npc_walker_system(ecs::World& world, float dt);

}  // namespace gseurat
