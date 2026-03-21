#pragma once

#include "vulkan_game/engine/async_loader.hpp"
#include "vulkan_game/engine/resource_cache.hpp"
#include "vulkan_game/engine/resource_handle.hpp"
#include "vulkan_game/engine/staging_uploader.hpp"
#include "vulkan_game/engine/texture.hpp"
#include "vulkan_game/engine/font_atlas.hpp"

#include <vulkan/vulkan.h>
#include <vk_mem_alloc.h>

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace vulkan_game {

class ResourceManager {
public:
    void init(VkDevice device, VmaAllocator allocator,
              VkCommandPool cmd_pool, VkQueue queue);
    void shutdown();

    // --- Synchronous API (unchanged) ---

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

    // --- Asynchronous API ---

    // Request a texture to be loaded asynchronously. Returns a request ID.
    // The texture is loaded on a background thread and staged for GPU upload.
    // Use get_if_ready() or placeholder_texture() while waiting.
    uint32_t load_texture_async(AsyncLoader& loader,
                                const std::string& path,
                                VkFilter filter = VK_FILTER_NEAREST,
                                VkSamplerAddressMode address_mode = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,
                                VkFormat format = VK_FORMAT_R8G8B8A8_SRGB);

    // Check if an async-loaded texture is ready. Returns a valid handle if
    // the texture has been loaded and uploaded to GPU, or an empty handle
    // if still pending.
    ResourceHandle<Texture> get_if_ready(const std::string& path) const;

    // 1x1 magenta placeholder texture, available immediately after init().
    ResourceHandle<Texture> placeholder_texture() const { return placeholder_; }

    // Poll async loader for completed loads and enqueue GPU uploads.
    // Call once per frame from the main loop.
    void process_async_results(AsyncLoader& loader, StagingUploader& uploader);

    // Access the texture cache (used by StagingUploader callback to insert completed textures)
    ResourceCache<Texture>& texture_cache() { return texture_cache_; }

private:
    // Build a cache key from path + filter/address/format
    static std::string make_cache_key(const std::string& path, VkFilter filter,
                                       VkSamplerAddressMode address_mode, VkFormat format);

    VkDevice device_ = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;
    VkCommandPool cmd_pool_ = VK_NULL_HANDLE;
    VkQueue queue_ = VK_NULL_HANDLE;

    ResourceCache<Texture> texture_cache_;
    ResourceCache<FontAtlas> font_cache_;

    // Placeholder texture (1x1 magenta)
    ResourceHandle<Texture> placeholder_;

    // Track async texture requests: request_id → {cache_key, filter, address_mode, format}
    struct AsyncTextureRequest {
        std::string cache_key;
        VkFilter filter;
        VkSamplerAddressMode address_mode;
        VkFormat format;
    };
    std::unordered_map<uint32_t, AsyncTextureRequest> pending_async_;
};

}  // namespace vulkan_game
