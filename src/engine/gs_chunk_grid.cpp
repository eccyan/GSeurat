#include "vulkan_game/engine/gs_chunk_grid.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <unordered_map>

namespace vulkan_game {

void GsChunkGrid::build(const GaussianCloud& cloud, float chunk_size) {
    chunk_size_ = chunk_size;
    chunks_.clear();
    sorted_gaussians_.clear();
    cloud_bounds_ = AABB{};

    if (cloud.empty()) return;

    const auto& gaussians = cloud.gaussians();
    const auto& bounds = cloud.bounds();
    cloud_bounds_ = bounds;

    grid_min_ = bounds.min;

    // Compute grid dimensions on XY plane (map face)
    float range_x = bounds.max.x - bounds.min.x;
    float range_y = bounds.max.y - bounds.min.y;
    grid_cols_ = std::max(1, static_cast<int32_t>(std::ceil(range_x / chunk_size)));
    grid_rows_ = std::max(1, static_cast<int32_t>(std::ceil(range_y / chunk_size)));

    int32_t total_cells = grid_cols_ * grid_rows_;

    // Histogram: count Gaussians per chunk
    std::vector<uint32_t> counts(total_cells, 0);
    std::vector<int32_t> assignments(gaussians.size());

    for (size_t i = 0; i < gaussians.size(); ++i) {
        const auto& pos = gaussians[i].position;
        int32_t gx = std::clamp(static_cast<int32_t>((pos.x - grid_min_.x) / chunk_size),
                                0, grid_cols_ - 1);
        int32_t gy = std::clamp(static_cast<int32_t>((pos.y - grid_min_.y) / chunk_size),
                                0, grid_rows_ - 1);
        int32_t cell = gy * grid_cols_ + gx;
        assignments[i] = cell;
        counts[cell]++;
    }

    // Prefix sum → start indices
    std::vector<uint32_t> offsets(total_cells, 0);
    for (int32_t c = 1; c < total_cells; ++c) {
        offsets[c] = offsets[c - 1] + counts[c - 1];
    }

    // Scatter Gaussians into sorted buffer
    sorted_gaussians_.resize(gaussians.size());
    std::vector<uint32_t> write_pos = offsets;  // copy for scatter
    for (size_t i = 0; i < gaussians.size(); ++i) {
        int32_t cell = assignments[i];
        sorted_gaussians_[write_pos[cell]] = gaussians[i];
        write_pos[cell]++;
    }

    // Build chunks (skip empty cells)
    chunks_.reserve(total_cells);
    for (int32_t c = 0; c < total_cells; ++c) {
        if (counts[c] == 0) continue;

        int32_t gx = c % grid_cols_;
        int32_t gy = c / grid_cols_;

        GsChunk chunk{};
        chunk.start_index = offsets[c];
        chunk.count = counts[c];
        chunk.grid_x = gx;
        chunk.grid_z = gy;  // grid_z stores the Y-axis row index

        // Compute tight AABB from actual Gaussians
        for (uint32_t i = chunk.start_index; i < chunk.start_index + chunk.count; ++i) {
            chunk.bounds.expand(sorted_gaussians_[i].position);
        }

        chunks_.push_back(chunk);
    }
}

// Extract 6 frustum planes from view_proj (Gribb/Hartmann method)
static std::array<glm::vec4, 6> extract_frustum_planes(const glm::mat4& vp) {
    std::array<glm::vec4, 6> planes;
    // Left
    planes[0] = glm::vec4(vp[0][3] + vp[0][0], vp[1][3] + vp[1][0],
                           vp[2][3] + vp[2][0], vp[3][3] + vp[3][0]);
    // Right
    planes[1] = glm::vec4(vp[0][3] - vp[0][0], vp[1][3] - vp[1][0],
                           vp[2][3] - vp[2][0], vp[3][3] - vp[3][0]);
    // Bottom
    planes[2] = glm::vec4(vp[0][3] + vp[0][1], vp[1][3] + vp[1][1],
                           vp[2][3] + vp[2][1], vp[3][3] + vp[3][1]);
    // Top
    planes[3] = glm::vec4(vp[0][3] - vp[0][1], vp[1][3] - vp[1][1],
                           vp[2][3] - vp[2][1], vp[3][3] - vp[3][1]);
    // Near
    planes[4] = glm::vec4(vp[0][2], vp[1][2], vp[2][2], vp[3][2]);
    // Far
    planes[5] = glm::vec4(vp[0][3] - vp[0][2], vp[1][3] - vp[1][2],
                           vp[2][3] - vp[2][2], vp[3][3] - vp[3][2]);

    // Normalize
    for (auto& p : planes) {
        float len = glm::length(glm::vec3(p));
        if (len > 0.0f) p /= len;
    }
    return planes;
}

// Test AABB against frustum planes (with margin)
static bool aabb_in_frustum(const AABB& aabb, const std::array<glm::vec4, 6>& planes,
                            float margin) {
    glm::vec3 expanded_min = aabb.min - glm::vec3(margin);
    glm::vec3 expanded_max = aabb.max + glm::vec3(margin);

    for (const auto& plane : planes) {
        glm::vec3 normal(plane);
        // Find the positive vertex (the vertex most aligned with the plane normal)
        glm::vec3 p_vertex;
        p_vertex.x = (normal.x >= 0.0f) ? expanded_max.x : expanded_min.x;
        p_vertex.y = (normal.y >= 0.0f) ? expanded_max.y : expanded_min.y;
        p_vertex.z = (normal.z >= 0.0f) ? expanded_max.z : expanded_min.z;

        if (glm::dot(normal, p_vertex) + plane.w < 0.0f) {
            return false;  // entirely outside this plane
        }
    }
    return true;
}

std::vector<uint32_t> GsChunkGrid::visible_chunks(const glm::mat4& view_proj) const {
    auto planes = extract_frustum_planes(view_proj);

    // Safety margin: 1 chunk size for Gaussian splat radius bleeding
    float margin = chunk_size_;

    std::vector<uint32_t> result;
    result.reserve(chunks_.size());

    for (uint32_t i = 0; i < chunks_.size(); ++i) {
        if (aabb_in_frustum(chunks_[i].bounds, planes, margin)) {
            result.push_back(i);
        }
    }

    return result;
}

uint32_t GsChunkGrid::gather(const std::vector<uint32_t>& chunk_indices,
                              std::vector<Gaussian>& out) const {
    // Calculate total count
    uint32_t total = 0;
    for (uint32_t idx : chunk_indices) {
        total += chunks_[idx].count;
    }

    out.resize(total);

    // Copy visible chunks contiguously
    uint32_t offset = 0;
    for (uint32_t idx : chunk_indices) {
        const auto& chunk = chunks_[idx];
        std::memcpy(out.data() + offset,
                    sorted_gaussians_.data() + chunk.start_index,
                    chunk.count * sizeof(Gaussian));
        offset += chunk.count;
    }

    return total;
}

}  // namespace vulkan_game
