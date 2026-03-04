#include "vulkan_game/engine/buffer.hpp"

#include <cstring>
#include <stdexcept>

namespace vulkan_game {

Buffer Buffer::create_vertex(VmaAllocator allocator, VkDeviceSize size) {
    VkBufferCreateInfo buf_info{};
    buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buf_info.size = size;
    buf_info.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    buf_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_GPU_ONLY;

    Buffer buf;
    if (vmaCreateBuffer(allocator, &buf_info, &alloc_info, &buf.buffer_, &buf.allocation_,
                        nullptr) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create vertex buffer");
    }
    return buf;
}

Buffer Buffer::create_dynamic_vertex(VmaAllocator allocator, VkDeviceSize size) {
    VkBufferCreateInfo buf_info{};
    buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buf_info.size = size;
    buf_info.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
    buf_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_AUTO;
    alloc_info.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT |
                       VMA_ALLOCATION_CREATE_MAPPED_BIT;

    Buffer buf;
    VmaAllocationInfo info;
    if (vmaCreateBuffer(allocator, &buf_info, &alloc_info, &buf.buffer_, &buf.allocation_,
                        &info) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create dynamic vertex buffer");
    }
    buf.mapped_ = info.pMappedData;
    return buf;
}

Buffer Buffer::create_index(VmaAllocator allocator, VkDeviceSize size) {
    VkBufferCreateInfo buf_info{};
    buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buf_info.size = size;
    buf_info.usage = VK_BUFFER_USAGE_INDEX_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    buf_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_GPU_ONLY;

    Buffer buf;
    if (vmaCreateBuffer(allocator, &buf_info, &alloc_info, &buf.buffer_, &buf.allocation_,
                        nullptr) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create index buffer");
    }
    return buf;
}

Buffer Buffer::create_uniform(VmaAllocator allocator, VkDeviceSize size) {
    VkBufferCreateInfo buf_info{};
    buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buf_info.size = size;
    buf_info.usage = VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT;
    buf_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_AUTO;
    alloc_info.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT |
                       VMA_ALLOCATION_CREATE_MAPPED_BIT;

    Buffer buf;
    VmaAllocationInfo info;
    if (vmaCreateBuffer(allocator, &buf_info, &alloc_info, &buf.buffer_, &buf.allocation_,
                        &info) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create uniform buffer");
    }
    buf.mapped_ = info.pMappedData;
    return buf;
}

Buffer Buffer::create_staging(VmaAllocator allocator, VkDeviceSize size) {
    VkBufferCreateInfo buf_info{};
    buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buf_info.size = size;
    buf_info.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    buf_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_AUTO;
    alloc_info.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT |
                       VMA_ALLOCATION_CREATE_MAPPED_BIT;

    Buffer buf;
    VmaAllocationInfo info;
    if (vmaCreateBuffer(allocator, &buf_info, &alloc_info, &buf.buffer_, &buf.allocation_,
                        &info) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create staging buffer");
    }
    buf.mapped_ = info.pMappedData;
    return buf;
}

Buffer Buffer::create_readback(VmaAllocator allocator, VkDeviceSize size) {
    VkBufferCreateInfo buf_info{};
    buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buf_info.size = size;
    buf_info.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    buf_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_AUTO;
    alloc_info.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_RANDOM_BIT |
                       VMA_ALLOCATION_CREATE_MAPPED_BIT;

    Buffer buf;
    VmaAllocationInfo info;
    if (vmaCreateBuffer(allocator, &buf_info, &alloc_info, &buf.buffer_, &buf.allocation_,
                        &info) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create readback buffer");
    }
    buf.mapped_ = info.pMappedData;
    return buf;
}

void Buffer::upload(const void* data, VkDeviceSize size) {
    if (mapped_ && data && size > 0) {
        std::memcpy(mapped_, data, size);
    }
}

void Buffer::destroy(VmaAllocator allocator) {
    if (buffer_ != VK_NULL_HANDLE) {
        vmaDestroyBuffer(allocator, buffer_, allocation_);
        buffer_ = VK_NULL_HANDLE;
        allocation_ = VK_NULL_HANDLE;
        mapped_ = nullptr;
    }
}

}  // namespace vulkan_game
