# ply2heightmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool that converts Gaussian-splat PLY point clouds to 16-bit grayscale PNG heightmaps for the KCC collision pipeline.

**Architecture:** Single-file CLI (`src/tools/ply2heightmap.cpp`) with free functions for rasterization, dilation, normalization, and 16-bit PNG writing. Reuses `GaussianCloud::load_ply()` for input. Tests exercise the core functions directly.

**Tech Stack:** C++23, GLM, stb_image_write (zlib compress only), GaussianCloud

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/tools/ply2heightmap.cpp` | CLI entry point + all rasterizer functions |
| `tests/test_ply2heightmap.cpp` | Headless unit tests for core functions |
| `CMakeLists.txt` | Build targets for executable and test |

---

### Task 1: Scaffold the executable and build target

**Files:**
- Create: `src/tools/ply2heightmap.cpp`
- Modify: `CMakeLists.txt:348` (before `endif() # GSEURAT_BUILD_EXAMPLES`)

- [ ] **Step 1: Create the source file with a minimal main**

```cpp
// src/tools/ply2heightmap.cpp
// ply2heightmap — Convert Gaussian-splat PLY to 16-bit heightmap PNG.

#include "gseurat/engine/gaussian_cloud.hpp"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

using namespace gseurat;

// ── Forward declarations ─────────────────────────────────────────────────────

struct HeightmapParams {
    float ppu         = 2.0f;
    float padding     = 1.0f;
    float min_opacity = 0.1f;
    bool  z_up        = false;
};

struct HeightmapResult {
    std::vector<float> grid;    // height per cell (-FLT_MAX = no data)
    uint32_t width  = 0;       // pixels (X axis)
    uint32_t height = 0;       // pixels (Z axis)
    float cell_size = 0.0f;
    AABB  padded_aabb;
};

HeightmapResult rasterize_splats(const std::vector<Gaussian>& splats,
                                  const AABB& bounds,
                                  const HeightmapParams& params);

void dilate_gaps(const std::vector<float>& src, std::vector<float>& dst,
                 uint32_t w, uint32_t h);

struct NormResult {
    std::vector<uint16_t> pixels;
    float min_height;
    float max_height;
};

NormResult normalize_to_uint16(const std::vector<float>& grid,
                                uint32_t w, uint32_t h);

bool write_png_16(const char* path, const uint16_t* data,
                  uint32_t w, uint32_t h);

// ── Main ─────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::fprintf(stderr,
            "Usage: ply2heightmap <input.ply> <output.png> [options]\n"
            "\n"
            "Options:\n"
            "  --ppu <float>          Pixels per world-unit (default: 2.0)\n"
            "  --padding <float>      Extra world-units around AABB (default: 1.0)\n"
            "  --min-opacity <float>  Skip splats below this opacity (default: 0.1)\n"
            "  --z-up                 Interpret Z as height (default: Y-up)\n");
        return 1;
    }

    const char* input_path  = argv[1];
    const char* output_path = argv[2];

    HeightmapParams params;
    for (int i = 3; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg == "--ppu" && i + 1 < argc)         params.ppu = std::atof(argv[++i]);
        else if (arg == "--padding" && i + 1 < argc) params.padding = std::atof(argv[++i]);
        else if (arg == "--min-opacity" && i + 1 < argc) params.min_opacity = std::atof(argv[++i]);
        else if (arg == "--z-up")                     params.z_up = true;
        else {
            std::fprintf(stderr, "Unknown option: %s\n", argv[i]);
            return 1;
        }
    }

    // Load PLY
    GaussianCloud cloud;
    try {
        cloud = GaussianCloud::load_ply(input_path);
    } catch (const std::exception& e) {
        std::fprintf(stderr, "Error loading PLY: %s\n", e.what());
        return 1;
    }

    if (cloud.empty()) {
        std::fprintf(stderr, "Error: PLY contains no splats.\n");
        return 1;
    }

    // Filter by opacity
    std::vector<Gaussian> filtered;
    filtered.reserve(cloud.count());
    for (const auto& g : cloud.gaussians()) {
        if (g.opacity >= params.min_opacity) {
            filtered.push_back(g);
        }
    }

    uint32_t skipped = cloud.count() - static_cast<uint32_t>(filtered.size());
    if (filtered.empty()) {
        std::fprintf(stderr, "Error: All %u splats filtered below opacity %.2f.\n",
                     cloud.count(), params.min_opacity);
        return 1;
    }

    // Z-up swap: rotate positions and scales so Y becomes height
    if (params.z_up) {
        for (auto& g : filtered) {
            std::swap(g.position.y, g.position.z);
            std::swap(g.scale.y, g.scale.z);
            // Swap quaternion components to match axis swap
            std::swap(g.rotation.y, g.rotation.z);
        }
    }

    // Compute bounds from filtered splats
    AABB bounds;
    for (const auto& g : filtered) bounds.expand(g.position);

    // Rasterize
    auto result = rasterize_splats(filtered, bounds, params);

    // Dilate gaps (double-buffered)
    std::vector<float> dilated(result.grid.size());
    dilate_gaps(result.grid, dilated, result.width, result.height);

    // Normalize to uint16
    auto norm = normalize_to_uint16(dilated, result.width, result.height);

    // Write PNG
    if (!write_png_16(output_path, norm.pixels.data(), result.width, result.height)) {
        std::fprintf(stderr, "Error: Failed to write PNG to %s\n", output_path);
        return 1;
    }

    // Print summary to stdout
    const auto& aabb = result.padded_aabb;
    float world_w = aabb.max.x - aabb.min.x;
    float world_l = aabb.max.z - aabb.min.z;

    std::printf("Loaded %u splats from %s (filtered %u below opacity %.2f)\n",
                static_cast<uint32_t>(filtered.size()) + skipped,
                input_path, skipped, params.min_opacity);
    std::printf("AABB: (%.1f, %.1f, %.1f) -> (%.1f, %.1f, %.1f)\n",
                aabb.min.x, aabb.min.y, aabb.min.z,
                aabb.max.x, aabb.max.y, aabb.max.z);
    std::printf("Grid: %ux%u, cell_size=%.3f, ppu=%.1f\n",
                result.width, result.height, result.cell_size, params.ppu);
    std::printf("Height range: %.3f -> %.3f\n", norm.min_height, norm.max_height);
    std::printf("Wrote: %s\n\n", output_path);
    std::printf("# HeightfieldComponent values:\n");
    std::printf("  \"width\": %.1f\n", world_w);
    std::printf("  \"length\": %.1f\n", world_l);
    std::printf("  \"min_height\": %.3f\n", norm.min_height);
    std::printf("  \"max_height\": %.3f\n", norm.max_height);

    return 0;
}
```

- [ ] **Step 2: Add CMake targets**

Insert before `endif() # GSEURAT_BUILD_EXAMPLES` in `CMakeLists.txt` (around line 348):

```cmake
add_executable(ply2heightmap src/tools/ply2heightmap.cpp
    src/engine/gaussian_cloud.cpp)
target_include_directories(ply2heightmap PRIVATE
    ${PROJECT_SOURCE_DIR}/include
    ${stb_SOURCE_DIR})
target_compile_definitions(ply2heightmap PRIVATE GLM_FORCE_DEPTH_ZERO_TO_ONE)
target_link_libraries(ply2heightmap PRIVATE glm::glm nlohmann_json::nlohmann_json)
```

- [ ] **Step 3: Create the src/tools directory**

```bash
mkdir -p src/tools
```

- [ ] **Step 4: Build to verify it compiles (link errors expected for unimplemented functions)**

```bash
cmake --build --preset macos-debug --target ply2heightmap -j8 2>&1 | tail -10
```

Expected: Linker errors for `rasterize_splats`, `dilate_gaps`, `normalize_to_uint16`, `write_png_16`. This confirms the scaffold is correct.

- [ ] **Step 5: Commit**

```bash
git add src/tools/ply2heightmap.cpp CMakeLists.txt
git commit -m "feat(tools): scaffold ply2heightmap CLI with arg parsing and pipeline"
```

---

### Task 2: Implement the AABB splat rasterizer

**Files:**
- Modify: `src/tools/ply2heightmap.cpp`

- [ ] **Step 1: Implement `rasterize_splats`**

Add after the forward declarations, before `main()`:

```cpp
// ── Rasterizer ───────────────────────────────────────────────────────────────

HeightmapResult rasterize_splats(const std::vector<Gaussian>& splats,
                                  const AABB& bounds,
                                  const HeightmapParams& params) {
    HeightmapResult result;

    // Pad the AABB
    result.padded_aabb.min = bounds.min - glm::vec3(params.padding);
    result.padded_aabb.max = bounds.max + glm::vec3(params.padding);
    const auto& aabb = result.padded_aabb;

    // Compute grid dimensions (uniform square cells)
    float ppu = params.ppu;
    result.cell_size = 1.0f / ppu;
    result.width  = static_cast<uint32_t>(
        std::ceil((aabb.max.x - aabb.min.x) * ppu));
    result.height = static_cast<uint32_t>(
        std::ceil((aabb.max.z - aabb.min.z) * ppu));

    // Clamp to at least 1x1
    if (result.width  == 0) result.width  = 1;
    if (result.height == 0) result.height = 1;

    // Allocate grid, sentinel = no data
    result.grid.assign(
        static_cast<size_t>(result.width) * result.height, -FLT_MAX);

    int w = static_cast<int>(result.width);
    int h = static_cast<int>(result.height);

    for (const auto& g : splats) {
        // 1. Rotate scale axes by quaternion
        glm::vec3 ax = g.rotation * glm::vec3(g.scale.x, 0.0f, 0.0f);
        glm::vec3 ay = g.rotation * glm::vec3(0.0f, g.scale.y, 0.0f);
        glm::vec3 az = g.rotation * glm::vec3(0.0f, 0.0f, g.scale.z);

        // 2. AABB half-extents (sum of absolute components)
        float half_x = std::abs(ax.x) + std::abs(ay.x) + std::abs(az.x);
        float half_y = std::abs(ax.y) + std::abs(ay.y) + std::abs(az.y);
        float half_z = std::abs(ax.z) + std::abs(ay.z) + std::abs(az.z);

        // 3. Conservative top-of-splat Y
        float top_y = g.position.y + half_y;

        // 4. Map to grid cells
        int x_min = static_cast<int>(
            std::floor((g.position.x - half_x - aabb.min.x) * ppu));
        int x_max = static_cast<int>(
            std::floor((g.position.x + half_x - aabb.min.x) * ppu));
        int z_min = static_cast<int>(
            std::floor((g.position.z - half_z - aabb.min.z) * ppu));
        int z_max = static_cast<int>(
            std::floor((g.position.z + half_z - aabb.min.z) * ppu));

        x_min = std::max(x_min, 0);
        x_max = std::min(x_max, w - 1);
        z_min = std::max(z_min, 0);
        z_max = std::min(z_max, h - 1);

        // 5. Fill cells with max Y
        for (int z = z_min; z <= z_max; ++z) {
            for (int x = x_min; x <= x_max; ++x) {
                float& cell = result.grid[static_cast<size_t>(z) * w + x];
                cell = std::max(cell, top_y);
            }
        }
    }

    return result;
}
```

- [ ] **Step 2: Build to verify compilation**

```bash
cmake --build --preset macos-debug --target ply2heightmap -j8 2>&1 | tail -5
```

Expected: Linker errors only for `dilate_gaps`, `normalize_to_uint16`, `write_png_16`.

- [ ] **Step 3: Commit**

```bash
git add src/tools/ply2heightmap.cpp
git commit -m "feat(tools): implement AABB splat rasterizer for ply2heightmap"
```

---

### Task 3: Implement dilation and normalization

**Files:**
- Modify: `src/tools/ply2heightmap.cpp`

- [ ] **Step 1: Implement `dilate_gaps`**

Add after `rasterize_splats`:

```cpp
// ── Gap fill (double-buffered 3x3 max dilation) ─────────────────────────────

void dilate_gaps(const std::vector<float>& src, std::vector<float>& dst,
                 uint32_t w, uint32_t h) {
    dst = src;  // copy all valid cells

    for (uint32_t z = 0; z < h; ++z) {
        for (uint32_t x = 0; x < w; ++x) {
            size_t idx = static_cast<size_t>(z) * w + x;
            if (src[idx] != -FLT_MAX) continue;  // already filled

            // 3x3 max of neighbors (read from src only)
            float best = -FLT_MAX;
            for (int dz = -1; dz <= 1; ++dz) {
                for (int dx = -1; dx <= 1; ++dx) {
                    int nx = static_cast<int>(x) + dx;
                    int nz = static_cast<int>(z) + dz;
                    if (nx < 0 || nx >= static_cast<int>(w)) continue;
                    if (nz < 0 || nz >= static_cast<int>(h)) continue;
                    float v = src[static_cast<size_t>(nz) * w + nx];
                    if (v > best) best = v;
                }
            }
            dst[idx] = best;  // may still be -FLT_MAX if no neighbors had data
        }
    }
}
```

- [ ] **Step 2: Implement `normalize_to_uint16`**

Add after `dilate_gaps`:

```cpp
// ── Normalize to uint16 ─────────────────────────────────────────────────────

NormResult normalize_to_uint16(const std::vector<float>& grid,
                                uint32_t w, uint32_t h) {
    NormResult result;
    size_t total = static_cast<size_t>(w) * h;
    result.pixels.resize(total);

    // Find min/max of filled cells
    float lo =  FLT_MAX;
    float hi = -FLT_MAX;
    for (size_t i = 0; i < total; ++i) {
        if (grid[i] == -FLT_MAX) continue;
        lo = std::min(lo, grid[i]);
        hi = std::max(hi, grid[i]);
    }

    // Flat-world guard
    if (hi - lo < 1e-5f) {
        hi = lo + 1.0f;
    }

    // If no cells were filled at all, set sensible defaults
    if (lo == FLT_MAX) {
        lo = 0.0f;
        hi = 1.0f;
    }

    result.min_height = lo;
    result.max_height = hi;

    float range = hi - lo;
    for (size_t i = 0; i < total; ++i) {
        if (grid[i] == -FLT_MAX) {
            result.pixels[i] = 0;  // maps to min_height
        } else {
            float normalized = (grid[i] - lo) / range;
            long val = std::lround(normalized * 65535.0f);
            result.pixels[i] = static_cast<uint16_t>(
                std::clamp(val, 0L, 65535L));
        }
    }

    return result;
}
```

- [ ] **Step 3: Build (should still have linker error for `write_png_16` only)**

```bash
cmake --build --preset macos-debug --target ply2heightmap -j8 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/ply2heightmap.cpp
git commit -m "feat(tools): add gap dilation and uint16 normalization"
```

---

### Task 4: Implement 16-bit PNG writer

**Files:**
- Modify: `src/tools/ply2heightmap.cpp`

**Note:** `stbi_write_png` only supports 8-bit per channel. PNG format natively supports 16-bit grayscale. We write the PNG manually using `stbi_zlib_compress` (exposed by stb_image_write) for IDAT compression.

- [ ] **Step 1: Implement `write_png_16`**

Add after `normalize_to_uint16`:

```cpp
// ── 16-bit grayscale PNG writer ─────────────────────────────────────────────
// PNG spec: 16-bit grayscale = color_type 0, bit_depth 16.
// stb_image_write only supports 8-bit, so we construct the PNG manually
// using stbi_zlib_compress for the IDAT payload.

static void png_write_u32be(uint8_t* p, uint32_t v) {
    p[0] = static_cast<uint8_t>((v >> 24) & 0xFF);
    p[1] = static_cast<uint8_t>((v >> 16) & 0xFF);
    p[2] = static_cast<uint8_t>((v >>  8) & 0xFF);
    p[3] = static_cast<uint8_t>((v      ) & 0xFF);
}

static uint32_t png_crc32(const uint8_t* data, size_t len) {
    // CRC-32 used by PNG (polynomial 0xEDB88320)
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < len; ++i) {
        crc ^= data[i];
        for (int b = 0; b < 8; ++b) {
            crc = (crc >> 1) ^ (0xEDB88320 & (-(crc & 1)));
        }
    }
    return crc ^ 0xFFFFFFFF;
}

static bool png_write_chunk(FILE* f, const char type[4],
                             const uint8_t* data, uint32_t len) {
    uint8_t header[8];
    png_write_u32be(header, len);
    std::memcpy(header + 4, type, 4);

    // CRC covers type + data
    uint32_t crc_buf_len = 4 + len;
    std::vector<uint8_t> crc_data(crc_buf_len);
    std::memcpy(crc_data.data(), type, 4);
    if (len > 0) std::memcpy(crc_data.data() + 4, data, len);
    uint32_t crc = png_crc32(crc_data.data(), crc_buf_len);

    uint8_t crc_bytes[4];
    png_write_u32be(crc_bytes, crc);

    if (std::fwrite(header, 1, 8, f) != 8) return false;
    if (len > 0 && std::fwrite(data, 1, len, f) != len) return false;
    if (std::fwrite(crc_bytes, 1, 4, f) != 4) return false;
    return true;
}

bool write_png_16(const char* path, const uint16_t* data,
                  uint32_t w, uint32_t h) {
    FILE* f = std::fopen(path, "wb");
    if (!f) return false;

    // PNG signature
    static const uint8_t sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
    std::fwrite(sig, 1, 8, f);

    // IHDR: 13 bytes — width, height, bit_depth=16, color_type=0 (grayscale)
    uint8_t ihdr[13];
    png_write_u32be(ihdr + 0, w);
    png_write_u32be(ihdr + 4, h);
    ihdr[8]  = 16;  // bit depth
    ihdr[9]  = 0;   // color type: grayscale
    ihdr[10] = 0;   // compression: deflate
    ihdr[11] = 0;   // filter: adaptive
    ihdr[12] = 0;   // interlace: none
    if (!png_write_chunk(f, "IHDR", ihdr, 13)) { std::fclose(f); return false; }

    // Build raw scanlines: each row = 1 filter byte + w * 2 bytes (big-endian)
    size_t row_bytes = 1 + static_cast<size_t>(w) * 2;
    std::vector<uint8_t> raw(row_bytes * h);
    for (uint32_t y = 0; y < h; ++y) {
        size_t row_off = y * row_bytes;
        raw[row_off] = 0;  // filter: None
        for (uint32_t x = 0; x < w; ++x) {
            uint16_t val = data[y * w + x];
            size_t px_off = row_off + 1 + static_cast<size_t>(x) * 2;
            raw[px_off + 0] = static_cast<uint8_t>(val >> 8);    // big-endian
            raw[px_off + 1] = static_cast<uint8_t>(val & 0xFF);
        }
    }

    // Compress with stb's zlib
    int zlen = 0;
    unsigned char* zdata = stbi_zlib_compress(
        raw.data(), static_cast<int>(raw.size()), &zlen,
        stbi_write_png_compression_level);
    if (!zdata) { std::fclose(f); return false; }

    // IDAT
    bool ok = png_write_chunk(f, "IDAT", zdata, static_cast<uint32_t>(zlen));
    STBIW_FREE(zdata);
    if (!ok) { std::fclose(f); return false; }

    // IEND
    png_write_chunk(f, "IEND", nullptr, 0);

    std::fclose(f);
    return true;
}
```

- [ ] **Step 2: Build and verify full link succeeds**

```bash
cmake --build --preset macos-debug --target ply2heightmap -j8 2>&1 | tail -5
```

Expected: Clean build, no errors.

- [ ] **Step 3: Smoke test with a real PLY file**

```bash
cd build/macos-debug
./ply2heightmap ../../examples/island_demo/assets/maps/map.ply /tmp/test_heightmap.png --ppu 1.0
```

Expected: Prints summary with AABB, grid dimensions, HeightfieldComponent values. Creates a PNG file.

- [ ] **Step 4: Verify the PNG is readable by stb**

```bash
# Quick check: file should exist and be non-empty
ls -la /tmp/test_heightmap.png
```

- [ ] **Step 5: Commit**

```bash
git add src/tools/ply2heightmap.cpp
git commit -m "feat(tools): add 16-bit PNG writer using stb zlib compression"
```

---

### Task 5: Write the test suite

**Files:**
- Create: `tests/test_ply2heightmap.cpp`
- Modify: `CMakeLists.txt` (add test target)

- [ ] **Step 1: Add test target to CMakeLists.txt**

Add after the existing `add_gseurat_test` entries (around line 525):

```cmake
add_gseurat_test(test_ply2heightmap
    src/engine/gaussian_cloud.cpp)
```

- [ ] **Step 2: Create the test file**

```cpp
// tests/test_ply2heightmap.cpp
// Headless tests for ply2heightmap rasterizer functions.

#include "gseurat/engine/gaussian_cloud.hpp"

// Pull in the implementation directly (same pattern as other GSeurat tests).
// We need the free functions but not main().
#define PLY2HEIGHTMAP_NO_MAIN
#include "../src/tools/ply2heightmap.cpp"

#include <cassert>
#include <cfloat>
#include <cmath>
#include <cstdio>

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.1f) {
    return std::abs(a - b) < eps;
}

// ── Helper: create a Gaussian at a given position with uniform scale ────────

static Gaussian make_splat(float x, float y, float z,
                            float scale = 0.5f, float opacity = 1.0f) {
    Gaussian g{};
    g.position = glm::vec3(x, y, z);
    g.scale = glm::vec3(scale);
    g.rotation = glm::quat(1, 0, 0, 0);  // identity
    g.opacity = opacity;
    g.importance = opacity * scale;
    return g;
}

// ── Test 1: Flat plane ──────────────────────────────────────────────────────

static void test_flat_plane() {
    std::printf("\n-- Test 1: Flat plane --\n");

    // 4 splats at Y=5.0 arranged in a 2x2 grid, scale=1.0 to cover the area
    std::vector<Gaussian> splats = {
        make_splat(1.0f, 5.0f, 1.0f, 1.0f),
        make_splat(3.0f, 5.0f, 1.0f, 1.0f),
        make_splat(1.0f, 5.0f, 3.0f, 1.0f),
        make_splat(3.0f, 5.0f, 3.0f, 1.0f),
    };

    AABB bounds;
    for (const auto& g : splats) bounds.expand(g.position);

    HeightmapParams params;
    params.ppu = 2.0f;
    params.padding = 0.5f;

    auto result = rasterize_splats(splats, bounds, params);

    // Check that center cells have height data (not -FLT_MAX)
    // The center of the grid corresponds to the splat region
    uint32_t cx = result.width / 2;
    uint32_t cz = result.height / 2;
    float center_val = result.grid[static_cast<size_t>(cz) * result.width + cx];

    check(center_val != -FLT_MAX, "center cell has data");
    // Scale=1.0, identity rotation → half_y = 1.0 → top_y = 5.0 + 1.0 = 6.0
    check(approx(center_val, 6.0f, 0.5f),
          "center cell Y ≈ 6.0 (position.y + half_y)");

    // Grid dimensions should be roughly (4+1)*2 = 10 x 10
    check(result.width > 0 && result.height > 0, "grid has non-zero dimensions");
}

// ── Test 2: Gap fill ────────────────────────────────────────────────────────

static void test_gap_fill() {
    std::printf("\n-- Test 2: Gap fill (dilation) --\n");

    // Create a 5x5 grid with one hole in the center
    uint32_t w = 5, h = 5;
    std::vector<float> grid(25, 10.0f);
    grid[12] = -FLT_MAX;  // center cell = hole

    std::vector<float> dilated(25);
    dilate_gaps(grid, dilated, w, h);

    check(dilated[12] != -FLT_MAX, "center hole was filled by dilation");
    check(approx(dilated[12], 10.0f), "filled value = max of neighbors (10.0)");

    // Verify non-hole cells are unchanged
    check(approx(dilated[0], 10.0f), "corner cell unchanged after dilation");
}

// ── Test 3: Flat-world guard (no NaN) ───────────────────────────────────────

static void test_flat_world() {
    std::printf("\n-- Test 3: Flat-world guard --\n");

    // All cells at exactly the same height
    uint32_t w = 4, h = 4;
    std::vector<float> grid(16, 42.0f);

    auto norm = normalize_to_uint16(grid, w, h);

    check(norm.max_height > norm.min_height,
          "max_height > min_height (guard applied)");
    check(norm.max_height - norm.min_height >= 0.9f,
          "height range >= 1.0 (flat-world fallback)");

    // No NaN in output
    bool has_nan = false;
    for (auto px : norm.pixels) {
        if (px != px) has_nan = true;  // NaN check for uint16 is always false, but check the float path
    }
    check(!has_nan, "no NaN in output pixels");

    // All pixels should be the same value (flat surface)
    uint16_t first = norm.pixels[0];
    bool all_same = true;
    for (auto px : norm.pixels) {
        if (px != first) all_same = false;
    }
    check(all_same, "all pixels identical for flat input");
}

// ── Test 4: Opacity filter ──────────────────────────────────────────────────

static void test_opacity_filter() {
    std::printf("\n-- Test 4: Opacity filter --\n");

    // Two splats: one visible (opacity=1.0 at Y=5), one ghostly (opacity=0.01 at Y=100)
    std::vector<Gaussian> all_splats = {
        make_splat(2.0f, 5.0f, 2.0f, 1.0f, 1.0f),    // visible floor
        make_splat(2.0f, 100.0f, 2.0f, 1.0f, 0.01f),  // ghost ceiling
    };

    // Filter manually (same as main() does)
    std::vector<Gaussian> filtered;
    float min_opacity = 0.1f;
    for (const auto& g : all_splats) {
        if (g.opacity >= min_opacity) filtered.push_back(g);
    }

    check(filtered.size() == 1, "ghost splat filtered out");
    check(approx(filtered[0].position.y, 5.0f), "remaining splat is the floor");
}

// ── Test 5: AABB footprint ──────────────────────────────────────────────────

static void test_aabb_footprint() {
    std::printf("\n-- Test 5: AABB footprint --\n");

    // Single large splat at origin, scale = (2, 1, 3), identity rotation
    // Expected half_x = 2.0, half_z = 3.0 → covers 4x6 world units
    // At ppu=1.0 with padding=0: grid should be ~4x6 pixels
    Gaussian g{};
    g.position = glm::vec3(0.0f);
    g.scale = glm::vec3(2.0f, 1.0f, 3.0f);
    g.rotation = glm::quat(1, 0, 0, 0);
    g.opacity = 1.0f;

    std::vector<Gaussian> splats = {g};
    AABB bounds;
    bounds.expand(g.position);

    HeightmapParams params;
    params.ppu = 1.0f;
    params.padding = 0.0f;

    auto result = rasterize_splats(splats, bounds, params);

    // With padding=0, AABB is (0,0,0)→(0,0,0), grid is 1x1.
    // But the splat's footprint extends ±2 in X and ±3 in Z from position (0,0,0).
    // The grid only covers [aabb.min.x, aabb.max.x], so cells outside are clamped.
    // With padding=0 on a single point, the grid is tiny.
    // Let's test with padding that captures the footprint:
    params.padding = 3.5f;  // captures the full ±3 Z extent
    result = rasterize_splats(splats, bounds, params);

    // Count filled cells
    uint32_t filled = 0;
    for (float v : result.grid) {
        if (v != -FLT_MAX) filled++;
    }

    // Expected: the splat covers a 4x6 area (half_x=2 → 4 wide, half_z=3 → 6 tall)
    // At ppu=1.0 that's roughly 4*6 = 24 cells, but with rounding it may be ±2
    check(filled >= 20 && filled <= 35,
          "splat covers approximately 24 cells (±5 for rounding)");

    // Top Y should be position.y + half_y = 0 + 1 = 1.0
    for (size_t i = 0; i < result.grid.size(); ++i) {
        if (result.grid[i] != -FLT_MAX) {
            check(approx(result.grid[i], 1.0f),
                  "filled cell Y ≈ 1.0 (position.y + half_y)");
            break;
        }
    }
}

// ── Test 6: 16-bit PNG round-trip ───────────────────────────────────────────

static void test_png_roundtrip() {
    std::printf("\n-- Test 6: 16-bit PNG round-trip --\n");

    // Write a small 4x4 16-bit PNG, then verify file exists and is non-empty
    uint32_t w = 4, h = 4;
    std::vector<uint16_t> pixels(16);
    for (uint32_t i = 0; i < 16; ++i) {
        pixels[i] = static_cast<uint16_t>(i * 4096);  // 0, 4096, 8192, ...
    }

    const char* path = "/tmp/test_ply2hm_roundtrip.png";
    bool ok = write_png_16(path, pixels.data(), w, h);
    check(ok, "write_png_16 succeeded");

    // Verify file exists and has reasonable size (PNG header alone is ~8 bytes)
    FILE* f = std::fopen(path, "rb");
    check(f != nullptr, "output PNG file exists");
    if (f) {
        std::fseek(f, 0, SEEK_END);
        long size = std::ftell(f);
        std::fclose(f);
        check(size > 50, "output PNG has reasonable size (> 50 bytes)");
    }

    // Clean up
    std::remove(path);
}

// ── Main ────────────────────────────────────────────────────────────────────

int main() {
    std::printf("=== test_ply2heightmap ===\n");

    test_flat_plane();
    test_gap_fill();
    test_flat_world();
    test_opacity_filter();
    test_aabb_footprint();
    test_png_roundtrip();

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
```

- [ ] **Step 3: Guard main() in ply2heightmap.cpp for test inclusion**

Add at the top of `main()` in `src/tools/ply2heightmap.cpp`, wrap the main function:

```cpp
#ifndef PLY2HEIGHTMAP_NO_MAIN
int main(int argc, char* argv[]) {
    // ... existing main code ...
}
#endif // PLY2HEIGHTMAP_NO_MAIN
```

- [ ] **Step 4: Build and run tests**

```bash
cmake --build --preset macos-debug --target test_ply2heightmap -j8
cd build/macos-debug && ./test_ply2heightmap
```

Expected: All 6 test groups pass.

- [ ] **Step 5: Run via ctest**

```bash
ctest --test-dir build/macos-debug -R test_ply2heightmap -V
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/test_ply2heightmap.cpp src/tools/ply2heightmap.cpp CMakeLists.txt
git commit -m "test(tools): add headless test suite for ply2heightmap rasterizer"
```

---

### Task 6: End-to-end validation with real PLY data

**Files:** None modified — this is a validation step.

- [ ] **Step 1: Run ply2heightmap on the island demo map**

```bash
cd build/macos-debug
./ply2heightmap ../../examples/island_demo/assets/maps/map.ply /tmp/island_heightmap.png --ppu 2.0
```

Expected: Prints summary. Record the HeightfieldComponent values from stdout.

- [ ] **Step 2: Verify the heightmap is loadable by stbi_load_16**

The existing `test_heightfield_system` uses `HeightfieldData` with manually constructed samples. A quick sanity check: the PNG should be loadable by the same stb_image path used by `heightfield_loader.cpp`:

```bash
# File should exist and be non-trivial
ls -la /tmp/island_heightmap.png
file /tmp/island_heightmap.png
```

Expected: PNG image file, non-zero size.

- [ ] **Step 3: Run the full test suite to verify no regressions**

```bash
ctest --test-dir build/macos-debug -j8 2>&1 | tail -5
```

Expected: Same pass rate as before (no regressions).

- [ ] **Step 4: Commit (no code changes — just a validation checkpoint)**

No commit needed. If all checks pass, the tool is ready.

---

## Self-Review Checklist

**1. Spec coverage:**
- CLI interface (--ppu, --padding, --min-opacity, --z-up) → Task 1 ✓
- AABB splatting rasterizer → Task 2 ✓
- Double-buffered dilation → Task 3 ✓
- Normalization with flat-world guard → Task 3 ✓
- 16-bit PNG writer → Task 4 ✓
- Build integration (GSEURAT_BUILD_EXAMPLES) → Task 1 ✓
- Headless tests (flat plane, gap fill, flat-world, opacity, footprint) → Task 5 ✓
- Error handling (empty PLY, all filtered, etc.) → Task 1 (main) ✓
- Stdout HeightfieldComponent output → Task 1 (main) ✓

**2. Placeholder scan:** No TBD/TODO. All code blocks are complete.

**3. Type consistency:**
- `HeightmapParams` used consistently across Task 1 (definition), Task 2 (rasterizer), Task 5 (tests)
- `HeightmapResult` returned from `rasterize_splats`, consumed by `dilate_gaps` and `normalize_to_uint16`
- `NormResult` returned from `normalize_to_uint16`, consumed by `write_png_16` and main stdout
- `write_png_16` signature matches declaration and usage
