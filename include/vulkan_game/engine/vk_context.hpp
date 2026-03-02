#pragma once

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>
#include <vk_mem_alloc.h>

#include <vector>

namespace vulkan_game {

class VkContext {
public:
    void init(GLFWwindow* window);
    void shutdown();

    VkInstance instance() const { return instance_; }
    VkDevice device() const { return device_; }
    VkPhysicalDevice physical_device() const { return physical_device_; }
    VkQueue graphics_queue() const { return graphics_queue_; }
    uint32_t graphics_queue_family() const { return graphics_queue_family_; }
    VkSurfaceKHR surface() const { return surface_; }
    VmaAllocator allocator() const { return allocator_; }

private:
    void create_instance();
    void setup_debug_messenger();
    void create_surface(GLFWwindow* window);
    void pick_physical_device();
    void create_logical_device();
    void create_allocator();

    int32_t find_queue_family() const;
    std::vector<const char*> get_required_device_extensions() const;

    VkInstance instance_ = VK_NULL_HANDLE;
    VkDebugUtilsMessengerEXT debug_messenger_ = VK_NULL_HANDLE;
    VkSurfaceKHR surface_ = VK_NULL_HANDLE;
    VkPhysicalDevice physical_device_ = VK_NULL_HANDLE;
    VkDevice device_ = VK_NULL_HANDLE;
    VkQueue graphics_queue_ = VK_NULL_HANDLE;
    uint32_t graphics_queue_family_ = 0;
    VmaAllocator allocator_ = VK_NULL_HANDLE;
};

}  // namespace vulkan_game
