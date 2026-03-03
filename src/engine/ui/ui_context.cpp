#include "vulkan_game/engine/ui/ui_context.hpp"

namespace vulkan_game::ui {

void UIContext::init(const FontAtlas& atlas, const TextRenderer& text_renderer) {
    atlas_ = &atlas;
    text_renderer_ = &text_renderer;
}

void UIContext::begin_frame(const UIInput& input) {
    input_ = input;
    draw_list_.clear();
    hot_widget_ = -1;
    next_widget_id_ = 0;
    menu_item_index_ = 0;

    // Keyboard navigation
    if (focus_count_ > 0) {
        if (input_.key_up) {
            focused_index_ = (focused_index_ - 1 + focus_count_) % focus_count_;
        }
        if (input_.key_down_nav) {
            focused_index_ = (focused_index_ + 1) % focus_count_;
        }
    }
}

void UIContext::draw_rect(float x, float y, float w, float h, glm::vec4 color) {
    SpriteDrawInfo info{};
    info.position = {x, y, 0.5f};
    info.size = {w, h};
    info.color = color;
    // Use a single texel from the font atlas for solid color
    if (atlas_) {
        const GlyphInfo* dot = atlas_->glyph('.');
        if (dot && dot->size.x > 0) {
            glm::vec2 center = (dot->uv_min + dot->uv_max) * 0.5f;
            info.uv_min = center;
            info.uv_max = center;
        }
    }
    draw_list_.push_back(info);
}

bool UIContext::hit_test(float x, float y, float w, float h) const {
    float left = x - w * 0.5f;
    float top = y - h * 0.5f;
    return input_.mouse_pos.x >= left && input_.mouse_pos.x <= left + w &&
           input_.mouse_pos.y >= top && input_.mouse_pos.y <= top + h;
}

void UIContext::label(const std::string& text, float x, float y, float scale,
                      glm::vec4 color) {
    if (!text_renderer_) return;
    auto sprites = text_renderer_->render_text(text, x, y, 0.0f, scale, color);
    draw_list_.insert(draw_list_.end(), sprites.begin(), sprites.end());
}

bool UIContext::button(const std::string& text, float x, float y, float w, float h,
                       float text_scale) {
    int id = next_widget_id_++;
    bool hovered = hit_test(x, y, w, h);
    bool focused = (id == focused_index_);
    bool clicked = false;

    // Mouse interaction
    if (hovered && input_.mouse_pressed) {
        clicked = true;
    }
    // Keyboard interaction
    if (focused && input_.key_enter) {
        clicked = true;
    }
    // Mouse hover updates focus
    if (hovered && (input_.mouse_pos.x != 0.0f || input_.mouse_pos.y != 0.0f)) {
        focused_index_ = id;
        focused = true;
    }

    // Draw background
    glm::vec4 bg_color = focused ? glm::vec4{0.2f, 0.2f, 0.35f, 0.9f}
                                 : glm::vec4{0.1f, 0.1f, 0.2f, 0.8f};
    if (hovered && input_.mouse_down) {
        bg_color = {0.3f, 0.3f, 0.45f, 0.95f};
    }
    draw_rect(x, y, w, h, bg_color);

    // Draw text centered
    if (text_renderer_) {
        auto text_size = text_renderer_->measure_text(text, text_scale);
        float text_x = x - text_size.x * 0.5f;
        float text_y = y - text_size.y * 0.5f;
        glm::vec4 text_color = focused ? glm::vec4{1.0f, 0.9f, 0.3f, 1.0f}
                                       : glm::vec4{0.8f, 0.8f, 0.8f, 1.0f};
        auto sprites = text_renderer_->render_text(text, text_x, text_y, 0.0f, text_scale, text_color);
        draw_list_.insert(draw_list_.end(), sprites.begin(), sprites.end());
    }

    return clicked;
}

void UIContext::panel(float x, float y, float w, float h, glm::vec4 color) {
    draw_rect(x, y, w, h, color);
}

void UIContext::begin_menu(float x, float y, float item_height) {
    menu_x_ = x;
    menu_y_ = y;
    menu_item_height_ = item_height;
    menu_item_index_ = 0;
}

bool UIContext::menu_item(const std::string& text, float text_scale) {
    int idx = menu_item_index_++;
    float y = menu_y_ + static_cast<float>(idx) * menu_item_height_;
    bool selected = (idx == menu_selected_);
    bool hovered = hit_test(menu_x_, y, 200.0f, menu_item_height_);
    bool clicked = false;

    // Mouse hover updates selection
    if (hovered) {
        menu_selected_ = idx;
        selected = true;
    }
    if (hovered && input_.mouse_pressed) clicked = true;

    // Keyboard navigation updates selection
    if (input_.key_up || input_.key_down_nav) {
        // menu_selected_ is already updated by keyboard nav if we map it
    }

    // Draw text with selection highlight
    glm::vec4 color = selected ? glm::vec4{1.0f, 0.9f, 0.3f, 1.0f}
                               : glm::vec4{0.7f, 0.7f, 0.7f, 1.0f};
    std::string display = selected ? "> " + text : "  " + text;
    if (text_renderer_) {
        auto sprites = text_renderer_->render_text(
            display, menu_x_ - 80.0f, y - menu_item_height_ * 0.3f,
            0.0f, text_scale, color);
        draw_list_.insert(draw_list_.end(), sprites.begin(), sprites.end());
    }

    // Enter key on selected item
    if (selected && input_.key_enter) clicked = true;

    return clicked;
}

}  // namespace vulkan_game::ui
