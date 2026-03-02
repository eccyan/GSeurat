#pragma once

#include "vulkan_game/engine/sprite_batch.hpp"

#include <cstdint>
#include <vector>

#include <glm/glm.hpp>

namespace vulkan_game {

struct Tileset {
    uint32_t tile_width;    // pixels per tile, x
    uint32_t tile_height;   // pixels per tile, y
    uint32_t columns;       // number of columns in the sheet
    uint32_t sheet_width;   // total sheet width in pixels
    uint32_t sheet_height;  // total sheet height in pixels

    glm::vec2 uv_min(uint32_t tile_id) const;
    glm::vec2 uv_max(uint32_t tile_id) const;
};

struct TileLayer {
    Tileset tileset;
    uint32_t width;     // grid width in tiles
    uint32_t height;    // grid height in tiles
    float tile_size;    // world units per tile
    float z;            // depth (larger = further from camera)
    std::vector<uint16_t> tiles;  // row-major; 0xFFFF = skip
    std::vector<bool> solid;      // row-major; true = blocks movement (empty = all passable)

    std::vector<SpriteDrawInfo> generate_draw_infos() const;
};

// Resolves AABB overlap between an entity (axis-aligned square with given
// half_extent) and all solid tiles in layer. Returns corrected XY position.
glm::vec2 resolve_tilemap_collision(glm::vec2 pos,
                                    float half_extent,
                                    const TileLayer& layer);

}  // namespace vulkan_game
