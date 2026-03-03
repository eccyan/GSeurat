#include "vulkan_game/game/states/title_state.hpp"
#include "vulkan_game/game/states/gameplay_state.hpp"
#include "vulkan_game/app.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

namespace vulkan_game {

void TitleState::on_enter(App& /*app*/) {
    blink_timer_ = 0.0f;
    show_prompt_ = true;
}

void TitleState::update(App& app, float dt) {
    blink_timer_ += dt;
    if (blink_timer_ >= 0.5f) {
        blink_timer_ -= 0.5f;
        show_prompt_ = !show_prompt_;
    }

    if (app.input().was_key_pressed(GLFW_KEY_ENTER) ||
        app.input().was_key_pressed(GLFW_KEY_SPACE) ||
        app.input().was_mouse_pressed(0)) {
        app.state_stack().replace(std::make_unique<GameplayState>(), app);
    }
}

void TitleState::build_draw_lists(App& app) {
    auto& ctx = app.ui_ctx();
    auto& ui = app.ui_sprites();

    // Title
    ctx.label("HD-2D Vulkan Game", 400.0f, 250.0f, 1.2f, {1.0f, 0.9f, 0.3f, 1.0f});

    // Blinking prompt
    if (show_prompt_) {
        ctx.label("Press Enter", 520.0f, 400.0f, 0.7f, {0.8f, 0.8f, 0.8f, 1.0f});
    }

    // Append UIContext draw list to UI sprites
    const auto& draw_list = ctx.draw_list();
    ui.insert(ui.end(), draw_list.begin(), draw_list.end());
}

}  // namespace vulkan_game
