#include "vulkan_game/engine/tilemap.hpp"

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

}  // namespace vulkan_game
