#pragma once

#include "gseurat/engine/ecs/world.hpp"

#include <nlohmann/json.hpp>

#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace gseurat {

class ComponentRegistry {
public:
    template<typename T>
    void register_component(
        const std::string& name,
        std::function<T(const nlohmann::json&)> from_json,
        std::function<nlohmann::json(const T&)> to_json);

    void attach(ecs::World& world, ecs::Entity entity,
                const std::string& name, const nlohmann::json& data);

    nlohmann::json serialize(ecs::World& world, ecs::Entity entity,
                             const std::string& name);

    std::vector<std::string> registered_names() const;

private:
    struct Entry {
        std::function<void(ecs::World&, ecs::Entity, const nlohmann::json&)> attach_fn;
        std::function<nlohmann::json(ecs::World&, ecs::Entity)> serialize_fn;
    };
    std::unordered_map<std::string, Entry> entries_;
};

// ── Template implementation ──

template<typename T>
void ComponentRegistry::register_component(
    const std::string& name,
    std::function<T(const nlohmann::json&)> from_json,
    std::function<nlohmann::json(const T&)> to_json)
{
    Entry entry;
    entry.attach_fn = [from_json](ecs::World& world, ecs::Entity entity,
                                   const nlohmann::json& data) {
        world.add<T>(entity, from_json(data));
    };
    entry.serialize_fn = [to_json](ecs::World& world, ecs::Entity entity)
                             -> nlohmann::json {
        auto* comp = world.try_get<T>(entity);
        if (!comp) return nullptr;
        return to_json(*comp);
    };
    entries_[name] = std::move(entry);
}

}  // namespace gseurat
