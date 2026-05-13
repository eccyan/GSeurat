#pragma once

// Phase 4d-2: Point-lights loaded event.
//
// Emitted by scene-load paths (gs_scene_loader at finalize, command
// dispatcher on update_scene_data, dev panels on user edit) when the
// set of static scene lights changes. Consumed by
// `gseurat::systems::LightingSystem` which stores the static set and
// merges it with VFX-emitted lights once per frame.
//
// An empty payload means "clear the static set" — the consumer also
// resets `light_mode` to 0 to mirror the prior command_dispatcher
// behavior.

#include "gseurat/engine/types.hpp"

#include <vector>

namespace gseurat {

struct PointLightsLoadedEvent {
    std::vector<PointLight> lights;
};

}  // namespace gseurat
