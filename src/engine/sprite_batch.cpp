#include "vulkan_game/engine/sprite_batch.hpp"

#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace vulkan_game {

void SpriteBatch::init(VmaAllocator allocator, VkDevice device, VkCommandPool cmd_pool,
                       VkQueue queue) {
    // Create persistently-mapped dynamic vertex buffers (one per frame in flight)
    const VkDeviceSize vertex_buf_size = kMaxSprites * 4 * sizeof(Vertex);
    for (auto& buf : vertex_buffers_) {
        buf = Buffer::create_dynamic_vertex(allocator, vertex_buf_size);
    }

    // Build static index buffer: for sprite i → {4i, 4i+1, 4i+2, 4i+2, 4i+3, 4i}
    std::vector<uint32_t> indices;
    indices.reserve(kMaxSprites * 6);
    for (uint32_t i = 0; i < kMaxSprites; ++i) {
        uint32_t base = i * 4;
        indices.push_back(base + 0);
        indices.push_back(base + 1);
        indices.push_back(base + 2);
        indices.push_back(base + 2);
        indices.push_back(base + 3);
        indices.push_back(base + 0);
    }

    const VkDeviceSize index_size = indices.size() * sizeof(uint32_t);

    // Upload via staging
    auto staging = Buffer::create_staging(allocator, index_size);
    staging.upload(indices.data(), index_size);

    index_buffer_ = Buffer::create_index(allocator, index_size);

    // Single-time command to copy staging → index buffer
    VkCommandBufferAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    alloc_info.commandPool = cmd_pool;
    alloc_info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    alloc_info.commandBufferCount = 1;

    VkCommandBuffer cmd;
    vkAllocateCommandBuffers(device, &alloc_info, &cmd);

    VkCommandBufferBeginInfo begin{};
    begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd, &begin);

    VkBufferCopy copy{};
    copy.size = index_size;
    vkCmdCopyBuffer(cmd, staging.buffer(), index_buffer_.buffer(), 1, &copy);

    vkEndCommandBuffer(cmd);

    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &cmd;
    vkQueueSubmit(queue, 1, &submit, VK_NULL_HANDLE);
    vkQueueWaitIdle(queue);

    vkFreeCommandBuffers(device, cmd_pool, 1, &cmd);
    staging.destroy(allocator);
}

void SpriteBatch::shutdown(VmaAllocator allocator) {
    index_buffer_.destroy(allocator);
    for (auto& buf : vertex_buffers_) {
        buf.destroy(allocator);
    }
}

void SpriteBatch::begin() {
    pending_sprites_.clear();
}

void SpriteBatch::draw(const SpriteDrawInfo& info) {
    if (pending_sprites_.size() < kMaxSprites) {
        pending_sprites_.push_back(info);
    }
}

uint32_t SpriteBatch::flush(uint32_t frame_index) {
    if (pending_sprites_.empty()) {
        return 0;
    }

    // Back-to-front sort: larger Z = further from camera
    std::sort(pending_sprites_.begin(), pending_sprites_.end(),
              [](const SpriteDrawInfo& a, const SpriteDrawInfo& b) {
                  return a.position.z > b.position.z;
              });

    // Build vertices
    auto* verts = static_cast<Vertex*>(vertex_buffers_[frame_index].mapped());
    for (uint32_t i = 0; i < static_cast<uint32_t>(pending_sprites_.size()); ++i) {
        const auto& s = pending_sprites_[i];
        float cx = s.position.x;
        float cy = s.position.y;
        float cz = s.position.z;
        float hw = s.size.x * 0.5f;
        float hh = s.size.y * 0.5f;

        // TL, TR, BR, BL
        verts[i * 4 + 0] = {{cx - hw, cy + hh, cz}, {s.uv_min.x, s.uv_min.y}, s.color};
        verts[i * 4 + 1] = {{cx + hw, cy + hh, cz}, {s.uv_max.x, s.uv_min.y}, s.color};
        verts[i * 4 + 2] = {{cx + hw, cy - hh, cz}, {s.uv_max.x, s.uv_max.y}, s.color};
        verts[i * 4 + 3] = {{cx - hw, cy - hh, cz}, {s.uv_min.x, s.uv_max.y}, s.color};
    }

    return static_cast<uint32_t>(pending_sprites_.size()) * 6;
}

void SpriteBatch::bind(VkCommandBuffer cmd, uint32_t frame_index) {
    VkBuffer vb = vertex_buffers_[frame_index].buffer();
    VkDeviceSize offset = 0;
    vkCmdBindVertexBuffers(cmd, 0, 1, &vb, &offset);
    vkCmdBindIndexBuffer(cmd, index_buffer_.buffer(), 0, VK_INDEX_TYPE_UINT32);
}

}  // namespace vulkan_game
