#pragma once

#include <vulkan/vulkan.h>

#include <array>
#include <cstdint>

#include <glm/glm.hpp>

namespace gseurat {

inline constexpr uint32_t kMaxFramesInFlight = 2;
inline constexpr uint32_t kWindowWidth = 1280;
inline constexpr uint32_t kWindowHeight = 720;
inline constexpr uint32_t kMaxSprites = 2048;

struct Vertex {
    glm::vec3 position;
    glm::vec2 uv;
    glm::vec4 color;

    static VkVertexInputBindingDescription binding_description() {
        return {0, sizeof(Vertex), VK_VERTEX_INPUT_RATE_VERTEX};
    }

    static std::array<VkVertexInputAttributeDescription, 3> attribute_descriptions() {
        return {{
            {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(Vertex, position)},
            {1, 0, VK_FORMAT_R32G32_SFLOAT, offsetof(Vertex, uv)},
            {2, 0, VK_FORMAT_R32G32B32A32_SFLOAT, offsetof(Vertex, color)},
        }};
    }
};

struct PointLight {
    glm::vec4 position_and_radius;  // xy = world XZ, z = height (Y), w = radius
    glm::vec4 color;                // rgb = color, a = intensity
    glm::vec4 area_params{0.0f};    // xy = area width/height (0 = point light), zw = normal XZ
};

inline constexpr uint32_t kMaxLights = 8;

struct UniformBufferObject {
    glm::mat4 vp;                         // 64 bytes
    glm::vec4 ambient_color;              // 16 bytes (rgb, a = strength)
    glm::ivec4 light_params;              // 16 bytes (x = light_count)
    PointLight lights[kMaxLights];        // 256 bytes
};  // 352 bytes total, std140 aligned

// UBO for screen-space light glow in composite pass (GS scenes)
struct LightGlowData {
    glm::mat4 vp;                         // 64 bytes: GS camera view-projection
    glm::ivec4 light_params;              // 16 bytes: x = light_count, y = screen_w, z = screen_h
    PointLight lights[kMaxLights];        // 256 bytes
};  // 336 bytes total

}  // namespace gseurat
