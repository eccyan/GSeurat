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

    // Compute grid dimensions on XZ plane (ground plane, Y is up)
    float range_x = bounds.max.x - bounds.min.x;
    float range_z = bounds.max.z - bounds.min.z;
    grid_cols_ = std::max(1, static_cast<int32_t>(std::ceil(range_x / chunk_size)));
    grid_rows_ = std::max(1, static_cast<int32_t>(std::ceil(range_z / chunk_size)));

    int32_t total_cells = grid_cols_ * grid_rows_;

    // Histogram: count Gaussians per chunk
    std::vector<uint32_t> counts(total_cells, 0);
    std::vector<int32_t> assignments(gaussians.size());

    for (size_t i = 0; i < gaussians.size(); ++i) {
        const auto& pos = gaussians[i].position;
        int32_t gx = std::clamp(static_cast<int32_t>((pos.x - grid_min_.x) / chunk_size),
                                0, grid_cols_ - 1);
        int32_t gz = std::clamp(static_cast<int32_t>((pos.z - grid_min_.z) / chunk_size),
                                0, grid_rows_ - 1);
        int32_t cell = gz * grid_cols_ + gx;
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
        int32_t gz = c / grid_cols_;

        GsChunk chunk{};
        chunk.start_index = offsets[c];
        chunk.count = counts[c];
        chunk.grid_x = gx;
        chunk.grid_z = gz;

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

std::vector<uint32_t> GsChunkGrid::visible_chunks(const glm::mat4& view_proj,
                                                   const glm::vec3& camera_pos,
                                                   float max_distance) const {
    auto planes = extract_frustum_planes(view_proj);

    // Safety margin: account for scale compensation (up to kMaxScaleComp = 2.0x)
    // expanding Gaussians beyond their original chunk bounds.
    float margin = chunk_size_ * 2.0f;

    float max_dist_sq = (max_distance > 0.0f) ? max_distance * max_distance : 0.0f;

    std::vector<uint32_t> result;
    result.reserve(chunks_.size());

    for (uint32_t i = 0; i < chunks_.size(); ++i) {
        // Distance cull: skip chunks beyond max render distance
        if (max_dist_sq > 0.0f) {
            glm::vec3 center = chunks_[i].bounds.center();
            float dist_sq = glm::dot(center - camera_pos, center - camera_pos);
            if (dist_sq > max_dist_sq) continue;
        }

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

    // Distance thresholds based on chunk size
    float near_dist = 2.0f * chunk_size_;
    float far_dist = 8.0f * chunk_size_;
    float cull_dist = 12.0f * chunk_size_;  // beyond this, keep_count drops to 0

    // Player-centric LOD: use player position for distance if provided,
    // camera position otherwise.
    glm::vec3 lod_origin = focus_pos ? *focus_pos : camera_pos;

    // Compute per-chunk distances and initial keep ratios
    struct ChunkLod {
        uint32_t idx;
        float dist;
        float ratio;
        uint32_t keep_count;
    };
    std::vector<ChunkLod> lods;
    lods.reserve(chunk_indices.size());

    uint32_t total_wanted = 0;
    for (size_t i = 0; i < chunk_indices.size(); ++i) {
        const auto& chunk = chunks_[chunk_indices[i]];
        glm::vec3 center = chunk.bounds.center();
        float dist = glm::length(center - lod_origin);

        float ratio;
        if (dist <= near_dist) {
            ratio = 1.0f;
        } else if (dist >= cull_dist) {
            ratio = 0.0f;  // fully culled beyond cull distance
        } else if (dist >= far_dist) {
            // Linear fade from 0.1 to 0.0 between far_dist and cull_dist
            float t = (dist - far_dist) / (cull_dist - far_dist);
            ratio = 0.1f * (1.0f - t);
        } else {
            float t = (dist - near_dist) / (far_dist - near_dist);
            ratio = 1.0f - t * 0.9f;  // 1.0 → 0.1
        }

        if (ratio <= 0.0f) continue;  // skip fully culled chunks

        uint32_t keep = std::max(1u, static_cast<uint32_t>(chunk.count * ratio));
        lods.push_back({chunk_indices[i], dist, ratio, keep});
        total_wanted += keep;
    }

    // If total exceeds budget, scale all ratios proportionally
    if (total_wanted > budget) {
        float scale = static_cast<float>(budget) / static_cast<float>(total_wanted);
        total_wanted = 0;
        for (auto& lod : lods) {
            const auto& chunk = chunks_[lod.idx];
            lod.keep_count = std::max(1u, static_cast<uint32_t>(chunk.count * lod.ratio * scale));
            total_wanted += lod.keep_count;
        }
    }

    out.resize(total_wanted);

    // Scale compensation cap: sqrt(stride) fills holes from decimation,
    // capped at 2.0 to prevent fill-rate explosion from massive splats.
    static constexpr float kMaxScaleComp = 2.0f;

    // Stride-based decimation with capped scale compensation
    uint32_t offset = 0;
    for (const auto& lod : lods) {
        const auto& chunk = chunks_[lod.idx];
        uint32_t count = std::min(lod.keep_count, chunk.count);
        if (count == chunk.count) {
            // Full copy — no decimation needed
            std::memcpy(out.data() + offset,
                        sorted_gaussians_.data() + chunk.start_index,
                        count * sizeof(Gaussian));
        } else {
            // Stride through chunk to ensure spatial uniformity
            float stride = static_cast<float>(chunk.count) / static_cast<float>(count);
            float scale_comp = std::min(std::sqrt(stride), kMaxScaleComp);
            for (uint32_t i = 0; i < count; ++i) {
                uint32_t src = std::min(static_cast<uint32_t>(i * stride),
                                        chunk.count - 1);
                out[offset + i] = sorted_gaussians_[chunk.start_index + src];
                if (scale_comp > 1.0f) {
                    out[offset + i].scale *= scale_comp;
                }
            }
        }
        offset += count;
    }

    out.resize(offset);

    // Re-inject bone-animated Gaussians from culled chunks.
    // Character Gaussians (bone_index > 0) are embedded in the static PLY
    // and must always be present for skeletal animation to work.
    std::vector<bool> chunk_included(chunks_.size(), false);
    for (const auto& lod : lods) {
        chunk_included[lod.idx] = true;
    }
    for (uint32_t ci = 0; ci < chunks_.size(); ++ci) {
        if (chunk_included[ci]) continue;  // already gathered
        const auto& chunk = chunks_[ci];
        for (uint32_t i = chunk.start_index; i < chunk.start_index + chunk.count; ++i) {
            if (sorted_gaussians_[i].bone_index > 0) {
                out.push_back(sorted_gaussians_[i]);
            }
        }
    }

    return static_cast<uint32_t>(out.size());
}

}  // namespace gseurat
