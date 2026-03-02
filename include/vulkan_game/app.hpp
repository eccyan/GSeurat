#pragma once

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include "vulkan_game/engine/renderer.hpp"
#include "vulkan_game/engine/types.hpp"

namespace vulkan_game {

class App {
public:
    void run();

private:
    void init_window();
    void main_loop();
    void cleanup();

    GLFWwindow* window_ = nullptr;
    Renderer renderer_;
};

}  // namespace vulkan_game
