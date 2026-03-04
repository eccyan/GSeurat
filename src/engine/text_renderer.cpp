#include "vulkan_game/engine/text_renderer.hpp"

#include <cstdint>

namespace vulkan_game {

// Decode one UTF-8 codepoint from a byte sequence.
// Returns the codepoint and advances the index past the consumed bytes.
static uint32_t decode_utf8(const std::string& text, size_t& i) {
    uint8_t c = static_cast<uint8_t>(text[i]);
    uint32_t cp = 0;
    size_t remaining = text.size();

    if (c < 0x80) {
        cp = c;
        i += 1;
    } else if ((c & 0xE0) == 0xC0 && i + 1 < remaining) {
        cp = (c & 0x1F) << 6;
        cp |= (static_cast<uint8_t>(text[i + 1]) & 0x3F);
        i += 2;
    } else if ((c & 0xF0) == 0xE0 && i + 2 < remaining) {
        cp = (c & 0x0F) << 12;
        cp |= (static_cast<uint8_t>(text[i + 1]) & 0x3F) << 6;
        cp |= (static_cast<uint8_t>(text[i + 2]) & 0x3F);
        i += 3;
    } else if ((c & 0xF8) == 0xF0 && i + 3 < remaining) {
        cp = (c & 0x07) << 18;
        cp |= (static_cast<uint8_t>(text[i + 1]) & 0x3F) << 12;
        cp |= (static_cast<uint8_t>(text[i + 2]) & 0x3F) << 6;
        cp |= (static_cast<uint8_t>(text[i + 3]) & 0x3F);
        i += 4;
    } else {
        // Invalid byte — skip it
        cp = 0xFFFD;  // replacement character
        i += 1;
    }
    return cp;
}

void TextRenderer::init(const FontAtlas& atlas) {
    atlas_ = &atlas;
}

std::vector<SpriteDrawInfo> TextRenderer::render_text(const std::string& text,
                                                      float x, float y, float z,
                                                      float scale, glm::vec4 color,
                                                      bool y_up) const {
    std::vector<SpriteDrawInfo> sprites;
    if (!atlas_) return sprites;

    float cursor_x = x;
    size_t i = 0;
    while (i < text.size()) {
        uint32_t cp = decode_utf8(text, i);

        const GlyphInfo* g = atlas_->glyph(cp);
        if (!g) continue;

        // Skip invisible glyphs (like space) but advance cursor
        if (g->size.x > 0 && g->size.y > 0) {
            float glyph_x = cursor_x + g->bearing.x * scale;
            float glyph_w = g->size.x * scale;
            float glyph_h = g->size.y * scale;

            float center_y;
            if (y_up) {
                // Y-UP (UI ortho): bearing.y (stbtt y0) is negative for above-baseline.
                // Negate to get glyph top at higher Y, then center below it.
                float glyph_top = y - g->bearing.y * scale;
                center_y = glyph_top - glyph_h * 0.5f;
            } else {
                // Y-DOWN (3D camera): original convention
                float glyph_top = y + g->bearing.y * scale;
                center_y = glyph_top + glyph_h * 0.5f;
            }

            SpriteDrawInfo info{};
            info.position = {glyph_x + glyph_w * 0.5f, center_y, z};
            info.size = {glyph_w, glyph_h};
            info.color = color;
            info.uv_min = g->uv_min;
            info.uv_max = g->uv_max;
            sprites.push_back(info);
        }

        cursor_x += g->advance * scale;
    }

    return sprites;
}

glm::vec2 TextRenderer::measure_text(const std::string& text, float scale) const {
    if (!atlas_) return {0.0f, 0.0f};

    float width = 0.0f;
    size_t i = 0;
    while (i < text.size()) {
        uint32_t cp = decode_utf8(text, i);
        const GlyphInfo* g = atlas_->glyph(cp);
        if (g) {
            width += g->advance * scale;
        }
    }

    return {width, atlas_->line_height() * scale};
}

std::vector<SpriteDrawInfo> TextRenderer::render_wrapped(const std::string& text,
                                                         float x, float y, float z,
                                                         float scale, glm::vec4 color,
                                                         float max_width,
                                                         bool y_up) const {
    std::vector<SpriteDrawInfo> sprites;
    if (!atlas_) return sprites;

    float line_h = atlas_->line_height() * scale;
    float cursor_x = x;
    float cursor_y = y;

    // Split into words by spaces
    std::vector<std::string> words;
    std::string current_word;
    size_t i = 0;
    while (i < text.size()) {
        size_t prev = i;
        uint32_t cp = decode_utf8(text, i);
        if (cp == ' ') {
            if (!current_word.empty()) {
                words.push_back(current_word);
                current_word.clear();
            }
            words.emplace_back(" ");
        } else {
            current_word.append(text, prev, i - prev);
        }
    }
    if (!current_word.empty()) {
        words.push_back(current_word);
    }

    for (const auto& word : words) {
        if (word == " ") {
            // Advance by space width
            const GlyphInfo* space = atlas_->glyph(' ');
            if (space) {
                cursor_x += space->advance * scale;
            }
            continue;
        }

        float word_width = measure_text(word, scale).x;

        // Wrap if this word exceeds line width
        if (cursor_x + word_width > x + max_width && cursor_x > x) {
            cursor_x = x;
            // In Y-UP next line is lower (smaller Y); in Y-DOWN it's larger Y
            cursor_y += y_up ? -line_h : line_h;
        }

        // Render each character in the word
        auto word_sprites = render_text(word, cursor_x, cursor_y, z, scale, color, y_up);
        sprites.insert(sprites.end(), word_sprites.begin(), word_sprites.end());
        cursor_x += word_width;
    }

    return sprites;
}

}  // namespace vulkan_game
