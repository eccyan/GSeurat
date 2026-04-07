#pragma once

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

namespace gseurat {

class Buffer {
public:
    Buffer() = default;
    ~Buffer() = default;

    // Move-only: transfer ownership of VMA handles
    Buffer(Buffer&& other) noexcept
        : buffer_(other.buffer_), allocation_(other.allocation_), mapped_(other.mapped_) {
        other.buffer_ = VK_NULL_HANDLE;
        other.allocation_ = VK_NULL_HANDLE;
        other.mapped_ = nullptr;
    }
    Buffer& operator=(Buffer&& other) noexcept {
        if (this != &other) {
            // Note: caller must destroy() before reassignment if buffer is live
            buffer_ = other.buffer_;
            allocation_ = other.allocation_;
            mapped_ = other.mapped_;
            other.buffer_ = VK_NULL_HANDLE;
            other.allocation_ = VK_NULL_HANDLE;
            other.mapped_ = nullptr;
        }
        return *this;
    }
    Buffer(const Buffer&) = delete;
    Buffer& operator=(const Buffer&) = delete;

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

}  // namespace gseurat
