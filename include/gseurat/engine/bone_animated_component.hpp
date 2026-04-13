// include/gseurat/engine/bone_animated_component.hpp
#pragma once

#include <cstdint>

namespace gseurat {

/// Marker component for bone-animated entities.
/// Actual animation state lives in BoneAnimationRegistry (side map).
/// Stored in ECS archetype (trivially copyable).
struct BoneAnimatedTag {
    uint32_t registry_id = 0;  // key into BoneAnimationRegistry
};

}  // namespace gseurat
