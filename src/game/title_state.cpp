#include "vulkan_game/game/states/title_state.hpp"
#include "vulkan_game/game/states/gameplay_state.hpp"
#include "vulkan_game/app.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

namespace vulkan_game {

void TitleState::on_enter(App& app) {
    blink_timer_ = 0.0f;
    show_prompt_ = true;
    selected_item_ = 0;

    // Check if any save exists
    int recent = app.save_system().most_recent_slot();
    has_save_ = (recent >= 0);

    app.ui_ctx().set_menu_selection(0);
}

void TitleState::update(App& app, float dt) {
    blink_timer_ += dt;
    if (blink_timer_ >= 0.5f) {
        blink_timer_ -= 0.5f;
        show_prompt_ = !show_prompt_;
    }

    int item_count = has_save_ ? 2 : 1;

    if (app.input().was_key_pressed(GLFW_KEY_W) ||
        app.input().was_key_pressed(GLFW_KEY_UP)) {
        selected_item_ = (selected_item_ - 1 + item_count) % item_count;
        app.ui_ctx().set_menu_selection(selected_item_);
    }
    if (app.input().was_key_pressed(GLFW_KEY_S) ||
        app.input().was_key_pressed(GLFW_KEY_DOWN)) {
        selected_item_ = (selected_item_ + 1) % item_count;
        app.ui_ctx().set_menu_selection(selected_item_);
    }
}

void TitleState::build_draw_lists(App& app) {
    auto& ctx = app.ui_ctx();
    auto& ui = app.ui_sprites();

    // Title
    ctx.label("HD-2D Vulkan Game", 400.0f, 250.0f, 1.2f, {1.0f, 0.9f, 0.3f, 1.0f});

    // Blinking prompt if no menu
    if (!has_save_ && show_prompt_) {
        ctx.label("Press Enter", 520.0f, 400.0f, 0.7f, {0.8f, 0.8f, 0.8f, 1.0f});
    }

    // Menu items
    ctx.begin_menu(640.0f, 380.0f, 50.0f);

    if (ctx.menu_item("New Game", 0.7f)) {
        app.state_stack().replace(std::make_unique<GameplayState>(), app);
    }

    if (has_save_) {
        if (ctx.menu_item("Continue", 0.7f)) {
            int slot = app.save_system().most_recent_slot();
            auto loaded = app.save_system().load(slot);
            if (loaded) {
                app.state_stack().replace(std::make_unique<GameplayState>(), app);
                app.apply_save_data(*loaded);
            }
        }
    }

    selected_item_ = ctx.menu_selection();

    const auto& draw_list = ctx.draw_list();
    ui.insert(ui.end(), draw_list.begin(), draw_list.end());
}

}  // namespace vulkan_game
