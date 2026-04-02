#include "gseurat/engine/gs_chunk_grid.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <unordered_map>

namespace gseurat {

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

        // Sort Gaussians within this chunk by descending importance
        // so gather_lod can simply take the first N for LOD decimation
        std::sort(sorted_gaussians_.begin() + chunk.start_index,
                  sorted_gaussians_.begin() + chunk.start_index + chunk.count,
                  [](const Gaussian& a, const Gaussian& b) {
                      return a.importance > b.importance;
                  });

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

uint32_t GsChunkGrid::gather_lod(const std::vector<uint32_t>& chunk_indices,
                                  const glm::vec3& camera_pos,
                                  uint32_t budget,
                                  std::vector<Gaussian>& out,
                                  const glm::vec3* focus_pos) const {
    if (chunk_indices.empty()) {
        out.clear();
        return 0;
    }

    // LOD distance is measured from focus point (player) if provided,
    // otherwise falls back to camera position.
    glm::vec3 lod_origin = focus_pos ? *focus_pos : camera_pos;

    // Distance thresholds based on chunk size
    float far_dist = 8.0f * chunk_size_;
    float min_ratio = 0.1f;  // 10% kept at far distance

    // Fade-out zone: chunks beyond fade_start lose opacity; fully culled at fade_end.
    float fade_start = 6.0f * chunk_size_;
    float fade_end = 10.0f * chunk_size_;

    // --- Pass 1: estimate total Gaussians at full core radius ---
    // Core radius starts at 1.5x chunk_size (modest protection zone).
    static constexpr float kMaxCoreMult = 1.5f;
    static constexpr float kMinCoreMult = 0.5f;
    float core_mult = kMaxCoreMult;

    // Compute per-chunk distances (reused across passes)
    struct ChunkLod {
        uint32_t idx;
        float dist;
        float ratio;
        uint32_t keep_count;
        bool is_core;
    };
    std::vector<ChunkLod> lods(chunk_indices.size());

    for (size_t i = 0; i < chunk_indices.size(); ++i) {
        const auto& chunk = chunks_[chunk_indices[i]];
        lods[i].idx = chunk_indices[i];
        lods[i].dist = glm::length(chunk.bounds.center() - lod_origin);
    }

    // Lambda to compute ratios for a given core radius
    auto compute_ratios = [&](float core_r) {
        float near_dist = std::max(core_r, 2.0f * chunk_size_);
        uint32_t total = 0;
        for (auto& lod : lods) {
            const auto& chunk = chunks_[lod.idx];
            if (lod.dist <= core_r) {
                lod.ratio = 1.0f;
                lod.is_core = true;
            } else if (lod.dist >= fade_end) {
                // Beyond fade-out — fully culled
                lod.ratio = 0.0f;
                lod.is_core = false;
            } else if (lod.dist >= far_dist) {
                lod.ratio = min_ratio;
                lod.is_core = false;
            } else if (lod.dist <= near_dist) {
                lod.ratio = 1.0f;
                lod.is_core = false;
            } else {
                float t = (lod.dist - near_dist) / (far_dist - near_dist);
                lod.ratio = 1.0f - t * (1.0f - min_ratio);
                lod.is_core = false;
            }
            lod.keep_count = (lod.ratio > 0.0f)
                ? std::max(1u, static_cast<uint32_t>(chunk.count * lod.ratio))
                : 0;
            total += lod.keep_count;
        }
        return total;
    };

    uint32_t total_wanted = compute_ratios(core_mult * chunk_size_);

    // --- Dynamic core radius: shrink if way over budget ---
    if (total_wanted > budget * 2 && core_mult > kMinCoreMult) {
        // Budget pressure is high — shrink core radius
        float pressure = static_cast<float>(total_wanted) / static_cast<float>(budget);
        core_mult = std::max(kMinCoreMult, kMaxCoreMult / pressure);
        total_wanted = compute_ratios(core_mult * chunk_size_);
    }

    // --- Budget scaling: reduce non-core chunks proportionally ---
    if (total_wanted > budget) {
        uint32_t core_total = 0;
        uint32_t non_core_wanted = 0;
        for (const auto& lod : lods) {
            if (lod.is_core) core_total += lod.keep_count;
            else non_core_wanted += lod.keep_count;
        }

        uint32_t remaining = (budget > core_total) ? (budget - core_total) : 0;
        float scale = (non_core_wanted > 0)
            ? static_cast<float>(remaining) / static_cast<float>(non_core_wanted)
            : 0.0f;

        total_wanted = 0;
        for (auto& lod : lods) {
            if (lod.is_core) {
                total_wanted += lod.keep_count;
            } else if (lod.keep_count > 0) {
                const auto& chunk = chunks_[lod.idx];
                lod.keep_count = std::max(1u, static_cast<uint32_t>(chunk.count * lod.ratio * scale));
                total_wanted += lod.keep_count;
            }
        }
    }

    out.resize(total_wanted);

    // Scale compensation cap: prevent massive splats that destroy fill rate.
    // sqrt(stride) is theoretically correct for area, but values > 2.0 cause
    // enormous overdraw in the tile rasterizer.
    static constexpr float kMaxScaleComp = 2.0f;

    // Stride-based decimation with scale compensation and opacity fading
    uint32_t offset = 0;
    for (const auto& lod : lods) {
        if (lod.keep_count == 0) continue;
        const auto& chunk = chunks_[lod.idx];
        uint32_t count = std::min(lod.keep_count, chunk.count);

        // Opacity fade for distant chunks (smooth fade-out at world edges)
        float opacity_mult = 1.0f;
        if (lod.dist > fade_start && fade_end > fade_start) {
            opacity_mult = 1.0f - (lod.dist - fade_start) / (fade_end - fade_start);
            opacity_mult = std::max(0.0f, opacity_mult);
        }

        if (count == chunk.count && opacity_mult >= 1.0f) {
            // Full copy — no decimation or fading needed
            std::memcpy(out.data() + offset,
                        sorted_gaussians_.data() + chunk.start_index,
                        count * sizeof(Gaussian));
        } else {
            float stride = static_cast<float>(chunk.count) / static_cast<float>(count);
            // Clamped scale compensation: sqrt(stride) capped to limit overdraw
            float scale_comp = std::min(std::sqrt(stride), kMaxScaleComp);
            for (uint32_t i = 0; i < count; ++i) {
                uint32_t src = std::min(static_cast<uint32_t>(i * stride),
                                        chunk.count - 1);
                out[offset + i] = sorted_gaussians_[chunk.start_index + src];
                if (scale_comp > 1.0f) {
                    out[offset + i].scale *= scale_comp;
                }
                if (opacity_mult < 1.0f) {
                    out[offset + i].opacity *= opacity_mult;
                }
            }
        }
        offset += count;
    }

    out.resize(offset);
    return offset;
}

}  // namespace gseurat
