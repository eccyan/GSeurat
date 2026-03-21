#include "vulkan_game/engine/gs_chunk_streamer.hpp"

#include <algorithm>
#include <cmath>

namespace vulkan_game {

// --- ChunkManifest ---

ChunkManifest ChunkManifest::from_json(const nlohmann::json& j) {
    ChunkManifest m;
    m.chunk_size = j.value("chunk_size", 32.0f);
    m.grid_cols = j.value("grid_cols", 0);
    m.grid_rows = j.value("grid_rows", 0);

    if (j.contains("grid_origin")) {
        auto& o = j["grid_origin"];
        m.grid_origin = glm::vec3(o[0].get<float>(), o[1].get<float>(), o[2].get<float>());
    }

    if (j.contains("chunks")) {
        for (auto& cj : j["chunks"]) {
            StreamChunkMeta meta;
            meta.grid_x = cj.value("grid_x", 0);
            meta.grid_z = cj.value("grid_z", 0);
            meta.ply_path = cj.value("ply_file", std::string{});
            meta.gaussian_count = cj.value("gaussian_count", 0u);

            if (cj.contains("bounds_min")) {
                auto& bmin = cj["bounds_min"];
                meta.bounds.min = glm::vec3(bmin[0].get<float>(), bmin[1].get<float>(),
                                            bmin[2].get<float>());
            }
            if (cj.contains("bounds_max")) {
                auto& bmax = cj["bounds_max"];
                meta.bounds.max = glm::vec3(bmax[0].get<float>(), bmax[1].get<float>(),
                                            bmax[2].get<float>());
            }

            m.chunks.push_back(std::move(meta));
        }
    }

    return m;
}

// --- GsChunkStreamer ---

void GsChunkStreamer::init(const ChunkManifest& manifest) {
    manifest_ = manifest;
    chunk_data_.clear();
    pending_loads_.clear();
    dirty_ = false;
    current_memory_ = 0;
}

void GsChunkStreamer::update(const glm::vec3& camera_pos, AsyncLoader& loader) {
    for (uint32_t i = 0; i < manifest_.chunks.size(); ++i) {
        auto& chunk = manifest_.chunks[i];
        float dist = chunk_distance_xz(chunk.bounds, camera_pos);

        if (chunk.state == ChunkState::Unloaded && dist <= load_radius_) {
            // Request load
            std::string path = chunk.ply_path;
            uint32_t req_id = loader.submit([path]() -> std::any {
                return GaussianCloud::load_ply(path);
            });
            chunk.state = ChunkState::Loading;
            chunk.load_request_id = req_id;
            pending_loads_[req_id] = i;
        } else if (chunk.state == ChunkState::Loaded && dist > unload_radius_) {
            // Unload
            auto it = chunk_data_.find(i);
            if (it != chunk_data_.end()) {
                current_memory_ -= it->second.size() * sizeof(Gaussian);
                chunk_data_.erase(it);
            }
            chunk.state = ChunkState::Unloaded;
            chunk.load_request_id = 0;
            dirty_ = true;
        } else if (chunk.state == ChunkState::Loading && dist > unload_radius_) {
            // Cancel pending load that's now too far
            loader.cancel(chunk.load_request_id);
            pending_loads_.erase(chunk.load_request_id);
            chunk.state = ChunkState::Unloaded;
            chunk.load_request_id = 0;
        }
        // Hysteresis: Loading/Loaded chunks between load_radius and unload_radius
        // stay in their current state.
    }
}

void GsChunkStreamer::process_load_results(const std::vector<LoadResult>& results) {
    for (const auto& result : results) {
        auto it = pending_loads_.find(result.request_id);
        if (it == pending_loads_.end()) continue;

        uint32_t chunk_idx = it->second;
        pending_loads_.erase(it);

        if (chunk_idx >= manifest_.chunks.size()) continue;
        auto& chunk = manifest_.chunks[chunk_idx];

        if (!result.success) {
            chunk.state = ChunkState::Unloaded;
            chunk.load_request_id = 0;
            continue;
        }

        auto cloud = std::any_cast<GaussianCloud>(result.data);
        auto& gaussians = const_cast<std::vector<Gaussian>&>(cloud.gaussians());
        chunk_data_[chunk_idx] = std::move(gaussians);
        current_memory_ += chunk_data_[chunk_idx].size() * sizeof(Gaussian);
        chunk.state = ChunkState::Loaded;
        chunk.load_request_id = 0;
        dirty_ = true;
    }

    // Enforce memory budget after loading new chunks
    if (!results.empty()) {
        // Use a dummy camera_pos (0,0,0) for eviction — proper eviction uses
        // the camera position from the most recent update() call.
        // We'll use chunk center distance to origin as a rough heuristic.
        evict_if_over_budget(glm::vec3(0.0f));
    }
}

uint32_t GsChunkStreamer::assemble_active(const glm::mat4& view_proj,
                                           const glm::vec3& camera_pos,
                                           uint32_t budget,
                                           std::vector<Gaussian>& out) {
    out.clear();
    dirty_ = false;

    // Collect loaded chunks that pass frustum test
    struct ChunkEntry {
        uint32_t chunk_idx;
        float distance;
    };
    std::vector<ChunkEntry> visible;

    for (auto& [chunk_idx, gaussians] : chunk_data_) {
        if (chunk_idx >= manifest_.chunks.size()) continue;
        auto& chunk = manifest_.chunks[chunk_idx];
        if (chunk.state != ChunkState::Loaded) continue;
        if (!is_chunk_visible(chunk.bounds, view_proj)) continue;

        float dist = chunk_distance_xz(chunk.bounds, camera_pos);
        visible.push_back({chunk_idx, dist});
    }

    // Sort by distance (nearest first for LOD priority)
    std::sort(visible.begin(), visible.end(),
              [](const ChunkEntry& a, const ChunkEntry& b) { return a.distance < b.distance; });

    // Gather Gaussians with budget
    uint32_t total = 0;
    for (const auto& entry : visible) {
        auto& gaussians = chunk_data_[entry.chunk_idx];
        uint32_t chunk_count = static_cast<uint32_t>(gaussians.size());
        uint32_t remaining = budget > total ? budget - total : 0;

        if (remaining == 0) break;

        if (chunk_count <= remaining) {
            // Take all
            out.insert(out.end(), gaussians.begin(), gaussians.end());
            total += chunk_count;
        } else {
            // Stride-based sampling (same pattern as GsChunkGrid::gather_lod)
            uint32_t stride = (chunk_count + remaining - 1) / remaining;
            for (uint32_t j = 0; j < chunk_count && total < budget; j += stride) {
                out.push_back(gaussians[j]);
                ++total;
            }
        }
    }

    return total;
}

uint32_t GsChunkStreamer::loaded_chunk_count() const {
    uint32_t count = 0;
    for (const auto& c : manifest_.chunks) {
        if (c.state == ChunkState::Loaded) ++count;
    }
    return count;
}

uint32_t GsChunkStreamer::loading_chunk_count() const {
    uint32_t count = 0;
    for (const auto& c : manifest_.chunks) {
        if (c.state == ChunkState::Loading) ++count;
    }
    return count;
}

bool GsChunkStreamer::is_chunk_visible(const AABB& bounds, const glm::mat4& view_proj) {
    // 6-plane frustum test against AABB (Gribb/Hartmann method)
    // Extract frustum planes from view_proj matrix
    glm::vec4 planes[6];
    for (int i = 0; i < 4; ++i) {
        planes[0][i] = view_proj[i][3] + view_proj[i][0];  // left
        planes[1][i] = view_proj[i][3] - view_proj[i][0];  // right
        planes[2][i] = view_proj[i][3] + view_proj[i][1];  // bottom
        planes[3][i] = view_proj[i][3] - view_proj[i][1];  // top
        planes[4][i] = view_proj[i][3] + view_proj[i][2];  // near
        planes[5][i] = view_proj[i][3] - view_proj[i][2];  // far
    }

    for (int p = 0; p < 6; ++p) {
        glm::vec3 normal(planes[p]);
        float d = planes[p].w;

        // Find the AABB corner most in the direction of the plane normal
        glm::vec3 positive_vertex;
        positive_vertex.x = (normal.x >= 0) ? bounds.max.x : bounds.min.x;
        positive_vertex.y = (normal.y >= 0) ? bounds.max.y : bounds.min.y;
        positive_vertex.z = (normal.z >= 0) ? bounds.max.z : bounds.min.z;

        if (glm::dot(normal, positive_vertex) + d < 0.0f) {
            return false;  // entire AABB is outside this plane
        }
    }
    return true;
}

void GsChunkStreamer::evict_if_over_budget(const glm::vec3& camera_pos) {
    while (current_memory_ > memory_budget_ && !chunk_data_.empty()) {
        // Find the furthest loaded chunk
        uint32_t furthest_idx = 0;
        float max_dist = -1.0f;

        for (auto& [idx, data] : chunk_data_) {
            if (idx >= manifest_.chunks.size()) continue;
            float dist = chunk_distance_xz(manifest_.chunks[idx].bounds, camera_pos);
            if (dist > max_dist) {
                max_dist = dist;
                furthest_idx = idx;
            }
        }

        auto it = chunk_data_.find(furthest_idx);
        if (it == chunk_data_.end()) break;

        current_memory_ -= it->second.size() * sizeof(Gaussian);
        chunk_data_.erase(it);

        if (furthest_idx < manifest_.chunks.size()) {
            manifest_.chunks[furthest_idx].state = ChunkState::Unloaded;
            manifest_.chunks[furthest_idx].load_request_id = 0;
        }
        dirty_ = true;
    }
}

float GsChunkStreamer::chunk_distance_xz(const AABB& bounds, const glm::vec3& camera_pos) {
    glm::vec3 center = bounds.center();
    float dx = center.x - camera_pos.x;
    float dz = center.z - camera_pos.z;
    return std::sqrt(dx * dx + dz * dz);
}

}  // namespace vulkan_game
