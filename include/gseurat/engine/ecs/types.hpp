#pragma once

#include <cstdint>
#include <functional>

namespace gseurat::ecs {

struct Entity {
    uint32_t id = 0;

    bool valid() const { return id != 0; }

    bool operator==(const Entity& other) const = default;
    auto operator<=>(const Entity& other) const = default;
};

inline constexpr Entity kNullEntity{0};

using ComponentId = uint32_t;

}  // namespace gseurat::ecs

template <>
struct std::hash<gseurat::ecs::Entity> {
    size_t operator()(const gseurat::ecs::Entity& e) const noexcept {
        return std::hash<uint32_t>{}(e.id);
    }
};
