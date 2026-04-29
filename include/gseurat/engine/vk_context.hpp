#pragma once

#include "gseurat/engine/pipeline_cache.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>
#include <vk_mem_alloc.h>

#include <vector>

namespace gseurat {

class VkContext {
public:
    void init(GLFWwindow* window);
    void init_headless();
    void shutdown();

    VkInstance instance() const { return instance_; }
    VkDevice device() const { return device_; }
    VkPhysicalDevice physical_device() const { return physical_device_; }
    VkQueue graphics_queue() const { return graphics_queue_; }
    uint32_t graphics_queue_family() const { return graphics_queue_family_; }
    VkQueue transfer_queue() const { return transfer_queue_; }
    uint32_t transfer_queue_family() const { return transfer_queue_family_; }
    bool has_dedicated_transfer() const { return has_dedicated_transfer_; }
    bool is_apple_gpu() const { return is_apple_gpu_; }
    VkSurfaceKHR surface() const { return surface_; }
    VmaAllocator allocator() const { return allocator_; }

    // Engine-wide pipeline cache (disk-backed in windowed mode, in-memory in
    // headless mode). Hands the same VkPipelineCache handle to every
    // vkCreate{Compute,Graphics}Pipelines call so the driver can amortise
    // shader compilation across pipelines and runs.
    VkPipelineCache pipeline_cache() const { return pipeline_cache_.handle(); }

private:
    void create_instance();
    void setup_debug_messenger();
    void create_surface(GLFWwindow* window);
    void pick_physical_device();
    void create_logical_device();
    void create_allocator();
    void create_pipeline_cache(bool persistent);

    int32_t find_queue_family() const;
    std::vector<const char*> get_required_device_extensions() const;

    void create_instance_headless();
    void pick_physical_device_headless();
    void create_logical_device_headless();

    VkInstance instance_ = VK_NULL_HANDLE;
    VkDebugUtilsMessengerEXT debug_messenger_ = VK_NULL_HANDLE;
    VkSurfaceKHR surface_ = VK_NULL_HANDLE;
    VkPhysicalDevice physical_device_ = VK_NULL_HANDLE;
    VkDevice device_ = VK_NULL_HANDLE;
    VkQueue graphics_queue_ = VK_NULL_HANDLE;
    uint32_t graphics_queue_family_ = 0;
    VkQueue transfer_queue_{VK_NULL_HANDLE};
    uint32_t transfer_queue_family_{0};
    bool has_dedicated_transfer_{false};
    bool is_apple_gpu_{false};
    bool headless_{false};
    VmaAllocator allocator_ = VK_NULL_HANDLE;
    PipelineCache pipeline_cache_;
};

}  // namespace gseurat
