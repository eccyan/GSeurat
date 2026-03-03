#include "vulkan_game/engine/input_manager.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

namespace vulkan_game {

void InputManager::update() {
    if (!window_) return;
    previous_ = current_;
    for (int key = 0; key < kKeyCount; key++) {
        current_[key] = glfwGetKey(window_, key) == GLFW_PRESS;
    }
}

bool InputManager::is_key_down(int glfw_key) const {
    if (glfw_key < 0 || glfw_key >= kKeyCount) return false;
    return current_[glfw_key];
}

bool InputManager::was_key_pressed(int glfw_key) const {
    if (glfw_key < 0 || glfw_key >= kKeyCount) return false;
    return current_[glfw_key] && !previous_[glfw_key];
}

}  // namespace vulkan_game
