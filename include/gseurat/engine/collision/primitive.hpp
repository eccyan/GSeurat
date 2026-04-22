#pragma once

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <variant>
#include <cstdint>

namespace gseurat {

enum class ColliderType : uint8_t { Box, Sphere, Capsule };

struct BoxData {
    glm::vec3 half_extents{0.5f};
};

struct SphereData {
    float radius{0.5f};
};

struct CapsuleData {
    float radius{0.3f};
    float half_height{0.5f};  // Half the cylinder segment length
    // Total capsule height = 2 * half_height + 2 * radius
};

using ColliderShape = std::variant<BoxData, SphereData, CapsuleData>;

struct RayHit {
    float t;
    glm::vec3 point;
    glm::vec3 normal;
};

struct Contact {
    glm::vec3 point;
    glm::vec3 normal;  // Push-out direction (toward capsule)
    float depth;
};

struct SweepHit {
    float t;            // Fraction of sweep distance [0, 1]
    glm::vec3 point;
    glm::vec3 normal;
};

}  // namespace gseurat
