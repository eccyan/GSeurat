#pragma once

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <string>

namespace vulkan_game {

class Texture {
public:
    static Texture load_from_file(VkDevice device, VmaAllocator allocator,
                                  VkCommandPool cmd_pool, VkQueue queue,
                                  const std::string& path,
                                  VkFilter filter = VK_FILTER_NEAREST,
                                  VkSamplerAddressMode address_mode = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,
                                  VkFormat format = VK_FORMAT_R8G8B8A8_SRGB);
    static Texture load_from_memory(VkDevice device, VmaAllocator allocator,
                                    VkCommandPool cmd_pool, VkQueue queue,
                                    const uint8_t* pixels, uint32_t width, uint32_t height,
                                    VkFilter filter = VK_FILTER_NEAREST,
                                    VkSamplerAddressMode address_mode = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,
                                    VkFormat format = VK_FORMAT_R8G8B8A8_SRGB);
    void destroy(VkDevice device, VmaAllocator allocator);

    VkImageView image_view() const { return image_view_; }
    VkSampler sampler() const { return sampler_; }

private:
    VkImage image_ = VK_NULL_HANDLE;
    VmaAllocation allocation_ = VK_NULL_HANDLE;
    VkImageView image_view_ = VK_NULL_HANDLE;
    VkSampler sampler_ = VK_NULL_HANDLE;
};

}  // namespace vulkan_game
