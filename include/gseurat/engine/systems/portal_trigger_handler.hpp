#pragma once

#include "gseurat/engine/ecs/world.hpp"

namespace gseurat {

/// Consumes ProximityTrigger.triggered on entities that also have PortalTarget
/// and spawns a transient SceneTransition entity. Enforces the one-transition-
/// at-a-time invariant by checking for existing ScreenFade entities.
/// @param interact_pressed  true if the player pressed the interact key this frame
void portal_trigger_handler(ecs::World& world, bool interact_pressed = false);

}  // namespace gseurat
