#pragma once

#include "vulkan_game/engine/animation.hpp"
#include "vulkan_game/engine/input_manager.hpp"
#include "vulkan_game/engine/renderer.hpp"
#include "vulkan_game/engine/scene.hpp"
#include "vulkan_game/engine/types.hpp"

#include <chrono>

namespace vulkan_game {

class App {
public:
    void run();

private:
    void init_window();
    void init_scene();
    void update_game(float dt);
    void main_loop();
    void cleanup();
    static void generate_player_sheet();

    GLFWwindow* window_ = nullptr;
    Renderer renderer_;
    InputManager input_;
    Scene scene_;
    Entity* player_entity_ = nullptr;
    AnimationController player_anim_;
    std::chrono::steady_clock::time_point last_update_time_;
};

}  // namespace vulkan_game
