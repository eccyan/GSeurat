#pragma once

#include "gseurat/engine/gaussian_cloud.hpp"

#include <glm/glm.hpp>
#include <cstdint>
#include <vector>

namespace gseurat {

struct GsChunk {
    AABB bounds;
    uint32_t start_index;   // into sorted_gaussians_
    uint32_t count;
    int32_t grid_x, grid_z;
};

class GsChunkGrid {
public:
    void build(const GaussianCloud& cloud, float chunk_size = 32.0f);
    std::vector<uint32_t> visible_chunks(const glm::mat4& view_proj) const;
    uint32_t gather(const std::vector<uint32_t>& chunk_indices,
                    std::vector<Gaussian>& out) const;
    uint32_t gather_lod(const std::vector<uint32_t>& chunk_indices,
                        const glm::vec3& camera_pos,
                        uint32_t budget,
                        std::vector<Gaussian>& out,
                        const glm::vec3* focus_pos = nullptr) const;
    bool empty() const { return chunks_.empty(); }
    AABB cloud_bounds() const { return cloud_bounds_; }
    const std::vector<Gaussian>& all_gaussians() const { return sorted_gaussians_; }
    uint32_t chunk_count() const { return static_cast<uint32_t>(chunks_.size()); }

private:
    std::vector<GsChunk> chunks_;
    std::vector<Gaussian> sorted_gaussians_;
    float chunk_size_ = 32.0f;
    glm::vec3 grid_min_{0.0f};
    int32_t grid_cols_ = 0;
    int32_t grid_rows_ = 0;
    AABB cloud_bounds_;
};

}  // namespace gseurat
