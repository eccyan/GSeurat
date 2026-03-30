#pragma once

#include <glm/glm.hpp>
#include <vector>

namespace gseurat {

/// Catmull-Rom spline that passes through control points.
/// Uniform parameterization: t in [0,1] maps linearly across segments.
struct SplinePath {
    std::vector<glm::vec3> control_points;

    /// Evaluate position at global parameter t in [0,1].
    glm::vec3 evaluate(float t) const;

    /// Evaluate tangent (first derivative) at t.
    glm::vec3 tangent(float t) const;

    /// Approximate arc length by polyline sampling.
    float length_approx(int samples = 64) const;

    /// Valid if >= 2 control points.
    bool valid() const { return control_points.size() >= 2; }
};

enum class SplineMode {
    None,           // no spline (default, backward compatible)
    EmitterPath,    // emitter position moves along spline
    ParticlePath,   // particles follow spline mapped to lifetime
};

struct SplineConfig {
    SplineMode mode = SplineMode::None;
    SplinePath path;
    float emitter_speed = 1.0f;     // EmitterPath: cycles per second
    float path_spread = 0.0f;       // ParticlePath: random lateral offset
    bool align_to_tangent = false;  // ParticlePath: orient to curve direction
};

}  // namespace gseurat
