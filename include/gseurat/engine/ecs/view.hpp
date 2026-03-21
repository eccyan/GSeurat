#pragma once

#include "gseurat/engine/ecs/archetype.hpp"
#include "gseurat/engine/ecs/component.hpp"
#include "gseurat/engine/ecs/types.hpp"

#include <tuple>
#include <vector>

namespace gseurat::ecs {

template <typename... Ts>
class View {
public:
    explicit View(std::vector<Archetype*> archetypes)
        : archetypes_(std::move(archetypes)) {}

    template <typename Fn>
    void each(Fn&& fn) {
        for (auto* arch : archetypes_) {
            auto ptrs = std::make_tuple(arch->template get_column_data<Ts>()...);
            for (size_t i = 0; i < arch->size(); ++i) {
                fn(arch->entities[i], std::get<decltype(arch->template get_column_data<Ts>())>(ptrs)[i]...);
            }
        }
    }

    bool empty() const {
        for (auto* arch : archetypes_) {
            if (arch->size() > 0) return false;
        }
        return true;
    }

    size_t count() const {
        size_t total = 0;
        for (auto* arch : archetypes_) {
            total += arch->size();
        }
        return total;
    }

private:
    std::vector<Archetype*> archetypes_;
};

}  // namespace gseurat::ecs
