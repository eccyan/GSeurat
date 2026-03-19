#include "vulkan_game/engine/descriptor.hpp"

#include <stdexcept>

namespace vulkan_game {

void DescriptorManager::init(VkDevice device) {
    // Create descriptor set layout for sprites
    VkDescriptorSetLayoutBinding ubo_binding{};
    ubo_binding.binding = 0;
    ubo_binding.descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    ubo_binding.descriptorCount = 1;
    ubo_binding.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;

    VkDescriptorSetLayoutBinding sampler_binding{};
    sampler_binding.binding = 1;
    sampler_binding.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    sampler_binding.descriptorCount = 1;
    sampler_binding.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;

    VkDescriptorSetLayoutBinding normal_binding{};
    normal_binding.binding = 2;
    normal_binding.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    normal_binding.descriptorCount = 1;
    normal_binding.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;

    std::array<VkDescriptorSetLayoutBinding, 3> bindings = {ubo_binding, sampler_binding, normal_binding};

    VkDescriptorSetLayoutCreateInfo layout_info{};
    layout_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    layout_info.bindingCount = static_cast<uint32_t>(bindings.size());
    layout_info.pBindings = bindings.data();

    if (vkCreateDescriptorSetLayout(device, &layout_info, nullptr, &sprite_layout_) !=
        VK_SUCCESS) {
        throw std::runtime_error("Failed to create descriptor set layout");
    }

    // Create descriptor pool (sized for up to 16 allocations × kMaxFramesInFlight sets each)
    std::array<VkDescriptorPoolSize, 2> pool_sizes{};
    pool_sizes[0].type = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    pool_sizes[0].descriptorCount = kMaxFramesInFlight * 16;
    pool_sizes[1].type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    pool_sizes[1].descriptorCount = kMaxFramesInFlight * 32;

    VkDescriptorPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pool_info.poolSizeCount = static_cast<uint32_t>(pool_sizes.size());
    pool_info.pPoolSizes = pool_sizes.data();
    pool_info.maxSets = kMaxFramesInFlight * 16;

    if (vkCreateDescriptorPool(device, &pool_info, nullptr, &pool_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create descriptor pool");
    }
}

void DescriptorManager::shutdown(VkDevice device) {
    vkDestroyDescriptorPool(device, pool_, nullptr);
    vkDestroyDescriptorSetLayout(device, sprite_layout_, nullptr);
}

std::array<VkDescriptorSet, kMaxFramesInFlight> DescriptorManager::allocate_sprite_sets(
    VkDevice device, const std::array<VkBuffer, kMaxFramesInFlight>& uniform_buffers,
    VkDeviceSize ubo_size, VkImageView texture_view, VkSampler sampler,
    VkImageView normal_view, VkSampler normal_sampler) {
    std::array<VkDescriptorSetLayout, kMaxFramesInFlight> layouts;
    layouts.fill(sprite_layout_);

    VkDescriptorSetAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloc_info.descriptorPool = pool_;
    alloc_info.descriptorSetCount = kMaxFramesInFlight;
    alloc_info.pSetLayouts = layouts.data();

    std::array<VkDescriptorSet, kMaxFramesInFlight> sets;
    if (vkAllocateDescriptorSets(device, &alloc_info, sets.data()) != VK_SUCCESS) {
        throw std::runtime_error("Failed to allocate descriptor sets");
    }

    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        VkDescriptorBufferInfo buffer_info{};
        buffer_info.buffer = uniform_buffers[i];
        buffer_info.offset = 0;
        buffer_info.range = ubo_size;

        VkDescriptorImageInfo image_info{};
        image_info.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        image_info.imageView = texture_view;
        image_info.sampler = sampler;

        // Normal map: use provided view/sampler, or fall back to diffuse texture
        VkDescriptorImageInfo normal_info{};
        normal_info.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        normal_info.imageView = (normal_view != VK_NULL_HANDLE) ? normal_view : texture_view;
        normal_info.sampler = (normal_sampler != VK_NULL_HANDLE) ? normal_sampler : sampler;

        std::array<VkWriteDescriptorSet, 3> writes{};
        writes[0].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[0].dstSet = sets[i];
        writes[0].dstBinding = 0;
        writes[0].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        writes[0].descriptorCount = 1;
        writes[0].pBufferInfo = &buffer_info;

        writes[1].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[1].dstSet = sets[i];
        writes[1].dstBinding = 1;
        writes[1].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        writes[1].descriptorCount = 1;
        writes[1].pImageInfo = &image_info;

        writes[2].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[2].dstSet = sets[i];
        writes[2].dstBinding = 2;
        writes[2].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        writes[2].descriptorCount = 1;
        writes[2].pImageInfo = &normal_info;

        vkUpdateDescriptorSets(device, static_cast<uint32_t>(writes.size()), writes.data(), 0,
                               nullptr);
    }

    return sets;
}

}  // namespace vulkan_game
