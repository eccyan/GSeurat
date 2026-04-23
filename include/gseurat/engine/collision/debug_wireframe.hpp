#pragma once

#include "gseurat/engine/collision/primitive.hpp"
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <vector>
#include <cstdint>

namespace gseurat {

struct DebugColliderDrawInfo {
    glm::mat4 model;
    glm::vec4 color;
    ColliderType shape_type;
    float radius{0.0f};
    float half_height{0.0f};
    glm::vec3 half_extents{0.0f};
};

struct WireframeMeshRange {
    uint32_t offset;  // vertex offset in shared buffer
    uint32_t count;   // vertex count
};

struct WireframeMeshData {
    std::vector<glm::vec3> vertices;  // All shapes concatenated as LINE_LIST
    WireframeMeshRange cube;
    WireframeMeshRange sphere;
    WireframeMeshRange capsule;
};

/// Generate all base wireframe shape meshes (cube, sphere, capsule)
WireframeMeshData generate_wireframe_meshes();

}  // namespace gseurat
