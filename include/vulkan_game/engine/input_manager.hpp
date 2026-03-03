#pragma once

#include <array>

struct GLFWwindow;

// GLFW_KEY_LAST is 348
constexpr int kKeyCount = 349;

namespace vulkan_game {

class InputManager {
public:
    void set_window(GLFWwindow* window) { window_ = window; }
    void update();
    bool is_key_down(int glfw_key) const;
    bool was_key_pressed(int glfw_key) const;

private:
    GLFWwindow* window_ = nullptr;
    std::array<bool, kKeyCount> current_{};
    std::array<bool, kKeyCount> previous_{};
};

}  // namespace vulkan_game
