#pragma once

#include <glm/glm.hpp>
#include <cstdint>

namespace gseurat {

// GPU PBD state per element (std430, 4 × vec4 = 64 bytes)
struct PbdPhysicsState {
    glm::vec4 position;       // xyz = current position, w = inv_mass (0 = pinned)
    glm::vec4 prev_position;  // xyz = previous frame position, w = unused
    glm::vec4 velocity;       // xyz = current velocity, w = unused
    glm::vec4 params;         // x = sway_threshold, yzw = unused (reserved)
};

// Distance constraint between two PBD elements (std430, 2 × vec4 = 32 bytes)
struct PbdConstraint {
    glm::uvec4 indices;  // x = element_a, y = element_b, zw = unused
    glm::vec4 params;    // x = rest_length, y = stiffness (0-1), zw = unused
};

// Per-element simulation parameters (std430, 3 × vec4 = 48 bytes)
struct PbdElementParams {
    glm::vec4 gravity;   // xyz = gravity vector, w = damping (0-1)
    glm::vec4 wind;      // xyz = wind direction, w = wind_strength
    glm::vec4 dynamics;  // x = wind_frequency, y = ground_y (collision plane), z = bounce, w = unused
};

// Limits
static constexpr uint32_t kMaxPbdElements = 64;
static constexpr uint32_t kMaxPbdConstraints = 128;
static constexpr uint32_t kPbdSolverIterations = 4;

}  // namespace gseurat
