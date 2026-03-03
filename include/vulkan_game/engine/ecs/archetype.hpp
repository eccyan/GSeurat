#pragma once

#include "vulkan_game/engine/ecs/component.hpp"
#include "vulkan_game/engine/ecs/types.hpp"

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <cstring>
#include <functional>
#include <unordered_map>
#include <vector>

namespace vulkan_game::ecs {

using TypeSet = std::vector<ComponentId>;

struct ComponentColumn {
    std::vector<std::byte> data;
    size_t element_size = 0;
    std::function<void(void*)> destructor;
    std::function<void(void* dst, void* src)> move_fn;

    void* at(size_t index) {
        return data.data() + index * element_size;
    }

    const void* at(size_t index) const {
        return data.data() + index * element_size;
    }

    void push_default() {
        data.resize(data.size() + element_size, std::byte{0});
    }

    void push_from(const void* src) {
        size_t old_size = data.size();
        data.resize(old_size + element_size);
        std::memcpy(data.data() + old_size, src, element_size);
    }

    void swap_and_pop(size_t index) {
        size_t last = count() - 1;
        if (index != last) {
            void* dst = at(index);
            void* src = at(last);
            if (move_fn) {
                move_fn(dst, src);
            } else {
                std::memcpy(dst, src, element_size);
            }
        }
        // Destroy the last element
        if (destructor) {
            destructor(at(last));
        }
        data.resize(data.size() - element_size);
    }

    size_t count() const {
        return element_size > 0 ? data.size() / element_size : 0;
    }
};

class Archetype {
public:
    TypeSet type_set;
    std::vector<Entity> entities;
    std::unordered_map<ComponentId, ComponentColumn> columns;
    std::unordered_map<uint32_t, size_t> entity_to_index;

    bool has_component(ComponentId id) const {
        return columns.contains(id);
    }

    bool matches(const TypeSet& required) const {
        for (auto cid : required) {
            if (!columns.contains(cid)) return false;
        }
        return true;
    }

    size_t size() const { return entities.size(); }

    template <typename T>
    void add_column() {
        ComponentId cid = component_id<T>();
        if (columns.contains(cid)) return;

        ComponentColumn col;
        col.element_size = sizeof(T);
        col.destructor = [](void* ptr) {
            static_cast<T*>(ptr)->~T();
        };
        col.move_fn = [](void* dst, void* src) {
            *static_cast<T*>(dst) = std::move(*static_cast<T*>(src));
        };
        columns[cid] = std::move(col);
    }

    void copy_column_meta(ComponentId cid, const ComponentColumn& src_col) {
        if (columns.contains(cid)) return;
        ComponentColumn col;
        col.element_size = src_col.element_size;
        col.destructor = src_col.destructor;
        col.move_fn = src_col.move_fn;
        columns[cid] = std::move(col);
    }

    size_t add_entity(Entity e) {
        size_t idx = entities.size();
        entities.push_back(e);
        entity_to_index[e.id] = idx;
        // Push default for all columns
        for (auto& [cid, col] : columns) {
            col.push_default();
        }
        return idx;
    }

    void remove_entity(Entity e) {
        auto it = entity_to_index.find(e.id);
        if (it == entity_to_index.end()) return;
        size_t idx = it->second;
        size_t last = entities.size() - 1;

        // Swap-and-pop in all columns
        for (auto& [cid, col] : columns) {
            col.swap_and_pop(idx);
        }

        // Update entity list
        if (idx != last) {
            Entity moved = entities[last];
            entities[idx] = moved;
            entity_to_index[moved.id] = idx;
        }
        entities.pop_back();
        entity_to_index.erase(e.id);
    }

    template <typename T>
    T& get(Entity e) {
        size_t idx = entity_to_index.at(e.id);
        ComponentId cid = component_id<T>();
        return *static_cast<T*>(columns.at(cid).at(idx));
    }

    template <typename T>
    const T& get(Entity e) const {
        size_t idx = entity_to_index.at(e.id);
        ComponentId cid = component_id<T>();
        return *static_cast<const T*>(columns.at(cid).at(idx));
    }

    template <typename T>
    void set(Entity e, T value) {
        size_t idx = entity_to_index.at(e.id);
        ComponentId cid = component_id<T>();
        *static_cast<T*>(columns.at(cid).at(idx)) = std::move(value);
    }

    template <typename T>
    T* get_column_data() {
        ComponentId cid = component_id<T>();
        auto it = columns.find(cid);
        if (it == columns.end()) return nullptr;
        return static_cast<T*>(static_cast<void*>(it->second.data.data()));
    }
};

}  // namespace vulkan_game::ecs
