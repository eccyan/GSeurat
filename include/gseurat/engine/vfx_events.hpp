#pragma once

// Phase 4a: VFX spawn event.
//
// Emitted by CommandDispatcher when a scene update brings new VFX into
// existence; consumed by `gseurat::systems::VfxSystem` which loads the
// preset and hands a constructed VfxInstance to the renderer.
//
// Carries the on-disk preset path (rather than a loaded preset object)
// so producers don't pay the cost of preset loading on the dispatch
// thread — the consumer system loads lazily.

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

struct VfxSpawnEvent {
    std::string vfx_file;        // path to .vfx preset
    glm::vec3 position{0.0f};    // world-space position
    float rotation_y = 0.0f;     // yaw rotation in radians
    bool loop = false;           // whether the VfxInstance should loop
};

}  // namespace gseurat
