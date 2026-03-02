#include "vulkan_game/engine/sync.hpp"

#include <stdexcept>

namespace vulkan_game {

void SyncObjects::init(VkDevice device, uint32_t swapchain_image_count) {
    VkSemaphoreCreateInfo sem_info{};
    sem_info.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;

    VkFenceCreateInfo fence_info{};
    fence_info.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
    fence_info.flags = VK_FENCE_CREATE_SIGNALED_BIT;

    for (auto& f : frames_) {
        if (vkCreateFence(device, &fence_info, nullptr, &f.in_flight) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create sync objects");
        }
    }

    // One acquire semaphore per swapchain image to avoid reuse conflicts
    acquire_semaphores_.resize(swapchain_image_count);
    for (auto& sem : acquire_semaphores_) {
        if (vkCreateSemaphore(device, &sem_info, nullptr, &sem) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create acquire semaphore");
        }
    }

    // One render_finished semaphore per swapchain image
    render_finished_semaphores_.resize(swapchain_image_count);
    for (auto& sem : render_finished_semaphores_) {
        if (vkCreateSemaphore(device, &sem_info, nullptr, &sem) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create render_finished semaphore");
        }
    }
}

void SyncObjects::shutdown(VkDevice device) {
    for (auto& f : frames_) {
        vkDestroyFence(device, f.in_flight, nullptr);
    }
    for (auto sem : acquire_semaphores_) {
        vkDestroySemaphore(device, sem, nullptr);
    }
    for (auto sem : render_finished_semaphores_) {
        vkDestroySemaphore(device, sem, nullptr);
    }
}

}  // namespace vulkan_game
