#pragma once

#include <vulkan/vulkan.h>

#include <array>
#include <cstdint>

#include <glm/glm.hpp>

namespace vulkan_game {

inline constexpr uint32_t kMaxFramesInFlight = 2;
inline constexpr uint32_t kWindowWidth = 1280;
inline constexpr uint32_t kWindowHeight = 720;

struct Vertex {
    glm::vec3 position;
    glm::vec2 uv;

    static VkVertexInputBindingDescription binding_description() {
        return {0, sizeof(Vertex), VK_VERTEX_INPUT_RATE_VERTEX};
    }

    static std::array<VkVertexInputAttributeDescription, 2> attribute_descriptions() {
        return {{
            {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(Vertex, position)},
            {1, 0, VK_FORMAT_R32G32_SFLOAT, offsetof(Vertex, uv)},
        }};
    }
};

struct UniformBufferObject {
    glm::mat4 mvp;
};

}  // namespace vulkan_game
