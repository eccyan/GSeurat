#include "vulkan_game/demo/demo_gameplay_state.hpp"
#include "vulkan_game/app.hpp"
#include "vulkan_game/game/states/pause_state.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <string>

namespace vulkan_game {

void DemoGameplayState::on_enter(App& app) {
    app.init_scene(app.current_scene_path());
}

void DemoGameplayState::on_exit(App& /*app*/) {
}

void DemoGameplayState::update(App& app, float dt) {
    // F1 toggles panel visibility
    if (app.input().was_key_pressed(GLFW_KEY_F1)) {
        panel_visible_ = !panel_visible_;
    }

    // Escape toggles pause
    if (app.input().was_key_pressed(GLFW_KEY_ESCAPE)) {
        app.state_stack().push(std::make_unique<PauseState>(), app);
        return;
    }

    // Panel navigation (arrow keys, no conflict with WASD)
    if (panel_visible_) {
        constexpr int item_count = 24;
        if (app.input().was_key_pressed(GLFW_KEY_UP)) {
            selected_item_ = (selected_item_ - 1 + item_count) % item_count;
            scroll_needs_update_ = true;
        }
        if (app.input().was_key_pressed(GLFW_KEY_DOWN)) {
            selected_item_ = (selected_item_ + 1) % item_count;
            scroll_needs_update_ = true;
        }
        if (app.input().was_key_pressed(GLFW_KEY_ENTER)) {
            auto entries = FeatureFlags::entries();
            auto& flags = app.feature_flags();
            flags.*(entries[selected_item_].ptr) = !(flags.*(entries[selected_item_].ptr));
        }
    }

    app.update_game(dt);
}

void DemoGameplayState::build_draw_lists(App& app) {
    if (!panel_visible_) return;

    auto& ui = app.ui_ctx();

    // Panel background
    // UI uses Y-UP coordinates: y=0 is screen bottom, y=720 is screen top.
    constexpr float panel_x = 930.0f;
    constexpr float panel_w = 350.0f;
    constexpr float panel_h = 720.0f;
    ui.panel(panel_x + panel_w * 0.5f, panel_h * 0.5f, panel_w, panel_h,
             {0.02f, 0.02f, 0.08f, 0.92f});

    // Title near screen top (high Y) — outside scroll area (always visible)
    ui.label("FEATURE DEMO", panel_x + 20.0f, 700.0f, 0.7f, {1.0f, 0.85f, 0.2f, 1.0f});
    ui.label("[F1]", panel_x + panel_w - 60.0f, 700.0f, 0.5f, {0.5f, 0.5f, 0.5f, 1.0f});

    // Scroll area for feature items
    // Area: from y=60 (near bottom) to y=670 (below title), height=610
    constexpr float scroll_area_y = 60.0f;
    constexpr float scroll_area_h = 610.0f;

    // Pre-calculate content height by simulating the layout
    auto entries = FeatureFlags::entries();
    const auto& flags = app.feature_flags();
    float content_height = 0.0f;
    {
        std::string_view cat;
        for (int i = 0; i < static_cast<int>(entries.size()); ++i) {
            if (entries[i].category != cat) {
                cat = entries[i].category;
                content_height += 8.0f + 30.0f;  // category gap + header
            }
            content_height += 32.0f;  // item
        }
        content_height += 10.0f;  // bottom padding
    }

    ui.begin_scroll_area("demo_features", panel_x, scroll_area_y,
                          panel_w, scroll_area_h, content_height);

    // Content Y positions: start at top of scroll area and go down (Y-UP)
    // UIContext internally applies scroll offset, so use content-space positions
    float y = scroll_area_y + scroll_area_h - 10.0f;
    std::string_view current_category;

    for (int i = 0; i < static_cast<int>(entries.size()); ++i) {
        const auto& entry = entries[i];

        // Category header
        if (entry.category != current_category) {
            current_category = entry.category;
            y -= 8.0f;
            ui.label(std::string(current_category), panel_x + 20.0f, y, 0.5f,
                     {0.4f, 0.6f, 0.9f, 1.0f});
            y -= 30.0f;
        }

        // Selection indicator
        bool selected = (i == selected_item_);
        glm::vec4 text_color = selected ? glm::vec4{1.0f, 1.0f, 1.0f, 1.0f}
                                        : glm::vec4{0.7f, 0.7f, 0.7f, 1.0f};

        // Highlight bar for selected item
        if (selected) {
            ui.panel(panel_x + panel_w * 0.5f, y - 10.0f, panel_w - 10.0f, 28.0f,
                     {0.15f, 0.15f, 0.35f, 0.8f});
        }

        // Auto-scroll to keep selected item visible
        if (selected && scroll_needs_update_) {
            ui.scroll_to_visible(y - 10.0f, 32.0f);
            scroll_needs_update_ = false;
        }

        // Cursor
        std::string cursor = selected ? "> " : "  ";

        // ON/OFF toggle
        bool value = flags.*(entry.ptr);
        std::string toggle = value ? "[ON]" : "[--]";
        glm::vec4 toggle_color = value ? glm::vec4{0.2f, 1.0f, 0.3f, 1.0f}
                                       : glm::vec4{0.6f, 0.3f, 0.3f, 1.0f};

        ui.label(cursor + toggle, panel_x + 15.0f, y, 0.55f, toggle_color);
        ui.label(std::string(entry.name), panel_x + 105.0f, y, 0.55f, text_color);
        ui.label(std::string(entry.phase), panel_x + panel_w - 45.0f, y, 0.45f,
                 {0.5f, 0.5f, 0.5f, 1.0f});

        y -= 32.0f;
    }

    ui.end_scroll_area();

    // Help text near screen bottom (low Y) — outside scroll area (always visible)
    ui.label("Up/Down:Nav Enter:Toggle Scroll:Mouse", panel_x + 20.0f, 30.0f, 0.4f,
             {0.4f, 0.4f, 0.4f, 1.0f});
}

}  // namespace vulkan_game
