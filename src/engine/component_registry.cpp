#include "gseurat/engine/component_registry.hpp"

#include <algorithm>

namespace gseurat {

void ComponentRegistry::attach(ecs::World& world, ecs::Entity entity,
                               const std::string& name,
                               const nlohmann::json& data) {
    auto it = entries_.find(name);
    if (it == entries_.end()) return;
    it->second.attach_fn(world, entity, data);
}

nlohmann::json ComponentRegistry::serialize(ecs::World& world,
                                            ecs::Entity entity,
                                            const std::string& name) {
    auto it = entries_.find(name);
    if (it == entries_.end()) return nullptr;
    return it->second.serialize_fn(world, entity);
}

std::vector<std::string> ComponentRegistry::registered_names() const {
    std::vector<std::string> names;
    names.reserve(entries_.size());
    for (const auto& [name, _] : entries_) {
        names.push_back(name);
    }
    std::sort(names.begin(), names.end());
    return names;
}

}  // namespace gseurat
