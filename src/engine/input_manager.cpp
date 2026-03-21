#include "gseurat/engine/input_manager.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

namespace gseurat {

void InputManager::set_window(GLFWwindow* window) {
    window_ = window;
    if (window_) {
        glfwSetWindowUserPointer(window_, this);
        glfwSetScrollCallback(window_, [](GLFWwindow* w, double /*xoffset*/, double yoffset) {
            auto* self = static_cast<InputManager*>(glfwGetWindowUserPointer(w));
            if (self) self->scroll_y_accum_ += static_cast<float>(yoffset);
        });
    }
}

void InputManager::update() {
    if (!window_) return;
    previous_ = current_;
    for (int key = 0; key < kKeyCount; key++) {
        current_[key] = (glfwGetKey(window_, key) == GLFW_PRESS)
                      || injected_[key]
                      || inject_once_[key];
    }
    inject_once_.fill(false);

    // Scroll wheel
    scroll_y_delta_ = scroll_y_accum_;
    scroll_y_accum_ = 0.0f;

    // Mouse
    double mx, my;
    glfwGetCursorPos(window_, &mx, &my);
    mouse_pos_ = {static_cast<float>(mx), static_cast<float>(my)};
    mouse_previous_ = mouse_current_;
    for (int i = 0; i < 3; i++) {
        mouse_current_[i] = (glfwGetMouseButton(window_, i) == GLFW_PRESS);
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

bool InputManager::is_mouse_down(int button) const {
    if (button < 0 || button >= 3) return false;
    return mouse_current_[button];
}

bool InputManager::was_mouse_pressed(int button) const {
    if (button < 0 || button >= 3) return false;
    return mouse_current_[button] && !mouse_previous_[button];
}

void InputManager::inject_key(int glfw_key, bool down) {
    if (glfw_key >= 0 && glfw_key < kKeyCount)
        injected_[glfw_key] = down;
}

void InputManager::inject_key_once(int glfw_key) {
    if (glfw_key >= 0 && glfw_key < kKeyCount)
        inject_once_[glfw_key] = true;
}

void InputManager::clear_injections() {
    injected_.fill(false);
    inject_once_.fill(false);
}

}  // namespace gseurat
