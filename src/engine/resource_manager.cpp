#include "vulkan_game/engine/resource_manager.hpp"

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
}

void ResourceManager::shutdown() {
    texture_cache_.clear();
    font_cache_.clear();
}

ResourceHandle<Texture> ResourceManager::load_texture(const std::string& path, VkFilter filter,
                                                       VkSamplerAddressMode address_mode,
                                                       VkFormat format) {
    std::string key = path;
    if (filter == VK_FILTER_LINEAR) {
        key += ":linear";
    }
    if (address_mode == VK_SAMPLER_ADDRESS_MODE_REPEAT) {
        key += ":repeat";
    }
    if (format == VK_FORMAT_R8G8B8A8_UNORM) {
        key += ":unorm";
    }
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

}  // namespace vulkan_game
