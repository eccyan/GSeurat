#pragma once

#include "vulkan_game/engine/animation_state_machine.hpp"
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
    void update_npcs(float dt);
    void main_loop();
    void cleanup();
    static void generate_player_sheet();
    static void generate_tileset();

    enum class Direction { Down, Left, Right, Up };

    struct NpcAgent {
        Entity* entity       = nullptr;
        AnimationStateMachine anim;
        Direction dir        = Direction::Right;
        Direction reverse_dir = Direction::Left;
        float timer          = 0.0f;
        float interval       = 2.0f;  // seconds between direction reversals
        float speed          = 1.5f;
    };

    GLFWwindow* window_ = nullptr;
    Renderer renderer_;
    InputManager input_;
    Scene scene_;
    Entity* player_entity_ = nullptr;
    AnimationStateMachine player_anim_;
    Direction player_dir_ = Direction::Down;
    std::vector<NpcAgent> npcs_;
    std::chrono::steady_clock::time_point last_update_time_;
};

}  // namespace vulkan_game
