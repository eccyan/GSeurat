#pragma once

namespace gseurat {

/// Marks an entity as the player-controlled character.
/// Presence triggers auto-attachment of PlayerTag during scene load.
struct PlayerController {
    float speed = 20.0f;        // movement speed (units/sec)
    float acceleration = 20.0f; // velocity blend rate
};

}  // namespace gseurat
