#pragma once

#include "vulkan_game/engine/ecs/types.hpp"

namespace vulkan_game::ecs {

namespace detail {

inline ComponentId next_component_id() {
    static ComponentId counter = 0;
    return counter++;
}

}  // namespace detail

template <typename T>
ComponentId component_id() {
    static const ComponentId id = detail::next_component_id();
    return id;
}

}  // namespace vulkan_game::ecs
