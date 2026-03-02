#pragma once

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <cstdint>

namespace vulkan_game {

class App {
public:
    void run();

private:
    void init_window();
    void init_vulkan();
    void main_loop();
    void cleanup();

    void create_instance();

    GLFWwindow* window_ = nullptr;
    VkInstance instance_ = VK_NULL_HANDLE;

    static constexpr uint32_t kWindowWidth = 1280;
    static constexpr uint32_t kWindowHeight = 720;
};

}  // namespace vulkan_game
