#pragma once

#include "gseurat/engine/async_loader.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <nlohmann/json.hpp>

#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace gseurat {

enum class ChunkState { Unloaded, Loading, Loaded };

struct StreamChunkMeta {
    int32_t grid_x = 0;
    int32_t grid_z = 0;
    AABB bounds;
    std::string ply_path;
    uint32_t gaussian_count = 0;
    ChunkState state = ChunkState::Unloaded;
    uint32_t load_request_id = 0;
};

struct ChunkManifest {
    float chunk_size = 32.0f;
    glm::vec3 grid_origin{0.0f};
    int32_t grid_cols = 0;
    int32_t grid_rows = 0;
    std::vector<StreamChunkMeta> chunks;

    // Parse from JSON
    static ChunkManifest from_json(const nlohmann::json& j);
};

class GsChunkStreamer {
public:
    // Initialize from a manifest (parsed JSON).
    void init(const ChunkManifest& manifest);

    // Update streaming state based on camera position.
    // Submits load requests to AsyncLoader for chunks within load_radius.
    // Marks chunks beyond unload_radius for removal.
    void update(const glm::vec3& camera_pos, AsyncLoader& loader);

    // Process completed load results. Call after AsyncLoader::poll_results().
    void process_load_results(const std::vector<LoadResult>& results);

    // Returns true if the active Gaussian set changed since last call to
    // assemble_active().
    bool active_set_dirty() const { return dirty_; }

    // Assemble active Gaussians from all loaded, in-range chunks.
    // Applies frustum culling and optional LOD decimation.
    // Clears the dirty flag.
    uint32_t assemble_active(const glm::mat4& view_proj,
                             const glm::vec3& camera_pos,
                             uint32_t budget,
                             std::vector<Gaussian>& out);

    // Configuration
    void set_load_radius(float r) { load_radius_ = r; }
    void set_unload_radius(float r) { unload_radius_ = r; }
    void set_memory_budget(size_t bytes) { memory_budget_ = bytes; }
    float load_radius() const { return load_radius_; }
    float unload_radius() const { return unload_radius_; }

    // State queries
    uint32_t loaded_chunk_count() const;
    uint32_t loading_chunk_count() const;
    size_t loaded_memory_bytes() const { return current_memory_; }
    const ChunkManifest& manifest() const { return manifest_; }

private:
    // Frustum culling for chunk AABBs
    static bool is_chunk_visible(const AABB& bounds, const glm::mat4& view_proj);

    // Evict furthest loaded chunks to stay within memory budget
    void evict_if_over_budget(const glm::vec3& camera_pos);

    // Distance from camera to chunk center (XZ plane)
    static float chunk_distance_xz(const AABB& bounds, const glm::vec3& camera_pos);

    ChunkManifest manifest_;

    // Per-chunk loaded Gaussian data (keyed by chunk index)
    std::unordered_map<uint32_t, std::vector<Gaussian>> chunk_data_;

    // Map from AsyncLoader request_id → chunk index
    std::unordered_map<uint32_t, uint32_t> pending_loads_;

    bool dirty_ = false;

    float load_radius_ = 256.0f;
    float unload_radius_ = 384.0f;
    size_t memory_budget_ = 512 * 1024 * 1024;  // 512 MB
    size_t current_memory_ = 0;
};

}  // namespace gseurat
