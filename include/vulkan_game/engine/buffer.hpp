#pragma once

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

namespace vulkan_game {

class Buffer {
public:
    static Buffer create_vertex(VmaAllocator allocator, VkDeviceSize size);
    static Buffer create_dynamic_vertex(VmaAllocator allocator, VkDeviceSize size);
    static Buffer create_index(VmaAllocator allocator, VkDeviceSize size);
    static Buffer create_uniform(VmaAllocator allocator, VkDeviceSize size);
    static Buffer create_storage(VmaAllocator allocator, VkDeviceSize size);
    static Buffer create_storage_readback(VmaAllocator allocator, VkDeviceSize size);
    static Buffer create_staging(VmaAllocator allocator, VkDeviceSize size);
    static Buffer create_readback(VmaAllocator allocator, VkDeviceSize size);

    void upload(const void* data, VkDeviceSize size);
    void destroy(VmaAllocator allocator);

    VkBuffer buffer() const { return buffer_; }
    VmaAllocation allocation() const { return allocation_; }
    void* mapped() const { return mapped_; }

private:
    VkBuffer buffer_ = VK_NULL_HANDLE;
    VmaAllocation allocation_ = VK_NULL_HANDLE;
    void* mapped_ = nullptr;
};

}  // namespace vulkan_game
