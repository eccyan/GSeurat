// Unit test: project_root — set/get/resolve_asset_path
//
// Build:
//   c++ -std=c++23 -I include tests/test_project_root.cpp -o build/test_project_root
//
// Run: ./build/test_project_root

#include "gseurat/engine/project_root.hpp"

#include <cassert>
#include <cstdio>
#include <filesystem>

using namespace gseurat;

int main() {
    // 1. Default: empty project root → returns input unchanged (back-compat)
    {
        set_project_root("");
        auto result = resolve_asset_path("assets/scenes/town.json");
        assert(result == std::filesystem::path("assets/scenes/town.json"));
        std::printf("PASS: empty root → passthrough\n");
    }

    // 2. Absolute paths bypass project root entirely
    {
        set_project_root("/tmp/p");
        auto result = resolve_asset_path("/abs/path/foo.ply");
        assert(result == std::filesystem::path("/abs/path/foo.ply"));
        std::printf("PASS: absolute path bypasses project root\n");
    }

    // 3. Relative path with project root → joined
    {
        set_project_root("/tmp/myproj");
        auto result = resolve_asset_path("assets/scenes/town.json");
        assert(result == std::filesystem::path("/tmp/myproj/assets/scenes/town.json"));
        std::printf("PASS: relative + root → joined\n");
    }

    // 4. Clear project root → returns input unchanged again
    {
        set_project_root("");
        auto result = resolve_asset_path("assets/maps/town.ply");
        assert(result == std::filesystem::path("assets/maps/town.ply"));
        std::printf("PASS: cleared root → passthrough again\n");
    }

    // 5. Empty input is returned as-is (don't crash)
    {
        set_project_root("/tmp/myproj");
        auto result = resolve_asset_path("");
        assert(result == std::filesystem::path(""));
        std::printf("PASS: empty input → empty path (no crash)\n");
    }

    // 6. get_project_root returns whatever was last set
    {
        set_project_root("/tmp/x");
        assert(get_project_root() == "/tmp/x");
        set_project_root("");
        assert(get_project_root() == "");
        std::printf("PASS: get_project_root round-trips set values\n");
    }

    std::printf("\nAll project_root tests passed.\n");
    return 0;
}
