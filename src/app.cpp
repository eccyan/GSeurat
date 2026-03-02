#include "vulkan_game/app.hpp"
#include "vulkan_game/engine/tilemap.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

namespace vulkan_game {

void App::run() {
    init_window();
    renderer_.init(window_);
    init_scene();
    main_loop();
    cleanup();
}

void App::init_window() {
    glfwInit();
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);

    window_ = glfwCreateWindow(kWindowWidth, kWindowHeight, "Vulkan Game", nullptr, nullptr);
    input_.set_window(window_);
}

void App::init_scene() {
    // Create player entity at origin
    player_entity_ = scene_.create_entity();
    player_entity_->transform.position = {0.0f, 0.0f, 0.0f};
    player_entity_->transform.scale = {1.0f, 1.0f};
    player_entity_->tint = {1.0f, 1.0f, 1.0f, 1.0f};

    // Camera follows player
    renderer_.camera().set_follow_target(player_entity_->transform.position);
    renderer_.camera().set_follow_speed(5.0f);

    // Test tilemap: 8x8 grid, all tile 0, using a 16x16-pixel single-tile sheet
    TileLayer layer{};
    layer.tileset = Tileset{16, 16, 1, 16, 16};
    layer.width = 8;
    layer.height = 8;
    layer.tile_size = 1.0f;
    layer.z = 1.0f;  // behind player at Z=0
    layer.tiles.assign(64, 0);
    scene_.set_tile_layer(std::move(layer));
}

void App::update_game() {
    constexpr float kMoveSpeed = 4.0f;
    float dt = 1.0f / 60.0f;  // approximate; camera uses real dt internally

    if (player_entity_) {
        auto& pos = player_entity_->transform.position;
        if (input_.is_key_down(GLFW_KEY_W)) pos.y += kMoveSpeed * dt;
        if (input_.is_key_down(GLFW_KEY_S)) pos.y -= kMoveSpeed * dt;
        if (input_.is_key_down(GLFW_KEY_A)) pos.x -= kMoveSpeed * dt;
        if (input_.is_key_down(GLFW_KEY_D)) pos.x += kMoveSpeed * dt;

        renderer_.camera().set_follow_target(pos);
    }

    if (input_.is_key_down(GLFW_KEY_ESCAPE)) {
        glfwSetWindowShouldClose(window_, GLFW_TRUE);
    }
}

void App::main_loop() {
    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();
        update_game();
        renderer_.draw_scene(scene_);
    }
}

void App::cleanup() {
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

}  // namespace vulkan_game
