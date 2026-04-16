#pragma once

#include "gseurat/engine/ecs/world.hpp"

namespace gseurat {

/// Consumes ProximityTrigger.triggered on entities that also have PortalTarget
/// and spawns a transient SceneTransition entity. Enforces the one-transition-
/// at-a-time invariant by checking for existing ScreenFade entities.
void portal_trigger_handler(ecs::World& world);

}  // namespace gseurat
