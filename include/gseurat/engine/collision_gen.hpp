#pragma once

#include <cstdint>
#include <vector>

#include <glm/glm.hpp>

namespace gseurat {

struct CollisionGrid {
    uint32_t width = 0;
    uint32_t height = 0;
    float cell_size = 1.0f;
    std::vector<bool> solid;

    bool is_solid(uint32_t x, uint32_t y) const {
        if (x >= width || y >= height) return true;
        return solid[y * width + x];
    }

    void set_solid(uint32_t x, uint32_t y, bool val) {
        if (x < width && y < height) {
            solid[y * width + x] = val;
        }
    }
};

// Generate a collision grid from depth variance in a rendered depth buffer.
// depth_data: row-major float depth values, dimensions render_width × render_height
// grid_width/height: desired collision grid dimensions
// variance_threshold: depth variance above which a cell is marked solid
CollisionGrid generate_collision_from_depth(
    const float* depth_data, uint32_t render_width, uint32_t render_height,
    uint32_t grid_width, uint32_t grid_height, float variance_threshold = 0.1f);

}  // namespace gseurat
