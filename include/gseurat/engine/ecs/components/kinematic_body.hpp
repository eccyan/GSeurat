#pragma once

#include <glm/glm.hpp>
#include <nlohmann/json.hpp>

namespace gseurat {

struct KinematicBody {
    glm::vec3 velocity{0.0f};
    float gravity_scale{1.0f};
    bool grounded{false};
    glm::vec3 ground_normal{0, 1, 0};

    // Designer-facing parameters (serialized)
    float desired_jump_height{2.0f};
    float time_to_apex{0.4f};

    // Derived at load / parameter change (NOT serialized)
    float derived_gravity{0.0f};
    float derived_jump_velocity{0.0f};

    void recompute_derived() {
        if (time_to_apex > 0.0f) {
            derived_gravity = (2.0f * desired_jump_height) / (time_to_apex * time_to_apex);
            derived_jump_velocity = 2.0f * desired_jump_height / time_to_apex;
        }
    }
};

// ── JSON serialization ────────────────────────────────────────────

inline KinematicBody kinematic_body_from_json(const nlohmann::json& j) {
    KinematicBody kb;
    if (j.contains("gravity_scale")) kb.gravity_scale = j["gravity_scale"].get<float>();
    if (j.contains("desired_jump_height")) kb.desired_jump_height = j["desired_jump_height"].get<float>();
    if (j.contains("time_to_apex")) kb.time_to_apex = j["time_to_apex"].get<float>();
    kb.recompute_derived();
    return kb;
}

inline nlohmann::json kinematic_body_to_json(const KinematicBody& kb) {
    return {
        {"gravity_scale", kb.gravity_scale},
        {"desired_jump_height", kb.desired_jump_height},
        {"time_to_apex", kb.time_to_apex}
    };
}

}  // namespace gseurat
