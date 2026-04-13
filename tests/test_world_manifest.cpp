// Unit test: WorldManifest — parse, serialize, round-trip, geometry helpers
//
// Build:
//   c++ -std=c++23 -I include -I build/macos-debug/_deps/glm-src \
//       -I build/macos-debug/_deps/json-src/include \
//       tests/test_world_manifest.cpp src/engine/world_manifest.cpp \
//       -o build/test_world_manifest
//
// Run: ./build/test_world_manifest

#include "gseurat/engine/world_manifest.hpp"
#include <nlohmann/json.hpp>

#include <cassert>
#include <cmath>
#include <cstdio>

using namespace gseurat;
using nlohmann::json;

static bool approx(float a, float b, float eps = 1e-4f) {
    return std::fabs(a - b) <= eps;
}

int main() {
    int passed = 0;

    // 1. Parse minimal manifest
    {
        json j = {
            {"version", 1},
            {"grid_cell_size", {64.0f, 32.0f, 64.0f}},
            {"chunks", json::array({
                {{"grid", {0, 0, 0}}, {"ply_file", "chunks/c0.ply"}}
            })}
        };

        auto m = WorldManifest::from_json(j);

        assert(m.version == 1);
        assert(approx(m.grid_cell_size.x, 64.0f));
        assert(approx(m.grid_cell_size.y, 32.0f));
        assert(approx(m.grid_cell_size.z, 64.0f));
        assert(m.chunks.size() == 1);
        assert(m.chunks[0].grid == glm::ivec3(0, 0, 0));
        assert(m.chunks[0].ply_file == "chunks/c0.ply");
        assert(m.chunks[0].scene_file.empty());
        assert(m.streaming_volumes.empty());
        assert(m.portals.empty());

        std::printf("PASS: parse minimal manifest\n");
        ++passed;
    }

    // 2. Parse chunks with scene_file
    {
        json j = {
            {"version", 1},
            {"grid_cell_size", {64.0f, 32.0f, 64.0f}},
            {"chunks", json::array({
                {{"grid", {1, 0, 2}}, {"ply_file", "chunks/c1.ply"}, {"scene_file", "scenes/town.json"}}
            })}
        };

        auto m = WorldManifest::from_json(j);

        assert(m.chunks.size() == 1);
        assert(m.chunks[0].grid == glm::ivec3(1, 0, 2));
        assert(m.chunks[0].ply_file == "chunks/c1.ply");
        assert(m.chunks[0].scene_file == "scenes/town.json");

        std::printf("PASS: parse chunks with scene_file\n");
        ++passed;
    }

    // 3. Parse streaming volumes (box + sphere)
    {
        json j = {
            {"version", 1},
            {"grid_cell_size", {64.0f, 32.0f, 64.0f}},
            {"chunks", json::array()},
            {"streaming_volumes", json::array({
                {
                    {"id", "vol_box"},
                    {"shape", "box"},
                    {"position", {10.0f, 0.0f, 20.0f}},
                    {"half_extents", {8.0f, 4.0f, 8.0f}},
                    {"preload_target_ids", {"chunk_a", "chunk_b"}}
                },
                {
                    {"id", "vol_sphere"},
                    {"shape", "sphere"},
                    {"position", {50.0f, 0.0f, 50.0f}},
                    {"radius", 12.0f},
                    {"preload_target_ids", {"chunk_c"}}
                }
            })}
        };

        auto m = WorldManifest::from_json(j);

        assert(m.streaming_volumes.size() == 2);

        const auto& box = m.streaming_volumes[0];
        assert(box.id == "vol_box");
        assert(box.shape == "box");
        assert(approx(box.position.x, 10.0f));
        assert(approx(box.position.z, 20.0f));
        assert(approx(box.half_extents.x, 8.0f));
        assert(approx(box.half_extents.y, 4.0f));
        assert(box.preload_target_ids.size() == 2);
        assert(box.preload_target_ids[0] == "chunk_a");
        assert(box.preload_target_ids[1] == "chunk_b");

        const auto& sphere = m.streaming_volumes[1];
        assert(sphere.id == "vol_sphere");
        assert(sphere.shape == "sphere");
        assert(approx(sphere.radius, 12.0f));
        assert(sphere.preload_target_ids.size() == 1);
        assert(sphere.preload_target_ids[0] == "chunk_c");

        std::printf("PASS: parse streaming volumes\n");
        ++passed;
    }

    // 4. Parse global portals
    {
        json j = {
            {"version", 1},
            {"grid_cell_size", {64.0f, 32.0f, 64.0f}},
            {"chunks", json::array()},
            {"portals", json::array({
                {
                    {"id", "portal_dungeon"},
                    {"position", {100.0f, 0.0f, 200.0f}},
                    {"region_shape", "sphere"},
                    {"region_radius", 3.0f},
                    {"target_instance_id", "dungeon_01"},
                    {"spawn_position", {5.0f, 0.0f, 5.0f}},
                    {"spawn_facing", "south"}
                }
            })}
        };

        auto m = WorldManifest::from_json(j);

        assert(m.portals.size() == 1);
        const auto& p = m.portals[0];
        assert(p.id == "portal_dungeon");
        assert(approx(p.position.x, 100.0f));
        assert(approx(p.position.z, 200.0f));
        assert(p.region_shape == "sphere");
        assert(approx(p.region_radius, 3.0f));
        assert(p.target_instance_id == "dungeon_01");
        assert(approx(p.spawn_position.x, 5.0f));
        assert(p.spawn_facing == "south");

        std::printf("PASS: parse global portals\n");
        ++passed;
    }

    // 5. Chunk AABB derivation: grid [2,1,3] with cell [64,32,64]
    {
        WorldManifest m;
        m.grid_cell_size = glm::vec3(64.0f, 32.0f, 64.0f);

        WorldChunk c;
        c.grid = glm::ivec3(2, 1, 3);
        c.ply_file = "test.ply";
        m.chunks.push_back(c);

        auto [mn, mx] = m.chunk_aabb(0);

        assert(approx(mn.x, 128.0f));
        assert(approx(mn.y, 32.0f));
        assert(approx(mn.z, 192.0f));
        assert(approx(mx.x, 192.0f));
        assert(approx(mx.y, 64.0f));
        assert(approx(mx.z, 256.0f));

        std::printf("PASS: chunk AABB derivation\n");
        ++passed;
    }

    // 6. Round-trip: parse -> serialize -> parse -> verify
    {
        json j = {
            {"version", 2},
            {"grid_cell_size", {32.0f, 16.0f, 32.0f}},
            {"chunks", json::array({
                {{"grid", {0, 0, 0}}, {"ply_file", "a.ply"}, {"scene_file", "s.json"}},
                {{"grid", {1, 0, 0}}, {"ply_file", "b.ply"}}
            })},
            {"streaming_volumes", json::array({
                {
                    {"id", "sv1"},
                    {"shape", "box"},
                    {"position", {0.0f, 0.0f, 0.0f}},
                    {"half_extents", {4.0f, 4.0f, 4.0f}},
                    {"preload_target_ids", {"t1"}}
                }
            })},
            {"portals", json::array({
                {
                    {"id", "p1"},
                    {"position", {10.0f, 0.0f, 10.0f}},
                    {"region_shape", "sphere"},
                    {"region_radius", 2.0f},
                    {"target_instance_id", "inst_a"},
                    {"spawn_position", {1.0f, 0.0f, 1.0f}},
                    {"spawn_facing", "north"}
                }
            })}
        };

        auto m1 = WorldManifest::from_json(j);
        auto j2 = WorldManifest::to_json(m1);
        auto m2 = WorldManifest::from_json(j2);

        assert(m2.version == m1.version);
        assert(approx(m2.grid_cell_size.x, m1.grid_cell_size.x));
        assert(m2.chunks.size() == m1.chunks.size());
        assert(m2.chunks[0].ply_file == m1.chunks[0].ply_file);
        assert(m2.chunks[0].scene_file == m1.chunks[0].scene_file);
        assert(m2.chunks[1].scene_file.empty());
        assert(m2.streaming_volumes.size() == 1);
        assert(m2.streaming_volumes[0].id == "sv1");
        assert(m2.portals.size() == 1);
        assert(m2.portals[0].id == "p1");
        assert(m2.portals[0].spawn_facing == "north");

        std::printf("PASS: to_json round-trip\n");
        ++passed;
    }

    // 7. point_in_volume box test
    {
        StreamingVolume v;
        v.shape = "box";
        v.position = glm::vec3(10.0f, 0.0f, 10.0f);
        v.half_extents = glm::vec3(5.0f, 5.0f, 5.0f);

        assert(v.contains(glm::vec3(10.0f, 0.0f, 10.0f)));       // center
        assert(v.contains(glm::vec3(14.9f, 4.9f, 14.9f)));        // near corner inside
        assert(!v.contains(glm::vec3(16.0f, 0.0f, 10.0f)));       // outside

        std::printf("PASS: point_in_volume box\n");
        ++passed;
    }

    // 8. point_in_volume sphere test
    {
        StreamingVolume v;
        v.shape = "sphere";
        v.position = glm::vec3(0.0f, 0.0f, 0.0f);
        v.radius = 10.0f;

        assert(v.contains(glm::vec3(0.0f, 0.0f, 0.0f)));    // center
        assert(v.contains(glm::vec3(7.0f, 0.0f, 0.0f)));    // inside
        assert(!v.contains(glm::vec3(11.0f, 0.0f, 0.0f)));  // outside

        std::printf("PASS: point_in_volume sphere\n");
        ++passed;
    }

    // 9. Path traversal in ply_file is rejected
    {
        auto j = nlohmann::json::parse(R"({
            "version": 1,
            "grid_cell_size": [64.0, 32.0, 64.0],
            "chunks": [{"grid": [0,0,0], "ply_file": "../../etc/passwd"}],
            "streaming_volumes": [],
            "portals": []
        })");
        bool threw = false;
        try { WorldManifest::from_json(j); } catch (...) { threw = true; }
        assert(threw && "path traversal in ply_file should throw");

        std::printf("PASS: path traversal in ply_file rejected\n");
        ++passed;
    }

    // 10. Path traversal in scene_file is rejected
    {
        auto j = nlohmann::json::parse(R"({
            "version": 1,
            "grid_cell_size": [64.0, 32.0, 64.0],
            "chunks": [{"grid": [0,0,0], "ply_file": "chunks/c0.ply", "scene_file": "../../etc/shadow"}],
            "streaming_volumes": [],
            "portals": []
        })");
        bool threw = false;
        try { WorldManifest::from_json(j); } catch (...) { threw = true; }
        assert(threw && "path traversal in scene_file should throw");

        std::printf("PASS: path traversal in scene_file rejected\n");
        ++passed;
    }

    std::printf("\n%d/10 tests passed\n", passed);
    return (passed == 10) ? 0 : 1;
}
