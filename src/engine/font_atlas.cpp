#define STB_RECT_PACK_IMPLEMENTATION
#include <stb_rect_pack.h>

#define STB_TRUETYPE_IMPLEMENTATION
#include <stb_truetype.h>

#include "gseurat/engine/font_atlas.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <stdexcept>

namespace gseurat {

void FontAtlas::init(const std::string& ttf_path, float font_size,
                     const std::vector<uint32_t>& codepoints) {
    // Read TTF file
    std::ifstream file(ttf_path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open font file: " + ttf_path);
    }
    auto file_size = static_cast<size_t>(file.tellg());
    std::vector<uint8_t> ttf_data(file_size);
    file.seekg(0);
    file.read(reinterpret_cast<char*>(ttf_data.data()), static_cast<std::streamsize>(file_size));

    // Init stb_truetype
    stbtt_fontinfo font_info{};
    if (!stbtt_InitFont(&font_info, ttf_data.data(),
                        stbtt_GetFontOffsetForIndex(ttf_data.data(), 0))) {
        throw std::runtime_error("Failed to init font: " + ttf_path);
    }

    float scale = stbtt_ScaleForPixelHeight(&font_info, font_size);

    // Get font vertical metrics
    int ascent, descent, line_gap;
    stbtt_GetFontVMetrics(&font_info, &ascent, &descent, &line_gap);
    line_height_ = (ascent - descent + line_gap) * scale;

    // Deduplicate codepoints and always include space (32)
    std::vector<uint32_t> unique_cps(codepoints.begin(), codepoints.end());
    unique_cps.push_back(32);  // ensure space is always present
    std::sort(unique_cps.begin(), unique_cps.end());
    unique_cps.erase(std::unique(unique_cps.begin(), unique_cps.end()), unique_cps.end());

    // Get glyph bounding boxes and prepare rects for packing
    struct GlyphWork {
        uint32_t codepoint;
        int x0, y0, x1, y1;
        int advance_width, left_bearing;
    };

    std::vector<GlyphWork> work;
    work.reserve(unique_cps.size());
    for (uint32_t cp : unique_cps) {
        int glyph_index = stbtt_FindGlyphIndex(&font_info, static_cast<int>(cp));
        if (glyph_index == 0 && cp != 0) {
            continue;  // glyph not in font
        }

        GlyphWork gw{};
        gw.codepoint = cp;
        stbtt_GetCodepointBitmapBox(&font_info, static_cast<int>(cp), scale, scale,
                                    &gw.x0, &gw.y0, &gw.x1, &gw.y1);
        stbtt_GetCodepointHMetrics(&font_info, static_cast<int>(cp),
                                   &gw.advance_width, &gw.left_bearing);
        work.push_back(gw);
    }

    if (work.empty()) {
        throw std::runtime_error("No glyphs could be loaded from font");
    }

    // Prepare stb_rect_pack rects
    std::vector<stbrp_rect> rects(work.size());
    for (size_t i = 0; i < work.size(); i++) {
        int w = work[i].x1 - work[i].x0;
        int h = work[i].y1 - work[i].y0;
        rects[i].id = static_cast<int>(i);
        rects[i].w = static_cast<stbrp_coord>(std::max(w, 1) + 2);  // 1px padding
        rects[i].h = static_cast<stbrp_coord>(std::max(h, 1) + 2);
    }

    // Try packing at increasing atlas sizes
    atlas_w_ = 512;
    atlas_h_ = 512;
    bool packed = false;
    while (!packed && atlas_w_ <= 4096) {
        std::vector<stbrp_node> nodes(atlas_w_);
        stbrp_context pack_ctx{};
        stbrp_init_target(&pack_ctx, static_cast<int>(atlas_w_), static_cast<int>(atlas_h_),
                          nodes.data(), static_cast<int>(nodes.size()));
        if (stbrp_pack_rects(&pack_ctx, rects.data(), static_cast<int>(rects.size()))) {
            packed = true;
        } else {
            atlas_w_ *= 2;
            atlas_h_ *= 2;
        }
    }
    if (!packed) {
        throw std::runtime_error("Failed to pack font atlas (too many glyphs)");
    }

    // Allocate RGBA atlas (all zeros = transparent black)
    atlas_pixels_.resize(atlas_w_ * atlas_h_ * 4, 0);

    // Rasterize each glyph into the atlas
    for (size_t i = 0; i < work.size(); i++) {
        auto& gw = work[i];
        auto& rect = rects[i];

        int glyph_w = gw.x1 - gw.x0;
        int glyph_h = gw.y1 - gw.y0;

        if (glyph_w <= 0 || glyph_h <= 0) {
            // Invisible glyph (e.g., space) — store metrics only
            GlyphInfo info{};
            info.uv_min = {0.0f, 0.0f};
            info.uv_max = {0.0f, 0.0f};
            info.size = {0.0f, 0.0f};
            info.bearing = {gw.left_bearing * scale, static_cast<float>(gw.y0)};
            info.advance = gw.advance_width * scale;
            glyphs_[gw.codepoint] = info;
            continue;
        }

        // Render glyph to temp buffer
        std::vector<uint8_t> glyph_bitmap(glyph_w * glyph_h, 0);
        stbtt_MakeCodepointBitmap(&font_info, glyph_bitmap.data(), glyph_w, glyph_h, glyph_w,
                                  scale, scale, static_cast<int>(gw.codepoint));

        // Copy into atlas as RGBA (white + alpha)
        int dst_x = rect.x + 1;  // 1px padding offset
        int dst_y = rect.y + 1;
        for (int row = 0; row < glyph_h; row++) {
            for (int col = 0; col < glyph_w; col++) {
                uint8_t alpha = glyph_bitmap[row * glyph_w + col];
                size_t pixel = (static_cast<size_t>(dst_y + row) * atlas_w_ +
                                static_cast<size_t>(dst_x + col)) * 4;
                atlas_pixels_[pixel + 0] = 255;  // R
                atlas_pixels_[pixel + 1] = 255;  // G
                atlas_pixels_[pixel + 2] = 255;  // B
                atlas_pixels_[pixel + 3] = alpha; // A
            }
        }

        // Store glyph info
        GlyphInfo info{};
        info.uv_min = {static_cast<float>(dst_x) / atlas_w_,
                       static_cast<float>(dst_y) / atlas_h_};
        info.uv_max = {static_cast<float>(dst_x + glyph_w) / atlas_w_,
                       static_cast<float>(dst_y + glyph_h) / atlas_h_};
        info.size = {static_cast<float>(glyph_w), static_cast<float>(glyph_h)};
        info.bearing = {gw.left_bearing * scale, static_cast<float>(gw.y0)};
        info.advance = gw.advance_width * scale;
        glyphs_[gw.codepoint] = info;
    }
}

const GlyphInfo* FontAtlas::glyph(uint32_t codepoint) const {
    auto it = glyphs_.find(codepoint);
    if (it != glyphs_.end()) {
        return &it->second;
    }
    return nullptr;
}

}  // namespace gseurat
