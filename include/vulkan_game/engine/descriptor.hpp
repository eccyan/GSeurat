#pragma once

#include "vulkan_game/engine/types.hpp"

#include <vulkan/vulkan.h>

#include <array>
#include <vector>

namespace vulkan_game {

class DescriptorManager {
public:
    void init(VkDevice device);
    void shutdown(VkDevice device);

    VkDescriptorSetLayout sprite_layout() const { return sprite_layout_; }

    std::array<VkDescriptorSet, kMaxFramesInFlight> allocate_sprite_sets(
        VkDevice device,
        const std::array<VkBuffer, kMaxFramesInFlight>& uniform_buffers,
        VkDeviceSize ubo_size,
        VkImageView texture_view,
        VkSampler sampler);

private:
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout sprite_layout_ = VK_NULL_HANDLE;
};

}  // namespace vulkan_game
