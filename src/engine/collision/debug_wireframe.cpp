#include "gseurat/engine/collision/debug_wireframe.hpp"

#include <cmath>
#include <numbers>

namespace gseurat {

namespace {

constexpr float kPi = std::numbers::pi_v<float>;
constexpr float kTwoPi = 2.0f * kPi;

void generate_cube(std::vector<glm::vec3>& verts, WireframeMeshRange& range) {
    range.offset = static_cast<uint32_t>(verts.size());

    // 8 corners of a [-1,1]^3 cube
    glm::vec3 corners[8] = {
        {-1, -1, -1}, { 1, -1, -1}, { 1,  1, -1}, {-1,  1, -1},
        {-1, -1,  1}, { 1, -1,  1}, { 1,  1,  1}, {-1,  1,  1}
    };

    // 12 edges: bottom face, top face, verticals
    constexpr int edges[12][2] = {
        {0, 1}, {1, 2}, {2, 3}, {3, 0},  // bottom
        {4, 5}, {5, 6}, {6, 7}, {7, 4},  // top
        {0, 4}, {1, 5}, {2, 6}, {3, 7}   // verticals
    };

    for (const auto& e : edges) {
        verts.push_back(corners[e[0]]);
        verts.push_back(corners[e[1]]);
    }

    range.count = static_cast<uint32_t>(verts.size()) - range.offset;  // 24
}

void generate_sphere(std::vector<glm::vec3>& verts, WireframeMeshRange& range) {
    range.offset = static_cast<uint32_t>(verts.size());

    constexpr int segments = 32;

    // XY plane circle
    for (int i = 0; i < segments; ++i) {
        float a1 = kTwoPi * static_cast<float>(i) / static_cast<float>(segments);
        float a2 = kTwoPi * static_cast<float>(i + 1) / static_cast<float>(segments);
        verts.push_back({std::cos(a1), std::sin(a1), 0.0f});
        verts.push_back({std::cos(a2), std::sin(a2), 0.0f});
    }

    // XZ plane circle
    for (int i = 0; i < segments; ++i) {
        float a1 = kTwoPi * static_cast<float>(i) / static_cast<float>(segments);
        float a2 = kTwoPi * static_cast<float>(i + 1) / static_cast<float>(segments);
        verts.push_back({std::cos(a1), 0.0f, std::sin(a1)});
        verts.push_back({std::cos(a2), 0.0f, std::sin(a2)});
    }

    // YZ plane circle
    for (int i = 0; i < segments; ++i) {
        float a1 = kTwoPi * static_cast<float>(i) / static_cast<float>(segments);
        float a2 = kTwoPi * static_cast<float>(i + 1) / static_cast<float>(segments);
        verts.push_back({0.0f, std::cos(a1), std::sin(a1)});
        verts.push_back({0.0f, std::cos(a2), std::sin(a2)});
    }

    range.count = static_cast<uint32_t>(verts.size()) - range.offset;  // 192
}

void generate_capsule(std::vector<glm::vec3>& verts, WireframeMeshRange& range) {
    range.offset = static_cast<uint32_t>(verts.size());

    constexpr int segments = 32;
    constexpr int half_segments = segments / 2;

    // The capsule is oriented along Y. The cylinder region spans y in [-0.5, +0.5].
    // Hemispheres extend beyond: top cap y > 0.5, bottom cap y < -0.5.
    // The shader uses this Y convention to scale by radius/half_height.

    // ── Top hemisphere: 2 half-circles (XY and ZY planes, y > 0.5) ──
    for (int i = 0; i < half_segments; ++i) {
        float a1 = kPi * static_cast<float>(i) / static_cast<float>(half_segments);       // 0 to PI
        float a2 = kPi * static_cast<float>(i + 1) / static_cast<float>(half_segments);
        // XY plane arc, y >= 0.5
        verts.push_back({std::sin(a1), 0.5f + std::cos(a1) * 0.5f, 0.0f});
        verts.push_back({std::sin(a2), 0.5f + std::cos(a2) * 0.5f, 0.0f});
    }
    for (int i = 0; i < half_segments; ++i) {
        float a1 = kPi * static_cast<float>(i) / static_cast<float>(half_segments);
        float a2 = kPi * static_cast<float>(i + 1) / static_cast<float>(half_segments);
        // ZY plane arc, y >= 0.5
        verts.push_back({0.0f, 0.5f + std::cos(a1) * 0.5f, std::sin(a1)});
        verts.push_back({0.0f, 0.5f + std::cos(a2) * 0.5f, std::sin(a2)});
    }

    // ── Bottom hemisphere: 2 half-circles (XY and ZY planes, y < -0.5) ──
    for (int i = 0; i < half_segments; ++i) {
        float a1 = kPi + kPi * static_cast<float>(i) / static_cast<float>(half_segments);  // PI to 2PI
        float a2 = kPi + kPi * static_cast<float>(i + 1) / static_cast<float>(half_segments);
        // XY plane arc, y <= -0.5
        verts.push_back({std::sin(a1), -0.5f + std::cos(a1) * 0.5f, 0.0f});
        verts.push_back({std::sin(a2), -0.5f + std::cos(a2) * 0.5f, 0.0f});
    }
    for (int i = 0; i < half_segments; ++i) {
        float a1 = kPi + kPi * static_cast<float>(i) / static_cast<float>(half_segments);
        float a2 = kPi + kPi * static_cast<float>(i + 1) / static_cast<float>(half_segments);
        // ZY plane arc, y <= -0.5
        verts.push_back({0.0f, -0.5f + std::cos(a1) * 0.5f, std::sin(a1)});
        verts.push_back({0.0f, -0.5f + std::cos(a2) * 0.5f, std::sin(a2)});
    }

    // ── Top equator circle (at y = +0.5, in cylinder region) ──
    for (int i = 0; i < segments; ++i) {
        float a1 = kTwoPi * static_cast<float>(i) / static_cast<float>(segments);
        float a2 = kTwoPi * static_cast<float>(i + 1) / static_cast<float>(segments);
        verts.push_back({std::cos(a1), 0.5f, std::sin(a1)});
        verts.push_back({std::cos(a2), 0.5f, std::sin(a2)});
    }

    // ── Bottom equator circle (at y = -0.5, in cylinder region) ──
    for (int i = 0; i < segments; ++i) {
        float a1 = kTwoPi * static_cast<float>(i) / static_cast<float>(segments);
        float a2 = kTwoPi * static_cast<float>(i + 1) / static_cast<float>(segments);
        verts.push_back({std::cos(a1), -0.5f, std::sin(a1)});
        verts.push_back({std::cos(a2), -0.5f, std::sin(a2)});
    }

    // ── 4 vertical lines connecting equators ──
    verts.push_back({ 1.0f,  0.5f,  0.0f});
    verts.push_back({ 1.0f, -0.5f,  0.0f});
    verts.push_back({-1.0f,  0.5f,  0.0f});
    verts.push_back({-1.0f, -0.5f,  0.0f});
    verts.push_back({ 0.0f,  0.5f,  1.0f});
    verts.push_back({ 0.0f, -0.5f,  1.0f});
    verts.push_back({ 0.0f,  0.5f, -1.0f});
    verts.push_back({ 0.0f, -0.5f, -1.0f});

    range.count = static_cast<uint32_t>(verts.size()) - range.offset;
}

}  // namespace

WireframeMeshData generate_wireframe_meshes() {
    WireframeMeshData data;
    data.vertices.reserve(512);

    generate_cube(data.vertices, data.cube);
    generate_sphere(data.vertices, data.sphere);
    generate_capsule(data.vertices, data.capsule);

    return data;
}

}  // namespace gseurat
