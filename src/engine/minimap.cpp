#include "gseurat/engine/minimap.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

glm::vec4 Minimap::tile_color(uint16_t tile_id) {
    switch (tile_id) {
        case 0:      return {0.70f, 0.65f, 0.50f, 1.0f};  // floor — warm beige
        case 1:      return {0.25f, 0.22f, 0.20f, 1.0f};  // wall — dark gray
        case 2:
        case 3:
        case 4:      return {0.20f, 0.40f, 0.80f, 1.0f};  // water — blue
        case 5:
        case 6:
        case 7:      return {0.80f, 0.30f, 0.10f, 1.0f};  // lava — red-orange
        case 8:
        case 9:      return {0.35f, 0.28f, 0.20f, 1.0f};  // wall torch — warm tint
        case 0xFFFF: return {0.0f, 0.0f, 0.0f, 0.0f};     // empty — skip
        default:     return {0.50f, 0.50f, 0.50f, 1.0f};   // unknown — gray
    }
}

void Minimap::build_sprites(const TileLayer& layer,
                            glm::vec2 player_pos,
                            const std::vector<std::pair<glm::vec2, glm::vec4>>& npc_markers,
                            std::vector<SpriteDrawInfo>& out) {
    const float x0 = config_.screen_x;
    const float y0 = config_.screen_y;
    const float sz = config_.size;
    const float bd = config_.border;

    // All sprites use uv_min==uv_max==(0,0) to sample a single white texel (solid color).
    constexpr glm::vec2 kUV{0.0f, 0.0f};

    // Background
    out.push_back({
        {x0 + sz * 0.5f, y0 + sz * 0.5f, 0.0f},
        {sz, sz},
        config_.bg_color,
        kUV, kUV
    });

    // Border — 4 edge rects
    // Top
    out.push_back({{x0 + sz * 0.5f, y0 + sz - bd * 0.5f, 0.0f},
                    {sz, bd}, config_.border_color, kUV, kUV});
    // Bottom
    out.push_back({{x0 + sz * 0.5f, y0 + bd * 0.5f, 0.0f},
                    {sz, bd}, config_.border_color, kUV, kUV});
    // Left
    out.push_back({{x0 + bd * 0.5f, y0 + sz * 0.5f, 0.0f},
                    {bd, sz}, config_.border_color, kUV, kUV});
    // Right
    out.push_back({{x0 + sz - bd * 0.5f, y0 + sz * 0.5f, 0.0f},
                    {bd, sz}, config_.border_color, kUV, kUV});

    // Cell size
    const float inner = sz - 2.0f * bd;
    const uint32_t max_dim = std::max(layer.width, layer.height);
    if (max_dim == 0) return;
    const float cell = inner / static_cast<float>(max_dim);

    // Offset to center the map within the inner area
    const float offset_x = (inner - cell * static_cast<float>(layer.width)) * 0.5f;
    const float offset_y = (inner - cell * static_cast<float>(layer.height)) * 0.5f;

    // Tile quads
    for (uint32_t row = 0; row < layer.height; ++row) {
        for (uint32_t col = 0; col < layer.width; ++col) {
            uint16_t tile_id = layer.tiles[row * layer.width + col];
            if (tile_id == 0xFFFF) continue;

            glm::vec4 color = tile_color(tile_id);
            if (color.a <= 0.0f) continue;

            // Y-UP: row 0 = top of tilemap = top of minimap
            float cx = x0 + bd + offset_x + (static_cast<float>(col) + 0.5f) * cell;
            float cy = y0 + bd + offset_y + (static_cast<float>(layer.height - 1 - row) + 0.5f) * cell;

            out.push_back({{cx, cy, 0.0f}, {cell, cell}, color, kUV, kUV});
        }
    }

    // Map world position to minimap screen position
    auto world_to_minimap = [&](glm::vec2 world_pos) -> glm::vec2 {
        // Tilemap world coordinates: tile (col,row) center is at
        // x = (col + 0.5) * tile_size - width * tile_size / 2
        // y = -(row + 0.5) * tile_size + height * tile_size / 2
        float half_w = static_cast<float>(layer.width) * layer.tile_size * 0.5f;
        float half_h = static_cast<float>(layer.height) * layer.tile_size * 0.5f;

        // Normalized [0,1] within the tilemap
        float nx = (world_pos.x + half_w) / (static_cast<float>(layer.width) * layer.tile_size);
        float ny = (world_pos.y + half_h) / (static_cast<float>(layer.height) * layer.tile_size);

        // Clamp to minimap bounds
        nx = std::clamp(nx, 0.0f, 1.0f);
        ny = std::clamp(ny, 0.0f, 1.0f);

        float mx = x0 + bd + offset_x + nx * (cell * static_cast<float>(layer.width));
        float my = y0 + bd + offset_y + ny * (cell * static_cast<float>(layer.height));
        return {mx, my};
    };

    // Player marker — white dot, 4x4px
    {
        glm::vec2 mp = world_to_minimap(player_pos);
        out.push_back({{mp.x, mp.y, 0.0f}, {4.0f, 4.0f},
                        {1.0f, 1.0f, 1.0f, 1.0f}, kUV, kUV});
    }

    // NPC markers — colored dots, 3x3px
    for (const auto& [npc_pos, npc_color] : npc_markers) {
        glm::vec2 mp = world_to_minimap(npc_pos);
        glm::vec4 marker_color = npc_color;
        marker_color.a = 1.0f;  // ensure fully opaque
        out.push_back({{mp.x, mp.y, 0.0f}, {3.0f, 3.0f}, marker_color, kUV, kUV});
    }
}

}  // namespace gseurat
