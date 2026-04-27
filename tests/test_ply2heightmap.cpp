// Unit test: ply2heightmap — headless tests for rasterize_splats, dilate_gaps,
// normalize_to_uint16, and write_png_16.
//
// Build:
//   cmake --build --preset macos-debug --target test_ply2heightmap -j8
//
// Run: cd build/macos-debug && ./test_ply2heightmap

#define PLY2HEIGHTMAP_NO_MAIN
#include "../src/tools/ply2heightmap.cpp"

#include <cfloat>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>

static int passed = 0, failed = 0;
static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else { std::printf("  FAIL: %s\n", msg); failed++; }
}
static bool approx(float a, float b, float eps = 0.1f) {
    return std::abs(a - b) < eps;
}

// Helper: create a Gaussian with common defaults
static Gaussian make_splat(glm::vec3 pos, glm::vec3 scale, float opacity = 1.0f) {
    Gaussian g{};
    g.position = pos;
    g.scale = scale;
    g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f); // identity
    g.color = glm::vec3(1.0f);
    g.opacity = opacity;
    g.importance = opacity * glm::max(scale.x, glm::max(scale.y, scale.z));
    g.bone_index = 0;
    g.emission = 0.0f;
    return g;
}

// ---------------------------------------------------------------------------
// test_flat_plane
// ---------------------------------------------------------------------------
void test_flat_plane() {
    std::printf("test_flat_plane:\n");

    // 4 splats at Y=5.0 in a 2x2 pattern, scale=1.0 uniform
    std::vector<Gaussian> splats = {
        make_splat({1.0f, 5.0f, 1.0f}, {1.0f, 1.0f, 1.0f}),
        make_splat({3.0f, 5.0f, 1.0f}, {1.0f, 1.0f, 1.0f}),
        make_splat({1.0f, 5.0f, 3.0f}, {1.0f, 1.0f, 1.0f}),
        make_splat({3.0f, 5.0f, 3.0f}, {1.0f, 1.0f, 1.0f}),
    };

    AABB bounds;
    for (const auto& g : splats) bounds.expand(g.position);

    HeightmapParams params;
    params.ppu = 2.0f;
    params.padding = 0.5f;

    HeightmapResult hm = rasterize_splats(splats, bounds, params);

    check(hm.width > 0 && hm.height > 0, "grid dimensions are positive");
    check(hm.cell_size > 0.0f, "cell_size is positive");

    // Check that center cells are filled (not -FLT_MAX)
    // The center of the grid should be covered by the splats
    uint32_t cx = hm.width / 2;
    uint32_t cz = hm.height / 2;
    size_t center_idx = static_cast<size_t>(cz) * hm.width + cx;
    float center_val = hm.grid[center_idx];

    check(center_val != -FLT_MAX, "center cell is filled");
    // position.y=5 + half_y=1 (scale.y=1, identity rotation) = 6.0
    check(approx(center_val, 6.0f), "center cell value ~6.0 (pos.y + half_y)");
}

// ---------------------------------------------------------------------------
// test_gap_fill
// ---------------------------------------------------------------------------
void test_gap_fill() {
    std::printf("test_gap_fill:\n");

    // 5x5 grid filled with 10.0, center cell is a hole
    const uint32_t w = 5, h = 5;
    std::vector<float> src(w * h, 10.0f);
    src[12] = -FLT_MAX; // center cell (2,2) = index 12

    std::vector<float> dst;
    dilate_gaps(src, dst, w, h);

    check(dst[12] == 10.0f, "center hole filled to 10.0");
    check(dst[0] == 10.0f, "corner cell unchanged");
    check(dst[6] == 10.0f, "non-hole cell unchanged");
}

// ---------------------------------------------------------------------------
// test_flat_world
// ---------------------------------------------------------------------------
void test_flat_world() {
    std::printf("test_flat_world:\n");

    const uint32_t w = 4, h = 4;
    std::vector<float> grid(w * h, 42.0f);

    NormResult norm = normalize_to_uint16(grid, w, h);

    check(norm.max_height > norm.min_height, "flat-world guard: max > min");

    // All pixels should be identical (all same input value)
    bool all_same = true;
    uint16_t first = norm.pixels[0];
    for (size_t i = 1; i < norm.pixels.size(); ++i) {
        if (norm.pixels[i] != first) { all_same = false; break; }
    }
    check(all_same, "all pixels identical for flat input");

    // No NaN in float outputs
    check(!std::isnan(norm.min_height), "min_height is not NaN");
    check(!std::isnan(norm.max_height), "max_height is not NaN");
}

// ---------------------------------------------------------------------------
// test_opacity_filter
// ---------------------------------------------------------------------------
void test_opacity_filter() {
    std::printf("test_opacity_filter:\n");

    // Two Gaussians: one visible, one below threshold
    std::vector<Gaussian> all = {
        make_splat({0.0f, 5.0f, 0.0f}, {1.0f, 1.0f, 1.0f}, 1.0f),
        make_splat({0.0f, 100.0f, 0.0f}, {1.0f, 1.0f, 1.0f}, 0.01f),
    };

    float min_opacity = 0.1f;
    std::vector<Gaussian> filtered;
    for (const auto& g : all) {
        if (g.opacity >= min_opacity) filtered.push_back(g);
    }

    check(filtered.size() == 1, "only one Gaussian passes opacity filter");
    check(approx(filtered[0].position.y, 5.0f), "surviving Gaussian is the visible one");
}

// ---------------------------------------------------------------------------
// test_aabb_footprint
// ---------------------------------------------------------------------------
void test_aabb_footprint() {
    std::printf("test_aabb_footprint:\n");

    // Single splat at origin, scale=(2,1,3), identity rotation
    std::vector<Gaussian> splats = {
        make_splat({0.0f, 0.0f, 0.0f}, {2.0f, 1.0f, 3.0f}),
    };

    AABB bounds;
    bounds.expand(splats[0].position);

    HeightmapParams params;
    params.ppu = 1.0f;
    params.padding = 3.5f;

    HeightmapResult hm = rasterize_splats(splats, bounds, params);

    // Count filled cells
    int filled = 0;
    for (size_t i = 0; i < hm.grid.size(); ++i) {
        if (hm.grid[i] != -FLT_MAX) ++filled;
    }

    // Splat covers ~4x6 world units (half_x=2, half_z=3 → 4 wide, 6 tall)
    // At ppu=1.0 that's roughly 24 cells
    check(filled >= 20 && filled <= 35,
          "filled cell count in expected range (20-35)");

    // Filled cells should have value ~1.0 (position.y=0 + half_y=1)
    bool values_ok = true;
    for (size_t i = 0; i < hm.grid.size(); ++i) {
        if (hm.grid[i] != -FLT_MAX && !approx(hm.grid[i], 1.0f)) {
            values_ok = false;
            break;
        }
    }
    check(values_ok, "filled cell values ~1.0 (pos.y=0 + half_y=1)");
}

// ---------------------------------------------------------------------------
// test_png_roundtrip
// ---------------------------------------------------------------------------
void test_png_roundtrip() {
    std::printf("test_png_roundtrip:\n");

    const uint32_t w = 4, h = 4;
    std::vector<uint16_t> data(w * h);
    for (uint32_t i = 0; i < w * h; ++i) {
        data[i] = static_cast<uint16_t>(i * 4096);
    }

    // Build path in TMPDIR
    const char* tmpdir = std::getenv("TMPDIR");
    std::string path = tmpdir ? std::string(tmpdir) : std::string("/tmp");
    if (!path.empty() && path.back() != '/') path += '/';
    path += "test_ply2heightmap_roundtrip.png";

    bool ok = write_png_16(path.c_str(), data.data(), w, h);
    check(ok, "write_png_16 returns true");

    // Check file exists and has reasonable size
    auto fsize = std::filesystem::file_size(path);
    check(fsize > 50, "PNG file size > 50 bytes");

    // Clean up
    std::filesystem::remove(path);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main() {
    std::printf("=== test_ply2heightmap ===\n");

    test_flat_plane();
    test_gap_fill();
    test_flat_world();
    test_opacity_filter();
    test_aabb_footprint();
    test_png_roundtrip();

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
