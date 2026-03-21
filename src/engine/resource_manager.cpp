#include "vulkan_game/engine/resource_manager.hpp"

#include <stb_image.h>

namespace vulkan_game {

void ResourceManager::init(VkDevice device, VmaAllocator allocator,
                            VkCommandPool cmd_pool, VkQueue queue) {
    device_ = device;
    allocator_ = allocator;
    cmd_pool_ = cmd_pool;
    queue_ = queue;

    texture_cache_.set_loader([this](const std::string& path) -> std::shared_ptr<Texture> {
        auto tex = Texture::load_from_file(device_, allocator_, cmd_pool_, queue_, path);
        return std::make_shared<Texture>(std::move(tex));
    });

    // Create 1x1 magenta placeholder texture
    const uint8_t magenta[] = {255, 0, 255, 255};
    auto tex = Texture::load_from_memory(device_, allocator_, cmd_pool_, queue_,
                                         magenta, 1, 1);
    placeholder_ = texture_cache_.insert("__placeholder__",
                                         std::make_shared<Texture>(std::move(tex)));
}

void ResourceManager::shutdown() {
    placeholder_ = {};
    pending_async_.clear();
    texture_cache_.clear();
    font_cache_.clear();
}

std::string ResourceManager::make_cache_key(const std::string& path, VkFilter filter,
                                             VkSamplerAddressMode address_mode,
                                             VkFormat format) {
    std::string key = path;
    if (filter == VK_FILTER_LINEAR) key += ":linear";
    if (address_mode == VK_SAMPLER_ADDRESS_MODE_REPEAT) key += ":repeat";
    if (format == VK_FORMAT_R8G8B8A8_UNORM) key += ":unorm";
    return key;
}

ResourceHandle<Texture> ResourceManager::load_texture(const std::string& path, VkFilter filter,
                                                       VkSamplerAddressMode address_mode,
                                                       VkFormat format) {
    std::string key = make_cache_key(path, filter, address_mode, format);
    if (texture_cache_.contains(key)) {
        return texture_cache_.get(key);
    }
    auto tex = Texture::load_from_file(device_, allocator_, cmd_pool_, queue_,
                                       path, filter, address_mode, format);
    return texture_cache_.insert(key, std::make_shared<Texture>(std::move(tex)));
}

ResourceHandle<Texture> ResourceManager::load_texture_from_memory(
    const std::string& key, const uint8_t* pixels,
    uint32_t width, uint32_t height, VkFilter filter,
    VkSamplerAddressMode address_mode,
    VkFormat format) {
    std::string cache_key = key;
    if (format == VK_FORMAT_R8G8B8A8_UNORM) {
        cache_key += ":unorm";
    }
    if (texture_cache_.contains(cache_key)) {
        return texture_cache_.get(cache_key);
    }
    auto tex = Texture::load_from_memory(device_, allocator_, cmd_pool_, queue_,
                                         pixels, width, height, filter, address_mode, format);
    return texture_cache_.insert(cache_key, std::make_shared<Texture>(std::move(tex)));
}

ResourceHandle<FontAtlas> ResourceManager::load_font(
    const std::string& path, float size,
    const std::vector<uint32_t>& codepoints) {
    std::string key = path + ":" + std::to_string(static_cast<int>(size));
    if (font_cache_.contains(key)) {
        return font_cache_.get(key);
    }
    auto atlas = std::make_shared<FontAtlas>();
    atlas->init(path, size, codepoints);
    return font_cache_.insert(key, std::move(atlas));
}

uint32_t ResourceManager::load_texture_async(AsyncLoader& loader,
                                               const std::string& path, VkFilter filter,
                                               VkSamplerAddressMode address_mode,
                                               VkFormat format) {
    std::string cache_key = make_cache_key(path, filter, address_mode, format);

    // Already loaded? No need to re-request.
    if (texture_cache_.contains(cache_key)) return 0;

    // Submit a job to the async loader: read pixels on worker thread
    std::string path_copy = path;
    uint32_t id = loader.submit([path_copy]() -> std::any {
        int w, h, channels;
        stbi_uc* raw = stbi_load(path_copy.c_str(), &w, &h, &channels, STBI_rgb_alpha);
        if (!raw) {
            throw std::runtime_error("Failed to load texture: " + path_copy);
        }
        TexturePixels result;
        result.path = path_copy;
        result.width = static_cast<uint32_t>(w);
        result.height = static_cast<uint32_t>(h);
        result.pixels.assign(raw, raw + w * h * 4);
        stbi_image_free(raw);
        return result;
    });

    pending_async_[id] = AsyncTextureRequest{cache_key, filter, address_mode, format};
    return id;
}

ResourceHandle<Texture> ResourceManager::get_if_ready(const std::string& path) const {
    if (texture_cache_.contains(path)) {
        // const_cast needed because ResourceCache::get returns non-const handle
        return const_cast<ResourceCache<Texture>&>(texture_cache_).get(path);
    }
    return {};
}

void ResourceManager::process_async_results(AsyncLoader& loader, StagingUploader& uploader) {
    auto results = loader.poll_results();
    for (auto& result : results) {
        auto it = pending_async_.find(result.request_id);
        if (it == pending_async_.end()) continue;

        auto& req = it->second;

        if (!result.success) {
            // Loading failed — remove from pending, texture stays as placeholder
            pending_async_.erase(it);
            continue;
        }

        // Extract the loaded pixel data
        auto pixels = std::any_cast<TexturePixels>(std::move(result.data));

        // Enqueue for GPU upload via StagingUploader
        StagedTexture staged;
        staged.cache_key = req.cache_key;
        staged.pixels = std::move(pixels.pixels);
        staged.width = pixels.width;
        staged.height = pixels.height;
        staged.filter = req.filter;
        staged.address_mode = req.address_mode;
        staged.format = req.format;
        uploader.enqueue_texture(std::move(staged));

        pending_async_.erase(it);
    }
}

}  // namespace vulkan_game
