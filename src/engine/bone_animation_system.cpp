#include "gseurat/engine/bone_animation_system.hpp"
#include "gseurat/engine/bone_animation_registry.hpp"
#include "gseurat/engine/bone_animated_component.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/character/character_manifest.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cstdio>

namespace gseurat {

void bone_animation_system(ecs::World& world, float dt, BoneAnimationRegistry& registry) {
    world.view<BoneAnimatedTag, ecs::Transform>().each(
        [&](ecs::Entity entity, BoneAnimatedTag& tag, ecs::Transform& t) {
            auto* entry = registry.get(tag.registry_id);
            if (!entry) return;

            // Lazy initialization
            if (!entry->initialized) {
                auto manifest = load_character_manifest(entry->manifest_path);
                if (!manifest) return;
                entry->character_data = std::make_unique<CharacterData>(std::move(*manifest));
                entry->anim_player = std::make_unique<BoneAnimationPlayer>(*entry->character_data);
                entry->anim_sm = std::make_unique<BoneAnimationStateMachine>(*entry->anim_player);

                // Register clips as states
                for (const auto& clip : entry->character_data->clips) {
                    entry->anim_sm->add_state(clip.name, clip.name);
                }
                entry->anim_sm->set_state(entry->default_clip);

                entry->spawn_pos = t.position.vec();
                entry->current_pos = t.position.vec();
                entry->initialized = true;
                std::fprintf(stderr, "[BoneAnimSystem] Initialized '%s': %u bones, clip='%s'\n",
                             entry->manifest_path.c_str(), entry->bone_count, entry->default_clip.c_str());
            }

            // Update position from Transform (NpcWalker moves this)
            entry->current_pos = t.position.vec();

            // Check for clip change from behavior systems
            if (!entry->requested_clip.empty() &&
                entry->requested_clip != entry->anim_sm->current_state()) {
                entry->anim_sm->set_state(entry->requested_clip);
            }

            // Advance animation
            entry->anim_player->update(dt);
        });
}

uint32_t gather_bone_animation_transforms(
    const BoneAnimationRegistry& registry,
    glm::mat4* bones,
    uint32_t max_bones) {

    uint32_t highest_slot = 0;

    for (const auto& [id, entry] : registry.entries()) {
        if (!entry.initialized || !entry.anim_player) continue;
        if (entry.first_bone_index + entry.bone_count > max_bones) continue;

        const float scale_val = entry.char_scale;
        const glm::vec3 y_off(0.0f, 2.0f, 0.0f);
        const glm::vec3 char_scale(scale_val, scale_val * entry.gs_scale_multiplier, scale_val);
        const glm::vec3 inv_scale(1.0f / char_scale.x, 1.0f / char_scale.y, 1.0f / char_scale.z);

        glm::mat4 from_world =
            glm::rotate(glm::mat4(1.0f), -glm::pi<float>(), {0, 1, 0}) *
            glm::scale(glm::mat4(1.0f), inv_scale) *
            glm::translate(glm::mat4(1.0f), -(entry.spawn_pos + y_off));

        glm::quat rot = glm::angleAxis(entry.facing_angle, glm::vec3(0, 1, 0));
        glm::vec3 effective_pos = entry.current_pos;
        effective_pos.y += entry.y_offset;
        glm::mat4 to_world =
            glm::translate(glm::mat4(1.0f), effective_pos + y_off) *
            glm::mat4_cast(rot) *
            glm::scale(glm::mat4(1.0f), char_scale) *
            glm::rotate(glm::mat4(1.0f), glm::pi<float>(), {0, 1, 0});

        const auto& npc_bones = entry.anim_player->bone_transforms();
        for (uint32_t i = 0; i < entry.bone_count && (entry.first_bone_index + i) < max_bones; ++i) {
            bones[entry.first_bone_index + i] = to_world * npc_bones[i] * from_world;
        }

        uint32_t end_slot = entry.first_bone_index + entry.bone_count;
        if (end_slot > highest_slot) highest_slot = end_slot;
    }

    return highest_slot;
}

void populate_bone_animation_registry(
    BoneAnimationRegistry& registry,
    ecs::World& world,
    const GsTerrainState& terrain) {

    registry.clear();

    // Reset all entity tags so re-population works (registry.clear() doesn't touch ECS)
    world.view<BoneAnimatedTag>().each(
        [&](ecs::Entity, BoneAnimatedTag& tag) {
            tag.registry_id = 0;
        });

    for (const auto& alloc : terrain.bone_allocations) {
        world.view<BoneAnimatedTag, ecs::Transform>().each(
            [&](ecs::Entity entity, BoneAnimatedTag& tag, ecs::Transform& t) {
                if (tag.registry_id != 0) return;  // already assigned
                glm::vec3 diff = t.position.vec() - alloc.world_pos;
                if (glm::length(diff) < 1.0f) {
                    BoneAnimationEntry entry;
                    entry.manifest_path = alloc.manifest_path;
                    entry.default_clip = alloc.default_clip;
                    entry.first_bone_index = alloc.first_bone_index;
                    entry.bone_count = alloc.bone_count;
                    entry.char_scale = alloc.char_scale;
                    entry.gs_scale_multiplier = alloc.gs_scale_multiplier;
                    entry.spawn_pos = alloc.world_pos;
                    entry.current_pos = alloc.world_pos;
                    tag.registry_id = registry.add(entity, std::move(entry));
                }
            });
    }
}

}  // namespace gseurat
