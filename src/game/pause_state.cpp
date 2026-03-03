#include "vulkan_game/game/states/pause_state.hpp"
#include "vulkan_game/app.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

namespace vulkan_game {

void PauseState::on_enter(App& app) {
    selected_item_ = 0;
    app.ui_ctx().set_menu_selection(0);
}

void PauseState::update(App& app, float dt) {
    (void)dt;

    if (app.input().was_key_pressed(GLFW_KEY_ESCAPE)) {
        app.state_stack().pop(app);
        return;
    }

    // Keyboard navigation for menu
    if (app.input().was_key_pressed(GLFW_KEY_W) ||
        app.input().was_key_pressed(GLFW_KEY_UP)) {
        selected_item_ = (selected_item_ + 1) % 2;
        app.ui_ctx().set_menu_selection(selected_item_);
    }
    if (app.input().was_key_pressed(GLFW_KEY_S) ||
        app.input().was_key_pressed(GLFW_KEY_DOWN)) {
        selected_item_ = (selected_item_ + 1) % 2;
        app.ui_ctx().set_menu_selection(selected_item_);
    }
}

void PauseState::build_draw_lists(App& app) {
    auto& ctx = app.ui_ctx();
    auto& ui = app.ui_sprites();

    // Darken background
    ctx.panel(640.0f, 360.0f, 1280.0f, 720.0f, {0.0f, 0.0f, 0.0f, 0.6f});

    // Title
    ctx.label("PAUSED", 560.0f, 250.0f, 1.0f, {1.0f, 1.0f, 1.0f, 1.0f});

    // Menu items
    ctx.begin_menu(640.0f, 370.0f, 50.0f);
    if (ctx.menu_item("Resume", 0.7f)) {
        app.state_stack().pop(app);
    }
    if (ctx.menu_item("Quit", 0.7f)) {
        glfwSetWindowShouldClose(app.window(), GLFW_TRUE);
    }

    // Sync selection back
    selected_item_ = ctx.menu_selection();

    const auto& draw_list = ctx.draw_list();
    ui.insert(ui.end(), draw_list.begin(), draw_list.end());
}

}  // namespace vulkan_game
