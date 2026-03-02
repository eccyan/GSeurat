#pragma once

#include "vulkan_game/engine/buffer.hpp"
#include "vulkan_game/engine/types.hpp"

#include <array>
#include <vector>

#include <glm/glm.hpp>
#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

namespace vulkan_game {

struct SpriteDrawInfo {
    glm::vec3 position;               // center x, y, z
    glm::vec2 size;                   // width, height
    glm::vec4 color;                  // rgba tint
    glm::vec2 uv_min{0.0f, 0.0f};    // texture UV top-left
    glm::vec2 uv_max{1.0f, 1.0f};    // texture UV bottom-right
};

class SpriteBatch {
public:
    void init(VmaAllocator allocator, VkDevice device, VkCommandPool cmd_pool, VkQueue queue);
    void shutdown(VmaAllocator allocator);

    void begin();
    void draw(const SpriteDrawInfo& info);
    // Flush pending sprites into vertex buffer for given frame; returns index count to draw.
    uint32_t flush(uint32_t frame_index);
    void bind(VkCommandBuffer cmd, uint32_t frame_index);

private:
    std::array<Buffer, kMaxFramesInFlight> vertex_buffers_;
    Buffer index_buffer_;

    std::vector<SpriteDrawInfo> pending_sprites_;
};

}  // namespace vulkan_game
