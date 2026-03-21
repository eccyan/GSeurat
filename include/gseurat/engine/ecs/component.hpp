#pragma once

#include "gseurat/engine/ecs/types.hpp"

namespace gseurat::ecs {

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

}  // namespace gseurat::ecs
