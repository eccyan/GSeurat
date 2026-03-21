#pragma once

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/types.hpp"

#include <array>
#include <vector>

#include <glm/glm.hpp>
#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

namespace gseurat {

struct SpriteDrawInfo {
    glm::vec3 position;               // center x, y, z
    glm::vec2 size;                   // width, height
    glm::vec4 color;                  // rgba tint
    glm::vec2 uv_min{0.0f, 0.0f};    // texture UV top-left
    glm::vec2 uv_max{1.0f, 1.0f};    // texture UV bottom-right
};

struct FlushResult {
    uint32_t index_count   = 0;
    int32_t  vertex_offset = 0;
};

class SpriteBatch {
public:
    void init(VmaAllocator allocator, VkDevice device, VkCommandPool cmd_pool, VkQueue queue);
    void shutdown(VmaAllocator allocator);

    void begin_frame();
    void begin();
    void draw(const SpriteDrawInfo& info);
    // Flush pending sprites into vertex buffer for given frame.
    // When as_wall=true, generates XZ-plane (vertical wall) quads instead of XY-plane.
    // Returns index count and vertex offset for vkCmdDrawIndexed.
    FlushResult flush(uint32_t frame_index, bool as_wall = false);
    void bind(VkCommandBuffer cmd, uint32_t frame_index);

private:
    std::array<Buffer, kMaxFramesInFlight> vertex_buffers_;
    Buffer index_buffer_;

    std::vector<SpriteDrawInfo> pending_sprites_;
    uint32_t frame_vertex_offset_ = 0;
};

}  // namespace gseurat
