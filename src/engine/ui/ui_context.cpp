#include "gseurat/engine/ui/ui_context.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat::ui {

void UIContext::init(const FontAtlas& atlas, const TextRenderer& text_renderer) {
    atlas_ = &atlas;
    text_renderer_ = &text_renderer;
}

void UIContext::begin_frame(const UIInput& input) {
    input_ = input;
    batches_.clear();
    batches_.push_back(UIDrawBatch{{}, std::nullopt});  // initial unscissored batch
    flat_dirty_ = true;
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

const std::vector<SpriteDrawInfo>& UIContext::draw_list() const {
    if (flat_dirty_) {
        flat_cache_.clear();
        for (const auto& batch : batches_) {
            flat_cache_.insert(flat_cache_.end(), batch.sprites.begin(), batch.sprites.end());
        }
        flat_dirty_ = false;
    }
    return flat_cache_;
}

void UIContext::draw_rect(float x, float y, float w, float h, glm::vec4 color) {
    // When inside a scroll area, apply scroll offset and CPU-cull
    float draw_y = y;
    if (active_scroll_) {
        // Scroll offset > 0 means scrolled down → shift content UP (+Y in Y-UP)
        draw_y = y + active_scroll_->scroll_offset;
        // CPU-cull: if entirely outside the scroll area, skip
        float area_bottom = active_scroll_->y;
        float area_top = active_scroll_->y + active_scroll_->h;
        float rect_bottom = draw_y - h * 0.5f;
        float rect_top = draw_y + h * 0.5f;
        if (rect_top < area_bottom || rect_bottom > area_top) return;
    }

    SpriteDrawInfo info{};
    info.position = {x, draw_y, 0.5f};
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
    batches_.back().sprites.push_back(info);
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

    float draw_y = y;
    if (active_scroll_) {
        draw_y = y + active_scroll_->scroll_offset;
        // CPU-cull: estimate text height as scale * 30 pixels
        float est_h = scale * 30.0f;
        float area_bottom = active_scroll_->y;
        float area_top = active_scroll_->y + active_scroll_->h;
        if (draw_y + est_h < area_bottom || draw_y - est_h > area_top) return;
    }

    auto sprites = text_renderer_->render_text(text, x, draw_y, 0.0f, scale, color, true);
    batches_.back().sprites.insert(batches_.back().sprites.end(), sprites.begin(), sprites.end());
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
        auto sprites = text_renderer_->render_text(text, text_x, text_y, 0.0f, text_scale, text_color, true);
        batches_.back().sprites.insert(batches_.back().sprites.end(), sprites.begin(), sprites.end());
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
            0.0f, text_scale, color, true);
        batches_.back().sprites.insert(batches_.back().sprites.end(), sprites.begin(), sprites.end());
    }

    // Enter key on selected item
    if (selected && input_.key_enter) clicked = true;

    return clicked;
}

float UIContext::begin_scroll_area(const std::string& id, float x, float y, float w, float h,
                                   float content_height) {
    // Look up or create scroll state for this id
    auto& state = scroll_states_[id];

    // Apply mouse wheel scroll if mouse is inside the area
    // UI is Y-UP, mouse_pos from GLFW is Y-DOWN, but App already converts it
    // Check if mouse is inside the scroll area (Y-UP coords)
    float area_left = x;
    float area_right = x + w;
    float area_bottom = y;
    float area_top = y + h;
    float mx = input_.mouse_pos.x;
    // Convert GLFW mouse Y (Y-DOWN) to UI Y (Y-UP)
    float my = screen_height_ - input_.mouse_pos.y;

    if (mx >= area_left && mx <= area_right && my >= area_bottom && my <= area_top) {
        state.scroll_offset -= input_.scroll_delta * 40.0f;
    }

    // Clamp offset
    float max_offset = std::max(0.0f, content_height - h);
    state.scroll_offset = std::clamp(state.scroll_offset, 0.0f, max_offset);

    // Push new batch with scissor rect
    // Convert Y-UP UI coords to Y-DOWN Vulkan scissor coords
    ScissorRect scissor;
    scissor.x = static_cast<int32_t>(x);
    scissor.y = static_cast<int32_t>(screen_height_ - (y + h));
    scissor.width = static_cast<uint32_t>(w);
    scissor.height = static_cast<uint32_t>(h);
    batches_.push_back(UIDrawBatch{{}, scissor});

    // Set active scroll area
    active_scroll_ = ActiveScrollArea{id, x, y, w, h, content_height, state.scroll_offset};

    return state.scroll_offset;
}

void UIContext::scroll_to_visible(float item_y, float item_h) {
    if (!active_scroll_) return;

    auto& state = scroll_states_[active_scroll_->id];
    float area_bottom = active_scroll_->y;
    float area_top = active_scroll_->y + active_scroll_->h;

    // item_y is in content space (Y-UP). On screen: screen_y = item_y + scroll_offset.
    // Item occupies [item_y - item_h, item_y] in content space (Y-UP, top is item_y).
    float screen_top = item_y + state.scroll_offset;
    float screen_bottom = (item_y - item_h) + state.scroll_offset;

    // If item top is above visible area, reduce offset to bring it down
    if (screen_top > area_top) {
        state.scroll_offset = area_top - item_y;
    }
    // If item bottom is below visible area, increase offset to bring it up
    if (screen_bottom < area_bottom) {
        state.scroll_offset = area_bottom - (item_y - item_h);
    }

    float max_offset = std::max(0.0f, active_scroll_->content_height - active_scroll_->h);
    state.scroll_offset = std::clamp(state.scroll_offset, 0.0f, max_offset);

    // Update active scroll area's cached offset
    active_scroll_->scroll_offset = state.scroll_offset;
}

void UIContext::end_scroll_area() {
    if (!active_scroll_) return;

    // Draw scrollbar thumb if content exceeds area height
    float area_h = active_scroll_->h;
    float content_h = active_scroll_->content_height;
    if (content_h > area_h) {
        float thumb_ratio = area_h / content_h;
        float thumb_h = std::max(20.0f, area_h * thumb_ratio);
        float max_offset = content_h - area_h;
        float scroll_ratio = (max_offset > 0.0f) ? active_scroll_->scroll_offset / max_offset : 0.0f;
        // Thumb position in Y-UP: top of area minus offset from top
        float thumb_y = active_scroll_->y + area_h - thumb_h * 0.5f
                        - scroll_ratio * (area_h - thumb_h);
        float thumb_x = active_scroll_->x + active_scroll_->w - 4.0f;

        // Draw thin scrollbar (no scroll offset applied to the scrollbar itself)
        SpriteDrawInfo thumb{};
        thumb.position = {thumb_x, thumb_y, 0.5f};
        thumb.size = {6.0f, thumb_h};
        thumb.color = {0.5f, 0.5f, 0.6f, 0.5f};
        if (atlas_) {
            const GlyphInfo* dot = atlas_->glyph('.');
            if (dot && dot->size.x > 0) {
                glm::vec2 center = (dot->uv_min + dot->uv_max) * 0.5f;
                thumb.uv_min = center;
                thumb.uv_max = center;
            }
        }
        batches_.back().sprites.push_back(thumb);
    }

    active_scroll_ = std::nullopt;

    // Push new unscissored batch for content after scroll area
    batches_.push_back(UIDrawBatch{{}, std::nullopt});
}

}  // namespace gseurat::ui
