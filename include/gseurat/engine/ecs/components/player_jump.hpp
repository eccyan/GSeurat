#pragma once

namespace gseurat {

/// Optional jump ability. If absent on the player entity, jump input is ignored.
struct PlayerJump {
    float height = 4.0f;      // peak height in units
    float duration = 0.8f;    // seconds for full arc
    // Runtime state (not serialized to JSON)
    bool active = false;
    float timer = 0.0f;
};

}  // namespace gseurat
