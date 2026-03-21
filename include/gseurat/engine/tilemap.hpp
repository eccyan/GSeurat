#pragma once

#include "gseurat/engine/sprite_batch.hpp"

#include <cstdint>
#include <unordered_map>
#include <vector>

#include <glm/glm.hpp>

namespace gseurat {

struct Tileset {
    uint32_t tile_width;    // pixels per tile, x
    uint32_t tile_height;   // pixels per tile, y
    uint32_t columns;       // number of columns in the sheet
    uint32_t sheet_width;   // total sheet width in pixels
    uint32_t sheet_height;  // total sheet height in pixels

    glm::vec2 uv_min(uint32_t tile_id) const;
    glm::vec2 uv_max(uint32_t tile_id) const;
};

struct TileAnimationDef {
    uint16_t base_tile_id;                // tile_id used in tiles[]
    std::vector<uint16_t> frame_tile_ids; // sequence of tile_ids to cycle
    float frame_duration;                 // seconds per frame (uniform)
};

class TileAnimator {
public:
    void add_definition(TileAnimationDef def);
    void update(float dt);
    uint16_t resolve(uint16_t tile_id) const;
    void reset();

private:
    struct AnimState {
        TileAnimationDef def;
        float timer = 0;
        uint32_t current_frame = 0;
    };
    std::vector<AnimState> anims_;
    std::unordered_map<uint16_t, size_t> lookup_;
};

struct TileLayer {
    Tileset tileset;
    uint32_t width;     // grid width in tiles
    uint32_t height;    // grid height in tiles
    float tile_size;    // world units per tile
    float z;            // depth (larger = further from camera)
    std::vector<uint16_t> tiles;  // row-major; 0xFFFF = skip
    std::vector<bool> solid;      // row-major; true = blocks movement (empty = all passable)

    std::vector<SpriteDrawInfo> generate_draw_infos(const TileAnimator* animator = nullptr) const;
};

// Resolves AABB overlap between an entity (axis-aligned square with given
// half_extent) and all solid tiles in layer. Returns corrected XY position.
glm::vec2 resolve_tilemap_collision(glm::vec2 pos,
                                    float half_extent,
                                    const TileLayer& layer);

}  // namespace gseurat
