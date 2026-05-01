#pragma once

#include "gseurat/engine/types.hpp"

#include <vulkan/vulkan.h>

#include <array>
#include <vector>

namespace gseurat {

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
        VkSampler sampler,
        VkImageView normal_view = VK_NULL_HANDLE,
        VkSampler normal_sampler = VK_NULL_HANDLE);

    // Per-frame view variant: descriptor set `i` is bound to `texture_views[i]`.
    // Used for sampling per-frame intermediate images (e.g. the GS post-processed
    // image) where a single shared view would race between frames in flight.
    std::array<VkDescriptorSet, kMaxFramesInFlight> allocate_sprite_sets_per_frame(
        VkDevice device,
        const std::array<VkBuffer, kMaxFramesInFlight>& uniform_buffers,
        VkDeviceSize ubo_size,
        const std::array<VkImageView, kMaxFramesInFlight>& texture_views,
        VkSampler sampler,
        VkImageView normal_view = VK_NULL_HANDLE,
        VkSampler normal_sampler = VK_NULL_HANDLE);

    void free_sprite_sets(VkDevice device,
                          std::array<VkDescriptorSet, kMaxFramesInFlight>& sets);

private:
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout sprite_layout_ = VK_NULL_HANDLE;
};

}  // namespace gseurat
