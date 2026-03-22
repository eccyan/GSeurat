#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

CollisionGrid generate_collision_from_depth(
    const float* depth_data, uint32_t render_width, uint32_t render_height,
    uint32_t grid_width, uint32_t grid_height, float variance_threshold) {

    CollisionGrid grid;
    grid.width = grid_width;
    grid.height = grid_height;
    grid.cell_size = 1.0f;
    grid.solid.resize(static_cast<size_t>(grid_width) * grid_height, false);

    if (!depth_data || render_width == 0 || render_height == 0) return grid;

    float cell_w = static_cast<float>(render_width) / static_cast<float>(grid_width);
    float cell_h = static_cast<float>(render_height) / static_cast<float>(grid_height);

    for (uint32_t gy = 0; gy < grid_height; ++gy) {
        for (uint32_t gx = 0; gx < grid_width; ++gx) {
            // Sample depth values within this cell
            uint32_t px_start = static_cast<uint32_t>(static_cast<float>(gx) * cell_w);
            uint32_t py_start = static_cast<uint32_t>(static_cast<float>(gy) * cell_h);
            uint32_t px_end = std::min(render_width, static_cast<uint32_t>(static_cast<float>(gx + 1) * cell_w));
            uint32_t py_end = std::min(render_height, static_cast<uint32_t>(static_cast<float>(gy + 1) * cell_h));

            float sum = 0.0f;
            float sum_sq = 0.0f;
            uint32_t count = 0;

            for (uint32_t py = py_start; py < py_end; ++py) {
                for (uint32_t px = px_start; px < px_end; ++px) {
                    float d = depth_data[py * render_width + px];
                    // Skip background (depth = 0 or max)
                    if (d <= 0.0f || d >= 1e6f) continue;
                    sum += d;
                    sum_sq += d * d;
                    ++count;
                }
            }

            if (count < 2) continue;

            float mean = sum / static_cast<float>(count);
            float variance = (sum_sq / static_cast<float>(count)) - (mean * mean);

            if (variance > variance_threshold) {
                grid.solid[gy * grid_width + gx] = true;
            }
        }
    }

    return grid;
}

CollisionGrid generate_collision_from_gaussians(
    const GaussianCloud& cloud,
    uint32_t grid_width, uint32_t grid_height,
    float cell_size,
    float slope_threshold) {

    CollisionGrid grid;
    grid.width = grid_width;
    grid.height = grid_height;
    grid.cell_size = cell_size;
    size_t total = static_cast<size_t>(grid_width) * grid_height;
    grid.solid.resize(total, true);       // default: solid (no Gaussians = void)
    grid.elevation.resize(total, 0.0f);

    if (cloud.empty()) return grid;

    const auto& bounds = cloud.bounds();

    // For each cell, find the highest Gaussian Y position
    for (const auto& g : cloud.gaussians()) {
        // Map Gaussian XZ position to grid cell
        float rel_x = g.position.x - bounds.min.x;
        float rel_z = g.position.z - bounds.min.z;
        int gx = static_cast<int>(rel_x / cell_size);
        int gz = static_cast<int>(rel_z / cell_size);

        if (gx < 0 || gx >= static_cast<int>(grid_width) ||
            gz < 0 || gz >= static_cast<int>(grid_height)) continue;

        size_t idx = static_cast<size_t>(gz) * grid_width + static_cast<size_t>(gx);
        // Track highest Y as ground elevation
        if (grid.solid[idx]) {
            // First Gaussian in this cell — mark as walkable
            grid.solid[idx] = false;
            grid.elevation[idx] = g.position.y;
        } else {
            grid.elevation[idx] = std::max(grid.elevation[idx], g.position.y);
        }
    }

    // Mark cells with steep slope as solid
    for (uint32_t gy = 0; gy < grid_height; ++gy) {
        for (uint32_t gx = 0; gx < grid_width; ++gx) {
            size_t idx = gy * grid_width + gx;
            if (grid.solid[idx]) continue;  // already solid (void)

            float h = grid.elevation[idx];
            // Check neighbors for steep slopes
            auto check_neighbor = [&](int nx, int ny) {
                if (nx < 0 || nx >= static_cast<int>(grid_width) ||
                    ny < 0 || ny >= static_cast<int>(grid_height)) return;
                size_t nidx = static_cast<size_t>(ny) * grid_width + static_cast<size_t>(nx);
                if (grid.solid[nidx]) return;
                float diff = std::abs(grid.elevation[nidx] - h);
                if (diff > slope_threshold) {
                    grid.solid[idx] = true;
                }
            };
            check_neighbor(static_cast<int>(gx) - 1, static_cast<int>(gy));
            check_neighbor(static_cast<int>(gx) + 1, static_cast<int>(gy));
            check_neighbor(static_cast<int>(gx), static_cast<int>(gy) - 1);
            check_neighbor(static_cast<int>(gx), static_cast<int>(gy) + 1);
        }
    }

    return grid;
}

}  // namespace gseurat
