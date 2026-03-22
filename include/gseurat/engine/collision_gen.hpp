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
    std::vector<float> elevation;       // per-cell ground height (Y value)
    std::vector<uint8_t> nav_zone;      // per-cell navigation zone ID (0 = default)

    bool is_solid(uint32_t x, uint32_t y) const {
        if (x >= width || y >= height) return true;
        return solid[y * width + x];
    }

    void set_solid(uint32_t x, uint32_t y, bool val) {
        if (x < width && y < height) {
            solid[y * width + x] = val;
        }
    }

    float get_elevation(uint32_t x, uint32_t y) const {
        if (x >= width || y >= height) return 0.0f;
        size_t idx = y * width + x;
        return idx < elevation.size() ? elevation[idx] : 0.0f;
    }

    void set_elevation(uint32_t x, uint32_t y, float val) {
        if (x < width && y < height) {
            size_t idx = y * width + x;
            if (idx < elevation.size()) elevation[idx] = val;
        }
    }

    uint8_t get_nav_zone(uint32_t x, uint32_t y) const {
        if (x >= width || y >= height) return 0;
        size_t idx = y * width + x;
        return idx < nav_zone.size() ? nav_zone[idx] : 0;
    }

    void set_nav_zone(uint32_t x, uint32_t y, uint8_t zone) {
        if (x < width && y < height) {
            size_t idx = y * width + x;
            if (idx < nav_zone.size()) nav_zone[idx] = zone;
        }
    }
};

// Generate a collision grid from depth variance in a rendered depth buffer.
CollisionGrid generate_collision_from_depth(
    const float* depth_data, uint32_t render_width, uint32_t render_height,
    uint32_t grid_width, uint32_t grid_height, float variance_threshold = 0.1f);

// Forward declaration
class GaussianCloud;

// Generate a collision grid with elevation from Gaussian positions.
// For each XZ cell, finds the highest Gaussian Y position → ground elevation.
// Cells with no Gaussians are marked solid (impassable void).
CollisionGrid generate_collision_from_gaussians(
    const GaussianCloud& cloud,
    uint32_t grid_width, uint32_t grid_height,
    float cell_size = 1.0f,
    float slope_threshold = 5.0f);

}  // namespace gseurat
