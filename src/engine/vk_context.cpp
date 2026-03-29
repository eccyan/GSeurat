#define VMA_IMPLEMENTATION
#include "gseurat/engine/vk_context.hpp"

#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace gseurat {

static VKAPI_ATTR VkBool32 VKAPI_CALL debug_callback(
    VkDebugUtilsMessageSeverityFlagBitsEXT severity,
    VkDebugUtilsMessageTypeFlagsEXT /*type*/,
    const VkDebugUtilsMessengerCallbackDataEXT* data, void* /*user_data*/) {
    if (severity >= VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT) {
        std::cerr << "Vulkan: " << data->pMessage << '\n';
    }
    return VK_FALSE;
}

void VkContext::init(GLFWwindow* window) {
    create_instance();
    setup_debug_messenger();
    create_surface(window);
    pick_physical_device();
    create_logical_device();
    create_allocator();
}

void VkContext::shutdown() {
#ifndef NDEBUG
    // Log remaining VMA allocations to help diagnose leaks
    VmaTotalStatistics stats{};
    vmaCalculateStatistics(allocator_, &stats);
    if (stats.total.statistics.allocationCount > 0) {
        std::cerr << "[VMA] WARNING: " << stats.total.statistics.allocationCount
                  << " allocations still alive ("
                  << stats.total.statistics.allocationBytes << " bytes) at shutdown\n";
    }
#endif
    vmaDestroyAllocator(allocator_);
    vkDestroyDevice(device_, nullptr);
    vkDestroySurfaceKHR(instance_, surface_, nullptr);

#ifndef NDEBUG
    auto func = reinterpret_cast<PFN_vkDestroyDebugUtilsMessengerEXT>(
        vkGetInstanceProcAddr(instance_, "vkDestroyDebugUtilsMessengerEXT"));
    if (func && debug_messenger_) {
        func(instance_, debug_messenger_, nullptr);
    }
#endif

    vkDestroyInstance(instance_, nullptr);
}

void VkContext::create_instance() {
    VkApplicationInfo app_info{};
    app_info.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    app_info.pApplicationName = "GSeurat";
    app_info.applicationVersion = VK_MAKE_VERSION(0, 1, 0);
    app_info.pEngineName = "GSeurat";
    app_info.engineVersion = VK_MAKE_VERSION(1, 0, 0);
    app_info.apiVersion = VK_API_VERSION_1_3;

    uint32_t glfw_ext_count = 0;
    const char** glfw_exts = glfwGetRequiredInstanceExtensions(&glfw_ext_count);
    std::vector<const char*> extensions(glfw_exts, glfw_exts + glfw_ext_count);

    extensions.push_back(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);

#ifndef NDEBUG
    extensions.push_back(VK_EXT_DEBUG_UTILS_EXTENSION_NAME);
#endif

    VkInstanceCreateInfo create_info{};
    create_info.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    create_info.pApplicationInfo = &app_info;
    create_info.enabledExtensionCount = static_cast<uint32_t>(extensions.size());
    create_info.ppEnabledExtensionNames = extensions.data();
    create_info.flags |= VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR;

#ifndef NDEBUG
    const char* validation_layer = "VK_LAYER_KHRONOS_validation";
    create_info.enabledLayerCount = 1;
    create_info.ppEnabledLayerNames = &validation_layer;
#else
    create_info.enabledLayerCount = 0;
#endif

    if (vkCreateInstance(&create_info, nullptr, &instance_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create Vulkan instance");
    }
}

void VkContext::setup_debug_messenger() {
#ifndef NDEBUG
    VkDebugUtilsMessengerCreateInfoEXT info{};
    info.sType = VK_STRUCTURE_TYPE_DEBUG_UTILS_MESSENGER_CREATE_INFO_EXT;
    info.messageSeverity = VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT |
                           VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT;
    info.messageType = VK_DEBUG_UTILS_MESSAGE_TYPE_GENERAL_BIT_EXT |
                       VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT |
                       VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT;
    info.pfnUserCallback = debug_callback;

    auto func = reinterpret_cast<PFN_vkCreateDebugUtilsMessengerEXT>(
        vkGetInstanceProcAddr(instance_, "vkCreateDebugUtilsMessengerEXT"));
    if (func) {
        func(instance_, &info, nullptr, &debug_messenger_);
    }
#endif
}

void VkContext::create_surface(GLFWwindow* window) {
    if (glfwCreateWindowSurface(instance_, window, nullptr, &surface_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create window surface");
    }
}

int32_t VkContext::find_queue_family() const {
    uint32_t count = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(physical_device_, &count, nullptr);
    std::vector<VkQueueFamilyProperties> families(count);
    vkGetPhysicalDeviceQueueFamilyProperties(physical_device_, &count, families.data());

    for (uint32_t i = 0; i < count; i++) {
        VkBool32 present_support = VK_FALSE;
        vkGetPhysicalDeviceSurfaceSupportKHR(physical_device_, i, surface_, &present_support);

        if ((families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) && present_support) {
            return static_cast<int32_t>(i);
        }
    }
    return -1;
}

std::vector<const char*> VkContext::get_required_device_extensions() const {
    std::vector<const char*> extensions = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};

    uint32_t ext_count = 0;
    vkEnumerateDeviceExtensionProperties(physical_device_, nullptr, &ext_count, nullptr);
    std::vector<VkExtensionProperties> available(ext_count);
    vkEnumerateDeviceExtensionProperties(physical_device_, nullptr, &ext_count, available.data());

    for (const auto& ext : available) {
        if (std::strcmp(ext.extensionName, "VK_KHR_portability_subset") == 0) {
            extensions.push_back("VK_KHR_portability_subset");
            break;
        }
    }

    return extensions;
}

void VkContext::pick_physical_device() {
    uint32_t count = 0;
    vkEnumeratePhysicalDevices(instance_, &count, nullptr);
    if (count == 0) {
        throw std::runtime_error("No Vulkan-capable GPU found");
    }

    std::vector<VkPhysicalDevice> devices(count);
    vkEnumeratePhysicalDevices(instance_, &count, devices.data());

    VkPhysicalDevice fallback = VK_NULL_HANDLE;

    for (auto dev : devices) {
        physical_device_ = dev;
        if (find_queue_family() < 0) continue;

        VkPhysicalDeviceProperties props;
        vkGetPhysicalDeviceProperties(dev, &props);

        if (props.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) {
            physical_device_ = dev;
            return;
        }
        if (fallback == VK_NULL_HANDLE) {
            fallback = dev;
        }
    }

    if (fallback != VK_NULL_HANDLE) {
        physical_device_ = fallback;
    } else {
        throw std::runtime_error("No suitable GPU found");
    }
}

void VkContext::create_logical_device() {
    graphics_queue_family_ = static_cast<uint32_t>(find_queue_family());

    float priority = 1.0f;
    VkDeviceQueueCreateInfo queue_info{};
    queue_info.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    queue_info.queueFamilyIndex = graphics_queue_family_;
    queue_info.queueCount = 1;
    queue_info.pQueuePriorities = &priority;

    VkPhysicalDeviceFeatures features{};

    auto extensions = get_required_device_extensions();

    VkDeviceCreateInfo create_info{};
    create_info.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    create_info.queueCreateInfoCount = 1;
    create_info.pQueueCreateInfos = &queue_info;
    create_info.pEnabledFeatures = &features;
    create_info.enabledExtensionCount = static_cast<uint32_t>(extensions.size());
    create_info.ppEnabledExtensionNames = extensions.data();

    if (vkCreateDevice(physical_device_, &create_info, nullptr, &device_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create logical device");
    }

    vkGetDeviceQueue(device_, graphics_queue_family_, 0, &graphics_queue_);
}

void VkContext::create_allocator() {
    VmaAllocatorCreateInfo info{};
    info.vulkanApiVersion = VK_API_VERSION_1_3;
    info.physicalDevice = physical_device_;
    info.device = device_;
    info.instance = instance_;

    if (vmaCreateAllocator(&info, &allocator_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create VMA allocator");
    }
}

}  // namespace gseurat
