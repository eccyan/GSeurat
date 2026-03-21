#pragma once

#include <array>

#include <glm/glm.hpp>

struct GLFWwindow;

// GLFW_KEY_LAST is 348
constexpr int kKeyCount = 349;

namespace gseurat {

class InputManager {
public:
    void set_window(GLFWwindow* window);
    void update();
    bool is_key_down(int glfw_key) const;
    bool was_key_pressed(int glfw_key) const;

    // Mouse
    glm::vec2 mouse_pos() const { return mouse_pos_; }
    bool is_mouse_down(int button = 0) const;
    bool was_mouse_pressed(int button = 0) const;

    // Scroll wheel (accumulated delta since last update)
    float scroll_y_delta() const { return scroll_y_delta_; }

    // External injection (for ControlServer / AI agent)
    void inject_key(int glfw_key, bool down);   // persistent hold (WASD, Shift)
    void inject_key_once(int glfw_key);          // single-frame pulse (E)
    void clear_injections();

private:
    GLFWwindow* window_ = nullptr;
    std::array<bool, kKeyCount> current_{};
    std::array<bool, kKeyCount> previous_{};
    std::array<bool, kKeyCount> injected_{};     // persistent key state
    std::array<bool, kKeyCount> inject_once_{};  // single-frame pulse

    // Mouse state
    glm::vec2 mouse_pos_{0.0f};
    std::array<bool, 3> mouse_current_{};
    std::array<bool, 3> mouse_previous_{};

    // Scroll wheel
    float scroll_y_delta_ = 0.0f;
    float scroll_y_accum_ = 0.0f;
};

}  // namespace gseurat
