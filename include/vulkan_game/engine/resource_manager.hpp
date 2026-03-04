#pragma once

#include "vulkan_game/engine/resource_cache.hpp"
#include "vulkan_game/engine/resource_handle.hpp"
#include "vulkan_game/engine/texture.hpp"
#include "vulkan_game/engine/font_atlas.hpp"

#include <vulkan/vulkan.h>
#include <vk_mem_alloc.h>

#include <cstdint>
#include <string>
#include <vector>

namespace vulkan_game {

class ResourceManager {
public:
    void init(VkDevice device, VmaAllocator allocator,
              VkCommandPool cmd_pool, VkQueue queue);
    void shutdown();

    ResourceHandle<Texture> load_texture(const std::string& path,
                                         VkFilter filter = VK_FILTER_NEAREST,
                                         VkSamplerAddressMode address_mode = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,
                                         VkFormat format = VK_FORMAT_R8G8B8A8_SRGB);
    ResourceHandle<Texture> load_texture_from_memory(const std::string& key,
                                                     const uint8_t* pixels,
                                                     uint32_t width, uint32_t height,
                                                     VkFilter filter = VK_FILTER_NEAREST,
                                                     VkSamplerAddressMode address_mode = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,
                                                     VkFormat format = VK_FORMAT_R8G8B8A8_SRGB);
    ResourceHandle<FontAtlas> load_font(const std::string& path, float size,
                                        const std::vector<uint32_t>& codepoints);

private:
    VkDevice device_ = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;
    VkCommandPool cmd_pool_ = VK_NULL_HANDLE;
    VkQueue queue_ = VK_NULL_HANDLE;

    ResourceCache<Texture> texture_cache_;
    ResourceCache<FontAtlas> font_cache_;
};

}  // namespace vulkan_game
