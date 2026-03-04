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

    // Keyboard navigation for 4-item menu
    if (app.input().was_key_pressed(GLFW_KEY_W) ||
        app.input().was_key_pressed(GLFW_KEY_UP)) {
        selected_item_ = (selected_item_ - 1 + 4) % 4;
        app.ui_ctx().set_menu_selection(selected_item_);
    }
    if (app.input().was_key_pressed(GLFW_KEY_S) ||
        app.input().was_key_pressed(GLFW_KEY_DOWN)) {
        selected_item_ = (selected_item_ + 1) % 4;
        app.ui_ctx().set_menu_selection(selected_item_);
    }
}

void PauseState::build_draw_lists(App& app) {
    auto& ctx = app.ui_ctx();

    ctx.panel(640.0f, 360.0f, 1280.0f, 720.0f, {0.0f, 0.0f, 0.0f, 0.6f});
    ctx.label("PAUSED", 560.0f, 220.0f, 1.0f, {1.0f, 1.0f, 1.0f, 1.0f});

    ctx.begin_menu(640.0f, 340.0f, 50.0f);
    if (ctx.menu_item("Resume", 0.7f)) {
        app.state_stack().pop(app);
    }
    if (ctx.menu_item("Save Game", 0.7f)) {
        // Quick save to slot 0
        auto save_data = app.build_save_data();
        app.save_system().save(0, save_data);
    }
    if (ctx.menu_item("Load Game", 0.7f)) {
        auto loaded = app.save_system().load(0);
        if (loaded) {
            app.apply_save_data(*loaded);
            app.state_stack().pop(app);
        }
    }
    if (ctx.menu_item("Quit", 0.7f)) {
        glfwSetWindowShouldClose(app.window(), GLFW_TRUE);
    }

    selected_item_ = ctx.menu_selection();
}

}  // namespace vulkan_game
