#pragma once

#include "gseurat/engine/ecs/world.hpp"

namespace gseurat {

// Pure ECS systems (no engine dependency)
void proximity_trigger_system(ecs::World& world, float dt);
void linked_trigger_system(ecs::World& world, float dt);
void emissive_toggle_system(ecs::World& world, float dt);
void npc_walker_system(ecs::World& world, float dt);
void bone_animation_system(ecs::World& world, float dt);

class BoneAnimationRegistry;
void set_bone_animation_registry(BoneAnimationRegistry* reg);
BoneAnimationRegistry* get_bone_animation_registry();

}  // namespace gseurat
