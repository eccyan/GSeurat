// Unit test: WorldStreamer — distance-based streaming, volume evaluation, portal detection
//
// Build:
//   c++ -std=c++23 -I include -I build/macos-debug/_deps/glm-src \
//       -I build/macos-debug/_deps/json-src/include \
//       tests/test_world_streamer.cpp src/engine/world_streamer.cpp \
//       src/engine/world_manifest.cpp \
//       -o build/test_world_streamer
//
// Run: ./build/test_world_streamer

#include "gseurat/engine/world_manifest.hpp"
#include "gseurat/engine/world_streamer.hpp"

#include <glm/glm.hpp>

#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

using namespace gseurat;

// Helper: build a minimal WorldManifest with N chunks along the X axis
// Each chunk occupies [i*cell, (i+1)*cell] in X, 0 in Y/Z grid.
static WorldManifest make_test_manifest(int chunk_count,
                                        glm::vec3 cell_size = glm::vec3(64.0f, 32.0f, 64.0f)) {
    WorldManifest m;
    m.version = 1;
    m.grid_cell_size = cell_size;
    for (int i = 0; i < chunk_count; ++i) {
        WorldChunk c;
        c.grid = glm::ivec3(i, 0, 0);
        c.ply_file = "chunk_" + std::to_string(i) + ".ply";
        m.chunks.push_back(c);
    }
    return m;
}

// Helper: grid key string
static std::string gk(int x, int y, int z) {
    return std::to_string(x) + "," + std::to_string(y) + "," + std::to_string(z);
}

int main() {
    // 1. init sets all chunks to UNLOADED
    {
        auto manifest = make_test_manifest(2);
        WorldStreamer streamer;
        streamer.init(manifest);

        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::UNLOADED);
        assert(streamer.chunk_status(gk(1,0,0)) == WorldStreamer::ChunkStatus::UNLOADED);
        std::printf("PASS: init sets all chunks to UNLOADED\n");
    }

    // 2. update triggers load for nearby chunk
    {
        auto manifest = make_test_manifest(2);
        WorldStreamer streamer;
        streamer.init(manifest);

        // Chunk 0 center: (32, 16, 32) with cell_size (64,32,64)
        // Camera at chunk 0 center — distance = 0, well within load_radius
        glm::vec3 cam(32.0f, 16.0f, 32.0f);
        auto events = streamer.update(cam);

        // At least one CHUNK_LOAD_START event
        bool found_load_start = false;
        for (const auto& e : events) {
            if (e.type == WorldStreamer::StreamEvent::Type::CHUNK_LOAD_START && e.id == gk(0,0,0)) {
                found_load_start = true;
            }
        }
        assert(found_load_start);
        assert(!streamer.pending_loads().empty());
        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::LOADING);
        std::printf("PASS: update triggers load for nearby chunk\n");
    }

    // 3. LOADING chunk is not re-requested
    {
        auto manifest = make_test_manifest(2);
        WorldStreamer streamer;
        streamer.init(manifest);

        glm::vec3 cam(32.0f, 16.0f, 32.0f);
        streamer.update(cam);  // triggers load for chunk 0

        // Second update at same position — chunk is now LOADING, should not re-request
        auto events = streamer.update(cam);
        assert(streamer.pending_loads().empty());
        for (const auto& e : events) {
            assert(e.type != WorldStreamer::StreamEvent::Type::CHUNK_LOAD_START ||
                   e.id != gk(0,0,0));
        }
        std::printf("PASS: LOADING chunk is not re-requested\n");
    }

    // 4. on_chunk_loaded transitions to ACTIVE
    {
        auto manifest = make_test_manifest(2);
        WorldStreamer streamer;
        streamer.init(manifest);

        glm::vec3 cam(32.0f, 16.0f, 32.0f);
        streamer.update(cam);
        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::LOADING);

        streamer.on_chunk_loaded(gk(0,0,0), 42u);
        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::ACTIVE);
        std::printf("PASS: on_chunk_loaded transitions to ACTIVE\n");
    }

    // 5. ACTIVE chunk unloads when far
    {
        // Use a small cell size so we have precise control over distances
        auto manifest = make_test_manifest(2, glm::vec3(10.0f, 10.0f, 10.0f));
        WorldStreamer streamer;
        streamer.init(manifest);
        // load_radius = length(10,10,10)*2 ≈ 34.6, unload_radius ≈ 51.9

        // Move camera to chunk 0 center (5,5,5) and load it
        glm::vec3 cam_near(5.0f, 5.0f, 5.0f);
        streamer.update(cam_near);
        streamer.on_chunk_loaded(gk(0,0,0), 7u);
        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::ACTIVE);

        // Move camera very far away — beyond unload_radius
        glm::vec3 cam_far(5000.0f, 5000.0f, 5000.0f);
        auto events = streamer.update(cam_far);

        bool found_unload = false;
        for (const auto& e : events) {
            if (e.type == WorldStreamer::StreamEvent::Type::CHUNK_UNLOADED && e.id == gk(0,0,0)) {
                found_unload = true;
            }
        }
        assert(found_unload);
        assert(!streamer.pending_unloads().empty());
        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::UNLOADED);
        std::printf("PASS: ACTIVE chunk unloads when far\n");
    }

    // 6. Hysteresis prevents thrashing
    {
        // Use cell size (10,10,10): load_radius ≈ 34.64, unload_radius ≈ 51.96
        auto manifest = make_test_manifest(1, glm::vec3(10.0f, 10.0f, 10.0f));
        WorldStreamer streamer;
        streamer.init(manifest);

        float lr = streamer.load_radius();
        float ur = streamer.unload_radius();

        // Camera exactly AT chunk 0 center (5,5,5) — loads chunk
        glm::vec3 chunk_center(5.0f, 5.0f, 5.0f);
        streamer.update(chunk_center);
        streamer.on_chunk_loaded(gk(0,0,0), 1u);
        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::ACTIVE);

        // Move camera to a distance between load_radius and unload_radius
        // Midpoint: (lr + ur) / 2 away from chunk center, along X axis
        float mid_dist = (lr + ur) * 0.5f;
        glm::vec3 cam_mid(chunk_center.x + mid_dist, chunk_center.y, chunk_center.z);
        auto events = streamer.update(cam_mid);

        // Must NOT unload — in hysteresis zone
        bool found_unload = false;
        for (const auto& e : events) {
            if (e.type == WorldStreamer::StreamEvent::Type::CHUNK_UNLOADED) {
                found_unload = true;
            }
        }
        assert(!found_unload);
        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::ACTIVE);
        std::printf("PASS: hysteresis prevents thrashing\n");
    }

    // 7. StreamingVolume triggers preload
    {
        WorldManifest manifest;
        manifest.grid_cell_size = glm::vec3(64.0f, 32.0f, 64.0f);

        // Add two chunks
        {
            WorldChunk c;
            c.grid = glm::ivec3(0, 0, 0);
            c.ply_file = "a.ply";
            manifest.chunks.push_back(c);
        }
        {
            WorldChunk c;
            c.grid = glm::ivec3(5, 0, 0);  // Far chunk — won't be loaded by distance
            c.ply_file = "b.ply";
            manifest.chunks.push_back(c);
        }

        // Streaming volume near origin that preloads the far chunk's grid key
        StreamingVolume vol;
        vol.id = "vol_bridge";
        vol.shape = "sphere";
        vol.position = glm::vec3(32.0f, 16.0f, 32.0f);
        vol.radius = 20.0f;
        vol.preload_target_ids = {gk(5, 0, 0)};
        manifest.streaming_volumes.push_back(vol);

        WorldStreamer streamer;
        streamer.init(manifest);

        // Camera inside the volume (at the volume center)
        glm::vec3 cam(32.0f, 16.0f, 32.0f);
        auto events = streamer.update(cam);

        // Expect VOLUME_ENTERED and CHUNK_LOAD_START for gk(5,0,0)
        bool found_vol_entered = false;
        bool found_preload = false;
        for (const auto& e : events) {
            if (e.type == WorldStreamer::StreamEvent::Type::VOLUME_ENTERED && e.id == "vol_bridge") {
                found_vol_entered = true;
            }
            if (e.type == WorldStreamer::StreamEvent::Type::CHUNK_LOAD_START && e.id == gk(5,0,0)) {
                found_preload = true;
            }
        }
        assert(found_vol_entered);
        assert(found_preload);
        assert(streamer.chunk_status(gk(5,0,0)) == WorldStreamer::ChunkStatus::LOADING);
        std::printf("PASS: StreamingVolume triggers preload\n");
    }

    // (Portal detection tests removed: WorldStreamer no longer detects portals.
    // Portals are ECS Game Objects with ProximityTrigger + PortalTarget components.)

    // 10. Volume exit event
    {
        WorldManifest manifest;
        manifest.grid_cell_size = glm::vec3(64.0f, 32.0f, 64.0f);
        {
            WorldChunk c; c.grid = glm::ivec3(0,0,0); c.ply_file = "a.ply";
            manifest.chunks.push_back(c);
        }

        StreamingVolume vol;
        vol.id = "vol_exit_test";
        vol.shape = "sphere";
        vol.position = glm::vec3(0.0f, 0.0f, 0.0f);
        vol.radius = 10.0f;
        manifest.streaming_volumes.push_back(vol);

        WorldStreamer streamer;
        streamer.init(manifest);

        // Enter volume
        glm::vec3 cam_in(0.0f, 0.0f, 0.0f);
        auto ev_enter = streamer.update(cam_in);
        bool found_enter = false;
        for (const auto& e : ev_enter) {
            if (e.type == WorldStreamer::StreamEvent::Type::VOLUME_ENTERED && e.id == "vol_exit_test") {
                found_enter = true;
            }
        }
        assert(found_enter);

        // Exit volume
        glm::vec3 cam_out(100.0f, 100.0f, 100.0f);
        auto ev_exit = streamer.update(cam_out);
        bool found_exit = false;
        for (const auto& e : ev_exit) {
            if (e.type == WorldStreamer::StreamEvent::Type::VOLUME_EXITED && e.id == "vol_exit_test") {
                found_exit = true;
            }
        }
        assert(found_exit);
        std::printf("PASS: Volume exit event\n");
    }

    // 11. mark_chunk_externally_managed suppresses distance transitions (#399)
    {
        WorldManifest manifest = make_test_manifest(2);

        WorldStreamer streamer;
        streamer.init(manifest);

        // Mark chunk (0,0,0) externally-managed (caller is responsible for
        // its GPU lifetime). Inform the streamer it's ACTIVE up front.
        streamer.on_chunk_loaded(gk(0,0,0), 42);
        streamer.mark_chunk_externally_managed(gk(0,0,0));

        // Camera near chunk (0,0,0): the load distance check would normally
        // re-trigger a LOADING transition if status were UNLOADED, but with
        // externally_managed=true the streamer must skip the chunk entirely.
        glm::vec3 cam_near(32.0f, 0.0f, 32.0f);  // inside chunk 0,0,0
        auto ev_near = streamer.update(cam_near);
        for (const auto& e : ev_near) {
            // Externally-managed chunk must produce no streaming events.
            assert(!(e.type == WorldStreamer::StreamEvent::Type::CHUNK_LOAD_START && e.id == gk(0,0,0)));
            assert(!(e.type == WorldStreamer::StreamEvent::Type::CHUNK_UNLOADED && e.id == gk(0,0,0)));
        }
        // pending_loads / pending_unloads must not contain the managed chunk.
        for (const auto& k : streamer.pending_loads())   assert(k != gk(0,0,0));
        for (const auto& k : streamer.pending_unloads()) assert(k != gk(0,0,0));

        // Camera far from chunk (0,0,0): the unload distance check would
        // normally fire ACTIVE→UNLOADED, but externally_managed suppresses it.
        glm::vec3 cam_far(10000.0f, 0.0f, 10000.0f);
        auto ev_far = streamer.update(cam_far);
        for (const auto& e : ev_far) {
            assert(!(e.type == WorldStreamer::StreamEvent::Type::CHUNK_UNLOADED && e.id == gk(0,0,0)));
        }
        for (const auto& k : streamer.pending_unloads()) assert(k != gk(0,0,0));
        // Status stays ACTIVE; renderer_chunk_id stays intact.
        assert(streamer.chunk_status(gk(0,0,0)) == WorldStreamer::ChunkStatus::ACTIVE);

        // Sanity: a non-externally-managed neighbor still gets normal
        // streaming transitions when far away.
        // (chunk (1,0,0) is non-managed; cam_far is also far from it →
        // it remains UNLOADED, no spurious events.)
        std::printf("PASS: externally_managed chunks skip distance transitions\n");
    }

    std::printf("\nAll world_streamer tests passed.\n");
    return 0;
}
