#pragma once

#include "vulkan_game/engine/ecs/archetype.hpp"
#include "vulkan_game/engine/ecs/component.hpp"
#include "vulkan_game/engine/ecs/types.hpp"
#include "vulkan_game/engine/ecs/view.hpp"

#include <algorithm>
#include <memory>
#include <unordered_map>
#include <vector>

namespace vulkan_game::ecs {

class World {
public:
    Entity create() {
        Entity e{next_id_++};
        entity_archetype_[e.id] = nullptr;
        return e;
    }

    void destroy(Entity e) {
        auto it = entity_archetype_.find(e.id);
        if (it == entity_archetype_.end()) return;
        if (it->second) {
            it->second->remove_entity(e);
        }
        entity_archetype_.erase(it);
    }

    template <typename T>
    void add(Entity e, T value = T{}) {
        auto it = entity_archetype_.find(e.id);
        if (it == entity_archetype_.end()) return;

        Archetype* old_arch = it->second;

        // Compute new type set
        TypeSet new_set;
        if (old_arch) {
            new_set = old_arch->type_set;
        }
        ComponentId cid = component_id<T>();

        // Already has this component?
        if (std::find(new_set.begin(), new_set.end(), cid) != new_set.end()) {
            // Just update the value
            if (old_arch) {
                old_arch->set(e, std::move(value));
            }
            return;
        }

        new_set.push_back(cid);
        std::sort(new_set.begin(), new_set.end());

        Archetype* new_arch = find_or_create_archetype(new_set);

        // Ensure the new archetype has a column for T
        new_arch->add_column<T>();

        // Move entity from old to new archetype
        if (old_arch) {
            move_entity(e, old_arch, new_arch);
        } else {
            new_arch->add_entity(e);
        }

        // Set the new component value
        new_arch->set(e, std::move(value));
        entity_archetype_[e.id] = new_arch;
    }

    template <typename T>
    void remove(Entity e) {
        auto it = entity_archetype_.find(e.id);
        if (it == entity_archetype_.end() || !it->second) return;

        Archetype* old_arch = it->second;
        ComponentId cid = component_id<T>();

        TypeSet new_set;
        for (auto id : old_arch->type_set) {
            if (id != cid) new_set.push_back(id);
        }

        if (new_set.empty()) {
            old_arch->remove_entity(e);
            entity_archetype_[e.id] = nullptr;
            return;
        }

        Archetype* new_arch = find_or_create_archetype(new_set);
        move_entity(e, old_arch, new_arch);
        entity_archetype_[e.id] = new_arch;
    }

    template <typename T>
    T& get(Entity e) {
        Archetype* arch = entity_archetype_.at(e.id);
        return arch->get<T>(e);
    }

    template <typename T>
    const T& get(Entity e) const {
        const Archetype* arch = entity_archetype_.at(e.id);
        return arch->get<T>(e);
    }

    template <typename T>
    T* try_get(Entity e) {
        auto it = entity_archetype_.find(e.id);
        if (it == entity_archetype_.end() || !it->second) return nullptr;
        if (!it->second->has_component(component_id<T>())) return nullptr;
        return &it->second->get<T>(e);
    }

    template <typename T>
    bool has(Entity e) const {
        auto it = entity_archetype_.find(e.id);
        if (it == entity_archetype_.end() || !it->second) return false;
        return it->second->has_component(component_id<T>());
    }

    template <typename... Ts>
    View<Ts...> view() {
        TypeSet required = {component_id<Ts>()...};
        std::vector<Archetype*> matching;
        for (auto& arch : archetypes_) {
            if (arch->matches(required)) {
                matching.push_back(arch.get());
            }
        }
        return View<Ts...>(std::move(matching));
    }

    template <typename... Ts>
    Entity create_with(Ts... components) {
        Entity e = create();
        (add<Ts>(e, std::move(components)), ...);
        return e;
    }

private:
    Archetype* find_or_create_archetype(const TypeSet& type_set) {
        for (auto& arch : archetypes_) {
            if (arch->type_set == type_set) return arch.get();
        }
        auto arch = std::make_unique<Archetype>();
        arch->type_set = type_set;
        // Initialize columns for known types — they'll be added via add_column<T> calls
        auto* ptr = arch.get();
        archetypes_.push_back(std::move(arch));
        return ptr;
    }

    void move_entity(Entity e, Archetype* from, Archetype* to) {
        // Ensure destination has columns for all types from source
        for (auto& [cid, src_col] : from->columns) {
            to->copy_column_meta(cid, src_col);
        }

        size_t from_idx = from->entity_to_index.at(e.id);

        // Add entity to new archetype (pushes zero-initialized slots)
        to->add_entity(e);

        // Move data from shared columns (move semantics to avoid double-free)
        size_t to_idx = to->entity_to_index.at(e.id);
        for (auto& [cid, to_col] : to->columns) {
            auto from_it = from->columns.find(cid);
            if (from_it != from->columns.end()) {
                void* dst = to_col.at(to_idx);
                void* src = from_it->second.at(from_idx);
                if (to_col.move_fn) {
                    to_col.move_fn(dst, src);
                } else {
                    std::memcpy(dst, src, to_col.element_size);
                }
            }
        }

        // Remove from old archetype (destructors run on moved-from sources)
        from->remove_entity(e);
    }

    uint32_t next_id_ = 1;
    std::vector<std::unique_ptr<Archetype>> archetypes_;
    std::unordered_map<uint32_t, Archetype*> entity_archetype_;
};

}  // namespace vulkan_game::ecs
