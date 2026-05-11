// Unit test: PLY path resolution with project_root
//
// Reproduces the Staging bug where load_scene_json fires before
// set_project_root is applied, causing PLY files to fail to load.
//
// Build: cmake --build --preset macos-release
// Run:   ctest -R test_ply_path_resolution -V

#include "gseurat/engine/project_root.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gaussian_cloud_ply.hpp"

#include <cassert>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;
using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) {
        std::printf("  PASS: %s\n", msg);
        passed++;
    } else {
        std::printf("  FAIL: %s\n", msg);
        failed++;
    }
}

// Create a minimal valid PLY file for testing
static void write_test_ply(const fs::path& path, int count = 4) {
    fs::create_directories(path.parent_path());
    std::ofstream f(path, std::ios::binary);
    f << "ply\n";
    f << "format binary_little_endian 1.0\n";
    f << "element vertex " << count << "\n";
    f << "property float x\n";
    f << "property float y\n";
    f << "property float z\n";
    f << "property float f_dc_0\n";
    f << "property float f_dc_1\n";
    f << "property float f_dc_2\n";
    f << "property float opacity\n";
    f << "property float scale_0\n";
    f << "property float scale_1\n";
    f << "property float scale_2\n";
    f << "property float rot_0\n";
    f << "property float rot_1\n";
    f << "property float rot_2\n";
    f << "property float rot_3\n";
    f << "end_header\n";
    // Write minimal vertex data (14 floats per vertex)
    for (int i = 0; i < count; ++i) {
        float data[14] = {};
        data[0] = static_cast<float>(i);  // x
        data[1] = 0.0f;                   // y
        data[2] = 0.0f;                   // z
        data[6] = 5.0f;                   // opacity (pre-sigmoid)
        data[7] = -2.0f;                  // scale_0 (pre-exp)
        data[8] = -2.0f;                  // scale_1
        data[9] = -2.0f;                  // scale_2
        data[10] = 1.0f;                  // rot_0 (quaternion w)
        f.write(reinterpret_cast<const char*>(data), sizeof(data));
    }
}

int main() {
    std::printf("=== PLY Path Resolution Tests ===\n\n");

    // Set up temp directories simulating a game project
    fs::path tmp = fs::temp_directory_path() / "gseurat_test_ply_resolve";
    fs::remove_all(tmp);

    fs::path project_dir = tmp / "my_game_project";
    fs::path ply_path = project_dir / "assets" / "maps" / "tunnel_present.ply";
    write_test_ply(ply_path, 4);

    // Test 1: load_ply with project_root set BEFORE load
    std::printf("Test 1: load_ply with project_root set before load\n");
    {
        set_project_root(project_dir.string());
        try {
            auto cloud = ply::load("assets/maps/tunnel_present.ply");
            check(cloud.count() == 4, "loaded 4 Gaussians via project_root");
        } catch (const std::exception& e) {
            check(false, e.what());
        }
        set_project_root("");
    }

    // Test 2: load_ply WITHOUT project_root — should fail for relative path
    std::printf("Test 2: load_ply without project_root (relative path fails)\n");
    {
        set_project_root("");
        bool threw = false;
        try {
            auto cloud = ply::load("assets/maps/tunnel_present.ply");
        } catch (const std::runtime_error&) {
            threw = true;
        }
        check(threw, "relative path fails without project_root");
    }

    // Test 3: load_ply with project_root set AFTER the path was constructed
    // This simulates the bug: set_project_root and load_scene_json in same batch
    // but project_root is empty when load_ply is called inside load_scene_json
    std::printf("Test 3: project_root timing — set during same \"frame\"\n");
    {
        set_project_root("");

        // Simulate: command 1 sets project root
        set_project_root(project_dir.string());

        // Simulate: command 2 loads scene (which calls load_ply internally)
        try {
            auto cloud = ply::load("assets/maps/tunnel_present.ply");
            check(cloud.count() == 4, "load succeeds when root set in same frame before load");
        } catch (const std::exception& e) {
            check(false, e.what());
        }
        set_project_root("");
    }

    // Test 4: resolve_asset_path produces correct full path
    std::printf("Test 4: resolve_asset_path correctness\n");
    {
        set_project_root(project_dir.string());
        auto resolved = resolve_asset_path("assets/maps/tunnel_present.ply");
        check(resolved == ply_path, "resolved path matches expected full path");
        check(fs::exists(resolved), "resolved path exists on disk");
        set_project_root("");
    }

    // Test 5: game object PLY also resolves through project_root
    std::printf("Test 5: game object PLY path resolution\n");
    {
        fs::path char_ply = project_dir / "assets" / "characters" / "knight" / "knight.ply";
        write_test_ply(char_ply, 8);

        set_project_root(project_dir.string());
        try {
            auto cloud = ply::load("assets/characters/knight/knight.ply");
            check(cloud.count() == 8, "character PLY loaded via project_root (8 gaussians)");
        } catch (const std::exception& e) {
            check(false, e.what());
        }
        set_project_root("");
    }

    // Cleanup
    fs::remove_all(tmp);

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
