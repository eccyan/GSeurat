#pragma once

#include "vulkan_game/engine/ecs/world.hpp"
#include "vulkan_game/engine/input_manager.hpp"
#include "vulkan_game/engine/particle.hpp"
#include "vulkan_game/engine/scene.hpp"
#include "vulkan_game/engine/tilemap.hpp"
#include "vulkan_game/engine/types.hpp"

#include <vector>

namespace vulkan_game::ecs::systems {

struct PlayerMoveResult {
    bool moving = false;
    bool sprinting = false;
};

PlayerMoveResult player_movement(World& world, InputManager& input, float dt);
void player_collision(World& world, const TileLayer& layer);
void npc_patrol(World& world, const TileLayer& layer, float dt);
void animation_update(World& world, float dt);
void lighting_rebuild(World& world, Scene& scene, bool include_npc_lights = true, float torch_intensity_mul = 1.0f);
void particle_sync(World& world, ParticleSystem& particles, bool footstep_active);
void sprite_collect(World& world, std::vector<SpriteDrawInfo>& out, bool y_sort = false);
void shadow_collect(World& world, std::vector<SpriteDrawInfo>& out, bool y_sort = false);
void reflection_collect(World& world, const TileLayer& layer, std::vector<SpriteDrawInfo>& out, bool y_sort = false);
void outline_collect(World& world, std::vector<SpriteDrawInfo>& out, float outline_expand, bool y_sort = false);

}  // namespace vulkan_game::ecs::systems
