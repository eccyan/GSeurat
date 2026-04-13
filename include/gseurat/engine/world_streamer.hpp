#pragma once

#include "gseurat/engine/world_manifest.hpp"
#include <glm/glm.hpp>
#include <functional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace gseurat {

class GsRenderer;  // forward declare

class WorldStreamer {
public:
    enum class ChunkStatus { UNLOADED, LOADING, ACTIVE };

    struct ChunkInfo {
        std::string grid_key;       // "0,0,0"
        std::string ply_file;
        ChunkStatus status{ChunkStatus::UNLOADED};
        uint32_t renderer_chunk_id{0};  // set when ACTIVE
    };

    struct StreamEvent {
        enum Type { CHUNK_LOAD_START, CHUNK_ACTIVE, CHUNK_UNLOADED,
                    VOLUME_ENTERED, VOLUME_EXITED,
                    PORTAL_ENTERED };
        Type type;
        std::string id;  // grid key, volume id, or portal id
    };

    void init(const WorldManifest& manifest);

    // Call once per frame with current camera/player position.
    // Returns events that occurred this frame.
    std::vector<StreamEvent> update(const glm::vec3& camera_pos);

    // Call when a chunk finishes async loading. The renderer calls this
    // via completion callback to map the grid key to a renderer chunk ID.
    void on_chunk_loaded(const std::string& grid_key, uint32_t renderer_chunk_id);

    // Accessors
    ChunkStatus chunk_status(const std::string& grid_key) const;
    const WorldManifest& manifest() const { return manifest_; }
    float load_radius() const { return load_radius_; }
    float unload_radius() const { return unload_radius_; }
    void set_load_radius(float r) { load_radius_ = r; }
    void set_unload_radius(float r) { unload_radius_ = r; }

    // Query: which chunks should be loaded/unloaded?
    // These return grid keys. The caller (demo/staging) is responsible for
    // actually calling load_cloud_async / unload_cloud on the renderer.
    const std::vector<std::string>& pending_loads() const { return pending_loads_; }
    const std::vector<std::string>& pending_unloads() const { return pending_unloads_; }

    // Query: which portal was entered this frame? Empty string if none.
    const std::string& entered_portal_id() const { return entered_portal_id_; }

private:
    WorldManifest manifest_;
    std::unordered_map<std::string, ChunkInfo> chunks_;  // grid_key -> info
    std::unordered_set<std::string> active_volumes_;     // currently-inside volume IDs
    std::unordered_set<std::string> active_portals_;     // currently-inside portal IDs
    float load_radius_{0.0f};    // auto-set from manifest grid_cell_size
    float unload_radius_{0.0f};  // load_radius * 1.5 (hysteresis)

    std::vector<std::string> pending_loads_;    // filled each frame
    std::vector<std::string> pending_unloads_;  // filled each frame
    std::string entered_portal_id_;             // filled each frame

    static std::string make_grid_key(const glm::ivec3& grid);
};

}  // namespace gseurat
