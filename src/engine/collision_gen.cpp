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
    grid.nav_zone.resize(total, 0);
    grid.light_probe.resize(total, glm::vec3(0.5f));

    // Accumulators for light probe averaging
    std::vector<glm::vec3> color_sum(total, glm::vec3(0.0f));
    std::vector<uint32_t> color_count(total, 0);

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
        if (grid.solid[idx]) {
            // First Gaussian in this cell — mark as walkable
            grid.solid[idx] = false;
        }

        // Accumulate color for light probe
        color_sum[idx] += g.color;
        color_count[idx]++;
    }

    // Slope rejection is handled at runtime by the KCC's ground_angle_cos threshold.

    // Compute light probes (average Gaussian color per cell)
    for (size_t i = 0; i < total; ++i) {
        if (color_count[i] > 0) {
            grid.light_probe[i] = color_sum[i] / static_cast<float>(color_count[i]);
        }
    }

    return grid;
}

}  // namespace gseurat
