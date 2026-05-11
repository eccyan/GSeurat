// Unit test: project_root survives engine restart
//
// Simulates the scenario where:
// 1. User sets project root via bridge
// 2. Engine (Staging) is not running yet
// 3. Engine starts later
// 4. project_root should be replayed on reconnect
//
// This test verifies the engine-side behavior: set_project_root is global
// state that persists across scene loads, and resolve_asset_path uses it.

#include "gseurat/engine/project_root.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gaussian_cloud_ply.hpp"

#include <cassert>
#include <cstdio>
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

static void write_test_ply(const fs::path& path, int count = 4) {
    fs::create_directories(path.parent_path());
    std::ofstream f(path, std::ios::binary);
    f << "ply\nformat binary_little_endian 1.0\nelement vertex " << count << "\n";
    f << "property float x\nproperty float y\nproperty float z\n";
    f << "property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n";
    f << "property float opacity\n";
    f << "property float scale_0\nproperty float scale_1\nproperty float scale_2\n";
    f << "property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n";
    f << "end_header\n";
    for (int i = 0; i < count; ++i) {
        float data[14] = {};
        data[0] = static_cast<float>(i);
        data[6] = 5.0f; data[7] = -2.0f; data[8] = -2.0f; data[9] = -2.0f; data[10] = 1.0f;
        f.write(reinterpret_cast<const char*>(data), sizeof(data));
    }
}

int main() {
    std::printf("=== Bridge Reconnect Project Root Tests ===\n\n");

    fs::path tmp = fs::temp_directory_path() / "gseurat_test_reconnect";
    fs::remove_all(tmp);
    fs::path project = tmp / "my_game";
    write_test_ply(project / "assets" / "maps" / "tunnel.ply", 10);

    // Scenario: project_root NOT set → load fails
    std::printf("Scenario 1: no project_root, relative path fails\n");
    {
        set_project_root("");
        bool threw = false;
        try { ply::load("assets/maps/tunnel.ply"); }
        catch (const std::runtime_error&) { threw = true; }
        check(threw, "relative path fails without project_root");
    }

    // Scenario: project_root set → load succeeds
    std::printf("Scenario 2: project_root set, relative path succeeds\n");
    {
        set_project_root(project.string());
        auto cloud = ply::load("assets/maps/tunnel.ply");
        check(cloud.count() == 10, "loaded 10 Gaussians with project_root");
    }

    // Scenario: absolute path always works regardless of project_root
    std::printf("Scenario 3: absolute path works without project_root\n");
    {
        set_project_root("");
        auto abs_path = (project / "assets" / "maps" / "tunnel.ply").string();
        auto cloud = ply::load(abs_path);
        check(cloud.count() == 10, "absolute path works without project_root");
    }

    // Scenario: simulate Bricklayer resolving to absolute before sending
    std::printf("Scenario 4: pre-resolved absolute path (Bricklayer fix)\n");
    {
        set_project_root("");  // engine has no project_root
        // Bricklayer resolves: bridgePath + "/" + relative = absolute
        std::string bridge_path = project.string();
        std::string relative = "assets/maps/tunnel.ply";
        std::string resolved = bridge_path + "/" + relative;
        auto cloud = ply::load(resolved);
        check(cloud.count() == 10, "pre-resolved path loads without project_root");
    }

    fs::remove_all(tmp);

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
