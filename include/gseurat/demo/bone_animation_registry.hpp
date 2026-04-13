#pragma once

#include "gseurat/character/bone_animation_player.hpp"
#include "gseurat/character/bone_animation_state_machine.hpp"
#include "gseurat/character/character_manifest.hpp"
#include "gseurat/engine/ecs/types.hpp"

#include <glm/glm.hpp>
#include <memory>
#include <string>
#include <unordered_map>

namespace gseurat {

struct BoneAnimationEntry {
    std::string manifest_path;
    std::string default_clip;
    std::string requested_clip;       // set by behavior systems
    uint32_t first_bone_index = 0;
    uint32_t bone_count = 0;
    float char_scale = 1.0f;         // from game object scale
    float gs_scale_multiplier = 1.0f; // scene scale_multiplier
    glm::vec3 spawn_pos{0.0f};       // initial world position (for bone transform anchoring)
    glm::vec3 current_pos{0.0f};     // updated by walker system
    float facing_angle = 0.0f;       // updated by walker system

    // Lazy-initialized
    std::unique_ptr<CharacterData> character_data;
    std::unique_ptr<BoneAnimationPlayer> anim_player;
    std::unique_ptr<BoneAnimationStateMachine> anim_sm;
    bool initialized = false;
};

class BoneAnimationRegistry {
public:
    uint32_t add(ecs::Entity entity, BoneAnimationEntry entry) {
        uint32_t id = next_id_++;
        entries_[id] = std::move(entry);
        entity_to_id_[entity] = id;
        return id;
    }

    BoneAnimationEntry* get(uint32_t id) {
        auto it = entries_.find(id);
        return it != entries_.end() ? &it->second : nullptr;
    }

    BoneAnimationEntry* get_by_entity(ecs::Entity entity) {
        auto it = entity_to_id_.find(entity);
        if (it == entity_to_id_.end()) return nullptr;
        return get(it->second);
    }

    void clear() {
        // Leak CharacterData — its destructor crashes on macOS (known allocator issue)
        for (auto& [id, entry] : entries_) {
            (void)entry.character_data.release();
            (void)entry.anim_player.release();
            (void)entry.anim_sm.release();
        }
        entries_.clear();
        entity_to_id_.clear();
        next_id_ = 1;
    }

    const std::unordered_map<uint32_t, BoneAnimationEntry>& entries() const {
        return entries_;
    }

private:
    std::unordered_map<uint32_t, BoneAnimationEntry> entries_;
    std::unordered_map<ecs::Entity, uint32_t> entity_to_id_;
    uint32_t next_id_ = 1;
};

}  // namespace gseurat
