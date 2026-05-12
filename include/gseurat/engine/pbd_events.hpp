#pragma once

// Phase 4d-1: PBD elements loaded event.
//
// Emitted by scene-load paths (gs_scene_loader during initial finalize,
// IslandDemoState during chunk-load) when a batch of PBD-tagged elements
// is ready for the GPU PBD solver. Consumed by `gseurat::systems::PbdSystem`
// which forwards the upload to `GsRenderer::upload_pbd_elements`.
//
// Carries the prepared GPU state directly (rather than the
// PbdConfig+anchor pairs) since producers already compose these on
// their side. Future iterations may shift composition into the system,
// but that's not required for the 4d-1 wiring refactor.

#include "gseurat/engine/pbd_types.hpp"

#include <vector>

namespace gseurat {

struct PbdElementsLoadedEvent {
    std::vector<PbdPhysicsState> states;
    std::vector<PbdElementParams> params;
};

}  // namespace gseurat
