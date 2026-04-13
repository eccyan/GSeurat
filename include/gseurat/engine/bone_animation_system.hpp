#pragma once

#include "gseurat/engine/ecs/world.hpp"

#include <glm/glm.hpp>
#include <cstdint>

namespace gseurat {

class BoneAnimationRegistry;
struct GsTerrainState;

/// Engine-level bone animation update. Iterates BoneAnimatedTag entities,
/// lazy-initializes from character manifests, advances animation playback.
void bone_animation_system(ecs::World& world, float dt, BoneAnimationRegistry& registry);

/// Gather NPC bone transforms from the registry into a bone array.
/// Writes transforms at [first_bone_index .. first_bone_index + bone_count) for each initialized entry.
/// Returns the highest bone slot used (for total_bones calculation).
[[nodiscard]] uint32_t gather_bone_animation_transforms(
    const BoneAnimationRegistry& registry,
    glm::mat4* bones,
    uint32_t max_bones = 32);

/// Populate registry from BoneAllocation data + existing BoneAnimatedTag ECS entities.
/// Matches allocations to entities by comparing world positions (< 1.0 unit tolerance).
void populate_bone_animation_registry(
    BoneAnimationRegistry& registry,
    ecs::World& world,
    const GsTerrainState& terrain);

}  // namespace gseurat
