#pragma once

#include "vulkan_game/engine/font_atlas.hpp"
#include "vulkan_game/engine/sprite_batch.hpp"
#include "vulkan_game/engine/text_renderer.hpp"

#include <glm/glm.hpp>
#include <string>
#include <vector>

namespace vulkan_game::ui {

struct UIInput {
    glm::vec2 mouse_pos{0.0f};
    bool mouse_down = false;
    bool mouse_pressed = false;  // rising edge
    bool key_up = false;         // rising edge
    bool key_down_nav = false;   // rising edge (renamed to avoid conflict)
    bool key_enter = false;      // rising edge
    bool key_escape = false;     // rising edge
};

class UIContext {
public:
    void init(const FontAtlas& atlas, const TextRenderer& text_renderer);
    void begin_frame(const UIInput& input);
    const std::vector<SpriteDrawInfo>& draw_list() const { return draw_list_; }

    // Widgets
    void label(const std::string& text, float x, float y, float scale,
               glm::vec4 color = {1.0f, 1.0f, 1.0f, 1.0f});
    bool button(const std::string& text, float x, float y, float w, float h,
                float text_scale = 0.6f);
    void panel(float x, float y, float w, float h,
               glm::vec4 color = {0.05f, 0.05f, 0.12f, 0.88f});

    // Layout helpers for vertical menus
    void begin_menu(float x, float y, float item_height = 50.0f);
    bool menu_item(const std::string& text, float text_scale = 0.7f);
    int menu_selection() const { return menu_selected_; }
    void set_menu_selection(int idx) { menu_selected_ = idx; }

    // Keyboard navigation
    void set_focus_count(int count) { focus_count_ = count; }
    int focused_index() const { return focused_index_; }

private:
    void draw_rect(float x, float y, float w, float h, glm::vec4 color);
    bool hit_test(float x, float y, float w, float h) const;

    const FontAtlas* atlas_ = nullptr;
    const TextRenderer* text_renderer_ = nullptr;
    UIInput input_{};
    std::vector<SpriteDrawInfo> draw_list_;

    // Focus/hot tracking
    int focused_index_ = 0;
    int focus_count_ = 0;
    int hot_widget_ = -1;
    int next_widget_id_ = 0;

    // Menu state
    float menu_x_ = 0.0f;
    float menu_y_ = 0.0f;
    float menu_item_height_ = 50.0f;
    int menu_item_index_ = 0;
    int menu_selected_ = 0;
};

}  // namespace vulkan_game::ui
