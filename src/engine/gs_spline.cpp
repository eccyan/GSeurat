#include "gseurat/engine/gs_spline.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

// Catmull-Rom evaluation for four control points and local t in [0,1].
// q(t) = 0.5 * ((2*P1) + (-P0+P2)*t + (2*P0-5*P1+4*P2-P3)*t^2 + (-P0+3*P1-3*P2+P3)*t^3)
static glm::vec3 catmull_rom(const glm::vec3& p0, const glm::vec3& p1,
                              const glm::vec3& p2, const glm::vec3& p3, float t) {
    float t2 = t * t;
    float t3 = t2 * t;
    return 0.5f * ((2.0f * p1) +
                   (-p0 + p2) * t +
                   (2.0f * p0 - 5.0f * p1 + 4.0f * p2 - p3) * t2 +
                   (-p0 + 3.0f * p1 - 3.0f * p2 + p3) * t3);
}

// First derivative of the Catmull-Rom polynomial.
static glm::vec3 catmull_rom_deriv(const glm::vec3& p0, const glm::vec3& p1,
                                    const glm::vec3& p2, const glm::vec3& p3, float t) {
    float t2 = t * t;
    return 0.5f * ((-p0 + p2) +
                   (4.0f * p0 - 10.0f * p1 + 8.0f * p2 - 2.0f * p3) * t +
                   (-3.0f * p0 + 9.0f * p1 - 9.0f * p2 + 3.0f * p3) * t2);
}

// Get the four control points for a segment, synthesizing ghost points at endpoints.
static void segment_points(const std::vector<glm::vec3>& pts, int seg,
                           glm::vec3& p0, glm::vec3& p1, glm::vec3& p2, glm::vec3& p3) {
    int n = static_cast<int>(pts.size());
    p1 = pts[seg];
    p2 = pts[seg + 1];
    p0 = (seg > 0) ? pts[seg - 1] : (2.0f * p1 - p2);         // ghost: reflect
    p3 = (seg + 2 < n) ? pts[seg + 2] : (2.0f * p2 - p1);     // ghost: reflect
}

glm::vec3 SplinePath::evaluate(float t) const {
    if (!valid()) return glm::vec3(0.0f);

    int n = static_cast<int>(control_points.size());
    int segments = n - 1;

    t = std::clamp(t, 0.0f, 1.0f);
    float scaled = t * static_cast<float>(segments);
    int seg = std::min(static_cast<int>(scaled), segments - 1);
    float local_t = scaled - static_cast<float>(seg);

    glm::vec3 p0, p1, p2, p3;
    segment_points(control_points, seg, p0, p1, p2, p3);
    return catmull_rom(p0, p1, p2, p3, local_t);
}

glm::vec3 SplinePath::tangent(float t) const {
    if (!valid()) return glm::vec3(0.0f);

    int n = static_cast<int>(control_points.size());
    int segments = n - 1;

    t = std::clamp(t, 0.0f, 1.0f);
    float scaled = t * static_cast<float>(segments);
    int seg = std::min(static_cast<int>(scaled), segments - 1);
    float local_t = scaled - static_cast<float>(seg);

    glm::vec3 p0, p1, p2, p3;
    segment_points(control_points, seg, p0, p1, p2, p3);
    return catmull_rom_deriv(p0, p1, p2, p3, local_t);
}

float SplinePath::length_approx(int samples) const {
    if (!valid() || samples < 2) return 0.0f;

    float total = 0.0f;
    glm::vec3 prev = evaluate(0.0f);
    for (int i = 1; i <= samples; ++i) {
        float t = static_cast<float>(i) / static_cast<float>(samples);
        glm::vec3 cur = evaluate(t);
        total += glm::length(cur - prev);
        prev = cur;
    }
    return total;
}

}  // namespace gseurat
