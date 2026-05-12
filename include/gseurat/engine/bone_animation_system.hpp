#pragma once

#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/render_state.hpp"

#include <glm/glm.hpp>
#include <cstdint>

namespace gseurat {

class BoneAnimationRegistry;
struct GsTerrainState;

/// Engine-level bone animation update. Iterates BoneAnimatedTag entities,
/// lazy-initializes from character manifests, advances animation playback.
void bone_animation_system(ecs::World& world, float dt, BoneAnimationRegistry& registry);

/// Phase 4b: write NPC bone transforms into a RenderState bones writer.
/// Writes transforms at [first_bone_index .. first_bone_index + bone_count)
/// for each initialized entry. Writer's internal capacity bounds the writes.
void gather_bone_animation_transforms(
    const BoneAnimationRegistry& registry,
    BonesWriter& writer);

/// Populate registry from BoneAllocation data + existing BoneAnimatedTag ECS entities.
/// Matches allocations to entities by comparing world positions (< 1.0 unit tolerance).
void populate_bone_animation_registry(
    BoneAnimationRegistry& registry,
    ecs::World& world,
    const GsTerrainState& terrain);

}  // namespace gseurat
