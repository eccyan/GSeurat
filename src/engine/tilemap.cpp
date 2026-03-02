#include "vulkan_game/engine/tilemap.hpp"

#include <cmath>

namespace vulkan_game {

glm::vec2 Tileset::uv_min(uint32_t tile_id) const {
    uint32_t col = tile_id % columns;
    uint32_t row = tile_id / columns;
    return {
        static_cast<float>(col * tile_width) / static_cast<float>(sheet_width),
        static_cast<float>(row * tile_height) / static_cast<float>(sheet_height)
    };
}

glm::vec2 Tileset::uv_max(uint32_t tile_id) const {
    uint32_t col = tile_id % columns;
    uint32_t row = tile_id / columns;
    return {
        static_cast<float>((col + 1) * tile_width) / static_cast<float>(sheet_width),
        static_cast<float>((row + 1) * tile_height) / static_cast<float>(sheet_height)
    };
}

std::vector<SpriteDrawInfo> TileLayer::generate_draw_infos() const {
    std::vector<SpriteDrawInfo> infos;
    infos.reserve(width * height);

    const float half_w = static_cast<float>(width) * tile_size * 0.5f;
    const float half_h = static_cast<float>(height) * tile_size * 0.5f;

    for (uint32_t row = 0; row < height; ++row) {
        for (uint32_t col = 0; col < width; ++col) {
            uint16_t tile_id = tiles[row * width + col];
            if (tile_id == 0xFFFF) {
                continue;
            }

            SpriteDrawInfo info{};
            info.position = {
                (static_cast<float>(col) + 0.5f) * tile_size - half_w,
                -(static_cast<float>(row) + 0.5f) * tile_size + half_h,
                z
            };
            info.size = {tile_size, tile_size};
            info.color = {1.0f, 1.0f, 1.0f, 1.0f};
            info.uv_min = tileset.uv_min(tile_id);
            info.uv_max = tileset.uv_max(tile_id);
            infos.push_back(info);
        }
    }

    return infos;
}

glm::vec2 resolve_tilemap_collision(glm::vec2 pos,
                                    float half_extent,
                                    const TileLayer& layer)
{
    if (layer.solid.empty()) return pos;

    const float half_w   = static_cast<float>(layer.width)  * layer.tile_size * 0.5f;
    const float half_h   = static_cast<float>(layer.height) * layer.tile_size * 0.5f;
    const float tile_half = layer.tile_size * 0.5f;
    const float sum_half  = tile_half + half_extent;

    for (uint32_t row = 0; row < layer.height; ++row) {
        for (uint32_t col = 0; col < layer.width; ++col) {
            const uint32_t idx = row * layer.width + col;
            if (idx >= static_cast<uint32_t>(layer.solid.size())) continue;
            if (!layer.solid[idx]) continue;

            // Tile center — same formula as generate_draw_infos.
            const float tile_cx = (static_cast<float>(col) + 0.5f) * layer.tile_size - half_w;
            const float tile_cy = -(static_cast<float>(row) + 0.5f) * layer.tile_size + half_h;

            const float dx = pos.x - tile_cx;
            const float dy = pos.y - tile_cy;

            const float overlap_x = sum_half - std::abs(dx);
            const float overlap_y = sum_half - std::abs(dy);

            if (overlap_x <= 0.0f || overlap_y <= 0.0f) continue;

            // Push out on the axis with smaller overlap (SAT minimum translation).
            if (overlap_x < overlap_y) {
                pos.x += (dx >= 0.0f ? overlap_x : -overlap_x);
            } else {
                pos.y += (dy >= 0.0f ? overlap_y : -overlap_y);
            }
        }
    }

    return pos;
}

}  // namespace vulkan_game
