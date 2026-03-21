#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include <glm/glm.hpp>

namespace gseurat {

struct GlyphInfo {
    glm::vec2 uv_min{0.0f};
    glm::vec2 uv_max{0.0f};
    glm::vec2 size{0.0f};      // glyph bitmap size in pixels
    glm::vec2 bearing{0.0f};   // offset from baseline origin
    float advance = 0.0f;      // horizontal advance in pixels
};

class FontAtlas {
public:
    void init(const std::string& ttf_path, float font_size,
              const std::vector<uint32_t>& codepoints);

    const GlyphInfo* glyph(uint32_t codepoint) const;
    const uint8_t* pixels() const { return atlas_pixels_.data(); }
    uint32_t width() const { return atlas_w_; }
    uint32_t height() const { return atlas_h_; }
    float line_height() const { return line_height_; }

private:
    std::unordered_map<uint32_t, GlyphInfo> glyphs_;
    std::vector<uint8_t> atlas_pixels_;
    uint32_t atlas_w_ = 0;
    uint32_t atlas_h_ = 0;
    float line_height_ = 0.0f;
};

}  // namespace gseurat
