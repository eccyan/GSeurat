#include "gseurat/engine/world_streamer.hpp"

#include <glm/glm.hpp>
#include <cmath>
#include <sstream>

namespace gseurat {

std::string WorldStreamer::make_grid_key(const glm::ivec3& grid) {
    std::ostringstream oss;
    oss << grid.x << ',' << grid.y << ',' << grid.z;
    return oss.str();
}

void WorldStreamer::init(const WorldManifest& manifest) {
    manifest_ = manifest;
    chunks_.clear();
    active_volumes_.clear();
    pending_loads_.clear();
    pending_unloads_.clear();

    // Populate chunk map — all start UNLOADED
    for (const auto& chunk : manifest_.chunks) {
        std::string key = make_grid_key(chunk.grid);
        ChunkInfo info;
        info.grid_key = key;
        info.ply_file = chunk.ply_file;
        info.status = ChunkStatus::UNLOADED;
        info.renderer_chunk_id = 0;
        chunks_.emplace(key, std::move(info));
    }

    // Auto-set radii from grid cell size
    load_radius_ = glm::length(manifest_.grid_cell_size) * 2.0f;
    unload_radius_ = load_radius_ * 1.5f;
}

std::vector<WorldStreamer::StreamEvent> WorldStreamer::update(const glm::vec3& camera_pos) {
    pending_loads_.clear();
    pending_unloads_.clear();

    std::vector<StreamEvent> events;

    // Distance-based chunk streaming
    for (size_t i = 0; i < manifest_.chunks.size(); ++i) {
        const auto& chunk = manifest_.chunks[i];
        std::string key = make_grid_key(chunk.grid);

        auto it = chunks_.find(key);
        if (it == chunks_.end()) continue;
        ChunkInfo& info = it->second;

        // Externally-managed chunks: the renderer holds their data via a
        // merge-at-init upload (or similar out-of-band mechanism), so a
        // streamer-driven load/unload would either duplicate the content
        // (append-only load_cloud_async) or unload the wrong chunk_id.
        // Suppress distance transitions entirely. See #399.
        if (info.externally_managed) continue;

        // Compute distance from camera to chunk AABB center
        auto [aabb_min, aabb_max] = manifest_.chunk_aabb(i);
        glm::vec3 center = (aabb_min + aabb_max) * 0.5f;
        float dist = glm::length(camera_pos - center);

        if (dist < load_radius_ && info.status == ChunkStatus::UNLOADED) {
            info.status = ChunkStatus::LOADING;
            pending_loads_.push_back(key);
            events.push_back({StreamEvent::Type::CHUNK_LOAD_START, key});
        } else if (dist > unload_radius_ && info.status == ChunkStatus::ACTIVE) {
            info.status = ChunkStatus::UNLOADED;
            info.renderer_chunk_id = 0;
            pending_unloads_.push_back(key);
            events.push_back({StreamEvent::Type::CHUNK_UNLOADED, key});
        }
        // LOADING chunks: skip — don't spam loads
    }

    // StreamingVolume evaluation
    for (const auto& vol : manifest_.streaming_volumes) {
        bool inside = vol.contains(camera_pos);
        bool was_inside = active_volumes_.count(vol.id) > 0;

        if (inside && !was_inside) {
            active_volumes_.insert(vol.id);
            events.push_back({StreamEvent::Type::VOLUME_ENTERED, vol.id});

            // Preload target chunks that are UNLOADED
            for (const auto& target_id : vol.preload_target_ids) {
                auto it = chunks_.find(target_id);
                if (it != chunks_.end() && it->second.status == ChunkStatus::UNLOADED) {
                    it->second.status = ChunkStatus::LOADING;
                    pending_loads_.push_back(target_id);
                    events.push_back({StreamEvent::Type::CHUNK_LOAD_START, target_id});
                }
            }
        } else if (!inside && was_inside) {
            active_volumes_.erase(vol.id);
            events.push_back({StreamEvent::Type::VOLUME_EXITED, vol.id});
        }
    }

    return events;
}

void WorldStreamer::on_chunk_loaded(const std::string& grid_key, uint32_t renderer_chunk_id) {
    auto it = chunks_.find(grid_key);
    if (it != chunks_.end()) {
        it->second.status = ChunkStatus::ACTIVE;
        it->second.renderer_chunk_id = renderer_chunk_id;
    }
}

void WorldStreamer::mark_chunk_externally_managed(const std::string& grid_key) {
    auto it = chunks_.find(grid_key);
    if (it != chunks_.end()) {
        it->second.externally_managed = true;
    }
}

WorldStreamer::ChunkStatus WorldStreamer::chunk_status(const std::string& grid_key) const {
    auto it = chunks_.find(grid_key);
    if (it == chunks_.end()) return ChunkStatus::UNLOADED;
    return it->second.status;
}

}  // namespace gseurat
