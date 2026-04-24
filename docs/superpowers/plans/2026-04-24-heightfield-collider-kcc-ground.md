# Heightfield Collider & KCC Ground Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify ground detection by adding a HeightfieldComponent that integrates into the existing CollisionSystem BVH, replacing the legacy 2D CollisionGrid elevation lookup.

**Architecture:** A new `HeightfieldComponent` ECS component loads a 16-bit PNG heightmap and registers its AABB into the master BVH alongside existing primitives. New intersection functions (`ray_vs_heightfield`, `capsule_vs_heightfield`, `sweep_capsule_vs_heightfield`) are dispatched by the CollisionSystem's query methods. The KCC requires zero changes — it sweeps against terrain the same way it sweeps against boxes and spheres.

**Tech Stack:** C++23, GLM, stb_image (16-bit), nlohmann/json, Python 3 + Pillow (migration script)

**Spec:** `docs/superpowers/specs/2026-04-24-heightfield-collider-kcc-ground-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `include/gseurat/engine/ecs/components/heightfield_component.hpp` | **New.** `HeightfieldData` (CPU sample grid) + `HeightfieldComponent` (ECS, JSON serialization) |
| `include/gseurat/engine/collision/heightfield_loader.hpp` | **New.** `load_heightfield()` declaration |
| `src/engine/collision/heightfield_loader.cpp` | **New.** 16-bit PNG loading via `stbi_load_16` |
| `include/gseurat/engine/collision/intersect.hpp` | **Modify.** Add heightfield intersection declarations + forward declare `HeightfieldInstance` |
| `src/engine/collision/intersect.cpp` | **Modify.** Implement `sample_height`, `heightfield_normal`, `ray_vs_heightfield`, `capsule_vs_heightfield`, `sweep_capsule_vs_heightfield` |
| `include/gseurat/engine/collision/collision_system.hpp` | **Modify.** Add `HeightfieldInstance`, `heightfield_cache_`, include new header |
| `src/engine/collision/collision_system.cpp` | **Modify.** Scan `HeightfieldComponent` in `rebuild_cache()`, dispatch heightfield in `sweep()`/`raycast()`/`overlap_aabb()` |
| `src/engine/app_base.cpp` | **Modify.** Register `HeightfieldComponent` in component registry |
| `schemas/scene.schema.json` | **Modify.** Add `HeightfieldComponent` definition |
| `src/demo/island_demo_state.cpp` | **Modify.** Remove legacy elevation snapping from `update_player()` |
| `include/gseurat/engine/collision_gen.hpp` | **Modify.** Remove `elevation` vector from `CollisionGrid` |
| `src/engine/collision_gen.cpp` | **Modify.** Remove elevation-related code from `generate_collision_from_gaussians` |
| `scripts/migrate_elevation_to_png.py` | **New.** Offline migration script |
| `tests/test_heightfield_intersect.cpp` | **New.** Unit tests for all heightfield intersection functions |
| `tests/test_heightfield_system.cpp` | **New.** Integration test: heightfield in CollisionSystem + KCC ground probe |
| `CMakeLists.txt` | **Modify.** Add new source files and test registrations |

---

### Task 1: HeightfieldData struct and PNG loader

**Files:**
- Create: `include/gseurat/engine/ecs/components/heightfield_component.hpp`
- Create: `include/gseurat/engine/collision/heightfield_loader.hpp`
- Create: `src/engine/collision/heightfield_loader.cpp`
- Create: `tests/test_heightfield_intersect.cpp`
- Modify: `CMakeLists.txt:209` (add source), `CMakeLists.txt:513` (add test)

- [ ] **Step 1: Write the HeightfieldData struct and HeightfieldComponent**

Create `include/gseurat/engine/ecs/components/heightfield_component.hpp`:

```cpp
#pragma once

#include "gseurat/engine/gaussian_cloud.hpp"  // for AABB

#include <nlohmann/json.hpp>
#include <glm/glm.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace gseurat {

struct HeightfieldData {
    std::vector<uint16_t> samples;   // Row-major height samples
    uint32_t img_width{0};           // Pixel columns
    uint32_t img_height{0};          // Pixel rows
};

struct HeightfieldComponent {
    std::string image_path;              // 16-bit PNG grayscale (relative to assets/)
    float width{100.0f};                 // World-space X extent
    float length{100.0f};                // World-space Z extent
    float min_height{0.0f};              // World Y at pixel value 0
    float max_height{50.0f};             // World Y at pixel value 65535
    uint32_t collision_mask{0xFFFFFFFF};

    // Loaded at runtime (not serialized)
    HeightfieldData data;
    AABB world_aabb;                     // Computed from transform + extents
};

// ── JSON serialization ────────────────────────────────────────────────
inline HeightfieldComponent heightfield_from_json(const nlohmann::json& j) {
    HeightfieldComponent h;
    h.image_path     = j.value("image_path", std::string{});
    h.width          = j.value("width", 100.0f);
    h.length         = j.value("length", 100.0f);
    h.min_height     = j.value("min_height", 0.0f);
    h.max_height     = j.value("max_height", 50.0f);
    h.collision_mask = j.value("collision_mask", 0xFFFFFFFF);
    return h;
}

inline nlohmann::json heightfield_to_json(const HeightfieldComponent& h) {
    return {
        {"image_path",     h.image_path},
        {"width",          h.width},
        {"length",         h.length},
        {"min_height",     h.min_height},
        {"max_height",     h.max_height},
        {"collision_mask", h.collision_mask}
    };
}

}  // namespace gseurat
```

- [ ] **Step 2: Write the heightfield loader header**

Create `include/gseurat/engine/collision/heightfield_loader.hpp`:

```cpp
#pragma once

#include "gseurat/engine/ecs/components/heightfield_component.hpp"

#include <string>

namespace gseurat {

/// Load a 16-bit grayscale PNG into HeightfieldData.
/// Throws std::runtime_error on failure (wrong format, missing file).
HeightfieldData load_heightfield(const std::string& path);

}  // namespace gseurat
```

- [ ] **Step 3: Write the heightfield loader implementation**

Create `src/engine/collision/heightfield_loader.cpp`:

```cpp
#include "gseurat/engine/collision/heightfield_loader.hpp"

#include <stb_image.h>

#include <stdexcept>
#include <string>

namespace gseurat {

HeightfieldData load_heightfield(const std::string& path) {
    int w = 0, h = 0, channels = 0;
    stbi_us* pixels = stbi_load_16(path.c_str(), &w, &h, &channels, 1);

    if (!pixels) {
        throw std::runtime_error(
            "Failed to load heightfield: " + path + " — " + stbi_failure_reason());
    }

    if (w <= 0 || h <= 0) {
        stbi_image_free(pixels);
        throw std::runtime_error(
            "Heightfield has zero dimensions: " + path);
    }

    HeightfieldData data;
    data.img_width  = static_cast<uint32_t>(w);
    data.img_height = static_cast<uint32_t>(h);
    data.samples.assign(pixels, pixels + static_cast<size_t>(w) * h);

    stbi_image_free(pixels);
    return data;
}

}  // namespace gseurat
```

- [ ] **Step 4: Write a basic loader test**

Create `tests/test_heightfield_intersect.cpp` with the initial test harness and loader validation:

```cpp
#include "gseurat/engine/collision/intersect.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"

#include <cstdio>
#include <cmath>
#include <vector>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.01f) {
    return std::abs(a - b) < eps;
}

static bool vec_approx(const glm::vec3& a, const glm::vec3& b, float eps = 0.01f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

// Helper: create a flat heightfield at a given elevation (all samples same value).
// Maps to world: origin=(0,0,0), width=W, length=L, min_height=0, max_height=max_h.
static HeightfieldInstance make_flat_hf(float elevation, float world_w = 10.0f,
                                        float world_l = 10.0f, uint32_t res = 4) {
    float max_h = 50.0f;
    uint16_t sample = static_cast<uint16_t>((elevation / max_h) * 65535.0f);

    HeightfieldData data;
    data.img_width  = res;
    data.img_height = res;
    data.samples.assign(static_cast<size_t>(res) * res, sample);

    HeightfieldInstance hf;
    hf.origin     = glm::vec3(0.0f);
    hf.width      = world_w;
    hf.length     = world_l;
    hf.min_height = 0.0f;
    hf.max_height = max_h;
    hf.collision_mask = 0xFFFFFFFF;
    hf.data       = &data;
    hf.world_aabb.min = glm::vec3(0.0f, 0.0f, 0.0f);
    hf.world_aabb.max = glm::vec3(world_w, max_h, world_l);

    // NOTE: data must outlive hf — store data in caller scope.
    // For tests, we use a wrapper (see make_flat_pair below).
    return hf;
}

// Pair holder so HeightfieldData outlives HeightfieldInstance.
struct HfPair {
    HeightfieldData data;
    HeightfieldInstance inst;
};

static HfPair make_flat_pair(float elevation, float world_w = 10.0f,
                              float world_l = 10.0f, uint32_t res = 4) {
    float max_h = 50.0f;
    uint16_t sample = static_cast<uint16_t>((elevation / max_h) * 65535.0f);

    HfPair p;
    p.data.img_width  = res;
    p.data.img_height = res;
    p.data.samples.assign(static_cast<size_t>(res) * res, sample);

    p.inst.origin     = glm::vec3(0.0f);
    p.inst.width      = world_w;
    p.inst.length     = world_l;
    p.inst.min_height = 0.0f;
    p.inst.max_height = max_h;
    p.inst.collision_mask = 0xFFFFFFFF;
    p.inst.data       = &p.data;
    p.inst.world_aabb.min = glm::vec3(0.0f, 0.0f, 0.0f);
    p.inst.world_aabb.max = glm::vec3(world_w, max_h, world_l);
    return p;
}

// Helper: create a sloped heightfield. Left edge (x=0) at h_low, right edge (x=max) at h_high.
static HfPair make_slope_pair(float h_low, float h_high, float world_w = 10.0f,
                               float world_l = 10.0f, uint32_t res = 4) {
    float max_h = 50.0f;
    HfPair p;
    p.data.img_width  = res;
    p.data.img_height = res;
    p.data.samples.resize(static_cast<size_t>(res) * res);

    for (uint32_t z = 0; z < res; ++z) {
        for (uint32_t x = 0; x < res; ++x) {
            float t = static_cast<float>(x) / static_cast<float>(res - 1);
            float h = h_low + t * (h_high - h_low);
            p.data.samples[z * res + x] =
                static_cast<uint16_t>((h / max_h) * 65535.0f);
        }
    }

    p.inst.origin     = glm::vec3(0.0f);
    p.inst.width      = world_w;
    p.inst.length     = world_l;
    p.inst.min_height = 0.0f;
    p.inst.max_height = max_h;
    p.inst.collision_mask = 0xFFFFFFFF;
    p.inst.data       = &p.data;
    p.inst.world_aabb.min = glm::vec3(0.0f, 0.0f, 0.0f);
    p.inst.world_aabb.max = glm::vec3(world_w, max_h, world_l);
    return p;
}

int main() {
    std::printf("=== test_heightfield_intersect ===\n");

    // Tests will be added in subsequent tasks.

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
```

- [ ] **Step 5: Register new files in CMakeLists.txt**

In `CMakeLists.txt`, add the loader source after line 209 (`src/engine/collision/debug_wireframe.cpp`):

```cmake
    src/engine/collision/heightfield_loader.cpp
```

Add the test after line 513 (`add_gseurat_test(test_collider_json)`):

```cmake
add_gseurat_test(test_heightfield_intersect
    src/engine/collision/intersect.cpp
    src/engine/collision/heightfield_loader.cpp
    src/engine/collision/bvh.cpp)
```

- [ ] **Step 6: Build to verify compilation**

Run: `cmake --build --preset macos-debug --target test_heightfield_intersect 2>&1 | tail -5`

Expected: Build succeeds (test binary runs with 0 passed, 0 failed).

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/engine/ecs/components/heightfield_component.hpp \
        include/gseurat/engine/collision/heightfield_loader.hpp \
        src/engine/collision/heightfield_loader.cpp \
        tests/test_heightfield_intersect.cpp \
        CMakeLists.txt
git commit -m "feat(collision): add HeightfieldComponent struct and PNG loader"
```

---

### Task 2: `sample_height` and `heightfield_normal` core functions

**Files:**
- Modify: `include/gseurat/engine/collision/intersect.hpp`
- Modify: `src/engine/collision/intersect.cpp`
- Modify: `tests/test_heightfield_intersect.cpp`

These are the building blocks used by all three intersection functions.

- [ ] **Step 1: Write failing tests for sample_height and heightfield_normal**

Add to `tests/test_heightfield_intersect.cpp` inside `main()`, before the summary printf:

```cpp
    // ── sample_height tests ──────────────────────────────────────────
    std::printf("\n-- sample_height --\n");

    // Flat plane at elevation 5.0
    {
        auto [data, hf] = make_flat_pair(5.0f);
        auto h = sample_height(hf, 5.0f, 5.0f);  // center of 10x10 field
        check(h.has_value(), "flat: center returns value");
        if (h) check(approx(*h, 5.0f), "flat: center elevation ≈ 5.0");
    }

    // Out of bounds returns nullopt
    {
        auto [data, hf] = make_flat_pair(5.0f);
        check(!sample_height(hf, -1.0f, 5.0f).has_value(), "oob: negative X");
        check(!sample_height(hf, 5.0f, 11.0f).has_value(), "oob: Z > length");
    }

    // Slope: left=0, right=10 over 10 world units. At x=5 expect h≈5.
    {
        auto [data, hf] = make_slope_pair(0.0f, 10.0f);
        auto h = sample_height(hf, 5.0f, 5.0f);
        check(h.has_value(), "slope: midpoint returns value");
        if (h) check(approx(*h, 5.0f, 0.5f), "slope: midpoint elevation ≈ 5.0");
    }

    // ── heightfield_normal tests ─────────────────────────────────────
    std::printf("\n-- heightfield_normal --\n");

    // Flat plane: normal should be (0,1,0)
    {
        auto [data, hf] = make_flat_pair(5.0f, 10.0f, 10.0f, 8);
        auto n = heightfield_normal(hf, 5.0f, 5.0f);
        check(vec_approx(n, glm::vec3(0.0f, 1.0f, 0.0f)), "flat: normal ≈ (0,1,0)");
    }

    // Slope rising in X: normal should tilt in -X direction
    {
        auto [data, hf] = make_slope_pair(0.0f, 10.0f, 10.0f, 10.0f, 16);
        auto n = heightfield_normal(hf, 5.0f, 5.0f);
        check(n.x < -0.1f, "slope: normal has negative X component");
        check(n.y > 0.5f,  "slope: normal has positive Y component");
        check(approx(n.z, 0.0f, 0.1f), "slope: normal Z ≈ 0");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_heightfield_intersect && ./build/macos-debug/test_heightfield_intersect`

Expected: Compilation fails — `sample_height` and `heightfield_normal` not declared.

- [ ] **Step 3: Add HeightfieldInstance and declarations to intersect.hpp**

Add to `include/gseurat/engine/collision/intersect.hpp`, before the closing `}  // namespace gseurat`:

```cpp
// ── Heightfield ──────────────────────────────────────────────────────

struct HeightfieldInstance {
    glm::vec3 origin{0.0f};              // World-space min corner (from Transform)
    float width{100.0f};                 // World X extent
    float length{100.0f};                // World Z extent
    float min_height{0.0f};
    float max_height{50.0f};
    uint32_t collision_mask{0xFFFFFFFF};
    const HeightfieldData* data{nullptr}; // Non-owning pointer
    AABB world_aabb;
};

/// Sample terrain elevation at world (x,z). Returns nullopt if outside bounds.
std::optional<float> sample_height(const HeightfieldInstance& hf,
                                   float world_x, float world_z);

/// Compute surface normal at world (x,z) via central differences.
glm::vec3 heightfield_normal(const HeightfieldInstance& hf,
                             float world_x, float world_z);
```

Also add the forward include at the top of the file (after the existing includes):

```cpp
#include "gseurat/engine/ecs/components/heightfield_component.hpp"
```

- [ ] **Step 4: Implement sample_height and heightfield_normal**

Add to `src/engine/collision/intersect.cpp`:

```cpp
// ── Heightfield helpers ──────────────────────────────────────────────

std::optional<float> sample_height(const HeightfieldInstance& hf,
                                   float world_x, float world_z) {
    if (!hf.data || hf.data->img_width == 0 || hf.data->img_height == 0)
        return std::nullopt;

    float u = (world_x - hf.origin.x) / hf.width;
    float v = (world_z - hf.origin.z) / hf.length;

    if (u < 0.0f || u > 1.0f || v < 0.0f || v > 1.0f)
        return std::nullopt;

    float px = u * static_cast<float>(hf.data->img_width - 1);
    float pz = v * static_cast<float>(hf.data->img_height - 1);

    uint32_t ix = static_cast<uint32_t>(px);
    uint32_t iz = static_cast<uint32_t>(pz);

    // Clamp to valid range
    uint32_t ix1 = std::min(ix + 1, hf.data->img_width - 1);
    uint32_t iz1 = std::min(iz + 1, hf.data->img_height - 1);

    float fx = px - static_cast<float>(ix);
    float fz = pz - static_cast<float>(iz);

    auto sample = [&](uint32_t sx, uint32_t sz) -> float {
        return static_cast<float>(
            hf.data->samples[sz * hf.data->img_width + sx]);
    };

    float s00 = sample(ix,  iz);
    float s10 = sample(ix1, iz);
    float s01 = sample(ix,  iz1);
    float s11 = sample(ix1, iz1);

    // Bilinear interpolation
    float s = (s00 * (1.0f - fx) + s10 * fx) * (1.0f - fz) +
              (s01 * (1.0f - fx) + s11 * fx) * fz;

    return hf.min_height + (s / 65535.0f) * (hf.max_height - hf.min_height);
}

glm::vec3 heightfield_normal(const HeightfieldInstance& hf,
                             float world_x, float world_z) {
    // Half-texel epsilon in world space
    float eps_x = hf.width / static_cast<float>(hf.data->img_width) * 0.5f;
    float eps_z = hf.length / static_cast<float>(hf.data->img_height) * 0.5f;
    float eps = std::min(eps_x, eps_z);

    auto h_left  = sample_height(hf, world_x - eps, world_z);
    auto h_right = sample_height(hf, world_x + eps, world_z);
    auto h_back  = sample_height(hf, world_x, world_z - eps);
    auto h_front = sample_height(hf, world_x, world_z + eps);

    // Fall back to up vector at edges
    float dx = (h_right.value_or(0.0f)) - (h_left.value_or(0.0f));
    float dz = (h_front.value_or(0.0f)) - (h_back.value_or(0.0f));

    glm::vec3 n(-dx, 2.0f * eps, -dz);
    return glm::normalize(n);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cmake --build --preset macos-debug --target test_heightfield_intersect && ./build/macos-debug/test_heightfield_intersect`

Expected: All sample_height and heightfield_normal tests PASS.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/collision/intersect.hpp \
        src/engine/collision/intersect.cpp \
        tests/test_heightfield_intersect.cpp
git commit -m "feat(collision): add sample_height and heightfield_normal functions"
```

---

### Task 3: `ray_vs_heightfield` — DDA grid traversal

**Files:**
- Modify: `include/gseurat/engine/collision/intersect.hpp`
- Modify: `src/engine/collision/intersect.cpp`
- Modify: `tests/test_heightfield_intersect.cpp`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_heightfield_intersect.cpp` inside `main()`:

```cpp
    // ── ray_vs_heightfield tests ─────────────────────────────────────
    std::printf("\n-- ray_vs_heightfield --\n");

    // Ray straight down onto flat plane at elevation 5
    {
        auto [data, hf] = make_flat_pair(5.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(5.0f, 20.0f, 5.0f),   // origin above center
            glm::vec3(0.0f, -1.0f, 0.0f),   // direction down
            hf);
        check(hit.has_value(), "ray_flat: hits terrain");
        if (hit) {
            check(approx(hit->point.y, 5.0f, 0.1f), "ray_flat: hit Y ≈ 5.0");
            check(hit->normal.y > 0.9f, "ray_flat: normal points up");
            check(hit->t > 0.0f, "ray_flat: t > 0");
        }
    }

    // Ray onto 45-degree slope
    {
        auto [data, hf] = make_slope_pair(0.0f, 10.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(5.0f, 20.0f, 5.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            hf);
        check(hit.has_value(), "ray_slope: hits terrain");
        if (hit) {
            check(approx(hit->point.y, 5.0f, 0.5f), "ray_slope: hit Y ≈ 5.0 at midpoint");
        }
    }

    // Ray parallel to terrain (miss)
    {
        auto [data, hf] = make_flat_pair(5.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(5.0f, 10.0f, 5.0f),
            glm::vec3(1.0f, 0.0f, 0.0f),  // horizontal
            hf);
        check(!hit.has_value(), "ray_miss: horizontal ray misses terrain");
    }

    // Ray from below terrain (backface — should NOT hit)
    {
        auto [data, hf] = make_flat_pair(5.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(5.0f, 0.0f, 5.0f),    // below terrain
            glm::vec3(0.0f, 1.0f, 0.0f),     // shooting up
            hf);
        check(!hit.has_value(), "ray_backface: ray from below does not hit");
    }

    // Ray outside heightfield XZ bounds (miss)
    {
        auto [data, hf] = make_flat_pair(5.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(15.0f, 20.0f, 5.0f),  // x=15, outside 0..10
            glm::vec3(0.0f, -1.0f, 0.0f),
            hf);
        check(!hit.has_value(), "ray_oob: ray outside XZ bounds misses");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_heightfield_intersect 2>&1 | tail -5`

Expected: Compile error — `ray_vs_heightfield` not declared.

- [ ] **Step 3: Add declaration to intersect.hpp**

Add after the `heightfield_normal` declaration:

```cpp
/// Ray vs heightfield intersection using DDA grid traversal.
/// Triangles are single-sided (backface culling — rays from below are rejected).
std::optional<RayHit> ray_vs_heightfield(
    const glm::vec3& origin, const glm::vec3& direction,
    const HeightfieldInstance& hf);
```

- [ ] **Step 4: Implement ray_vs_heightfield**

Add to `src/engine/collision/intersect.cpp`:

```cpp
// ── Ray-triangle (Moller-Trumbore) helper ────────────────────────────

static std::optional<RayHit> ray_vs_triangle(
    const glm::vec3& origin, const glm::vec3& dir,
    const glm::vec3& v0, const glm::vec3& v1, const glm::vec3& v2) {
    glm::vec3 e1 = v1 - v0;
    glm::vec3 e2 = v2 - v0;
    glm::vec3 h = glm::cross(dir, e2);
    float a = glm::dot(e1, h);

    // Backface cull: only accept front-face hits (a > 0 means ray faces front)
    if (a < 1e-7f) return std::nullopt;

    float f = 1.0f / a;
    glm::vec3 s = origin - v0;
    float u = f * glm::dot(s, h);
    if (u < 0.0f || u > 1.0f) return std::nullopt;

    glm::vec3 q = glm::cross(s, e1);
    float v = f * glm::dot(dir, q);
    if (v < 0.0f || u + v > 1.0f) return std::nullopt;

    float t = f * glm::dot(e2, q);
    if (t < 1e-6f) return std::nullopt;

    glm::vec3 normal = glm::normalize(glm::cross(e1, e2));
    return RayHit{t, origin + dir * t, normal};
}

// ── ray_vs_heightfield ───────────────────────────────────────────────

std::optional<RayHit> ray_vs_heightfield(
    const glm::vec3& origin, const glm::vec3& direction,
    const HeightfieldInstance& hf) {
    if (!hf.data || hf.data->img_width < 2 || hf.data->img_height < 2)
        return std::nullopt;

    // Early AABB test
    if (!aabb_overlaps(
            AABB{glm::min(origin, origin + direction * 10000.0f),
                 glm::max(origin, origin + direction * 10000.0f)},
            hf.world_aabb)) {
        // Quick reject: ray very far from heightfield
    }

    // Cell dimensions in world space
    uint32_t cols = hf.data->img_width;
    uint32_t rows = hf.data->img_height;
    float cell_w = hf.width / static_cast<float>(cols - 1);
    float cell_h = hf.length / static_cast<float>(rows - 1);

    // Helper: get world-space vertex at grid (ix, iz)
    auto vertex = [&](uint32_t ix, uint32_t iz) -> glm::vec3 {
        float wx = hf.origin.x + static_cast<float>(ix) * cell_w;
        float wz = hf.origin.z + static_cast<float>(iz) * cell_h;
        float s = static_cast<float>(hf.data->samples[iz * cols + ix]);
        float wy = hf.min_height + (s / 65535.0f) * (hf.max_height - hf.min_height);
        return glm::vec3(wx, wy, wz);
    };

    // Clip ray to heightfield XZ bounds to find entry/exit
    float t_min = 0.0f;
    float t_max = 10000.0f;

    // Slab test for X
    if (std::abs(direction.x) > 1e-8f) {
        float inv = 1.0f / direction.x;
        float t1 = (hf.origin.x - origin.x) * inv;
        float t2 = (hf.origin.x + hf.width - origin.x) * inv;
        if (t1 > t2) std::swap(t1, t2);
        t_min = std::max(t_min, t1);
        t_max = std::min(t_max, t2);
    } else {
        if (origin.x < hf.origin.x || origin.x > hf.origin.x + hf.width)
            return std::nullopt;
    }

    // Slab test for Z
    if (std::abs(direction.z) > 1e-8f) {
        float inv = 1.0f / direction.z;
        float t1 = (hf.origin.z - origin.z) * inv;
        float t2 = (hf.origin.z + hf.length - origin.z) * inv;
        if (t1 > t2) std::swap(t1, t2);
        t_min = std::max(t_min, t1);
        t_max = std::min(t_max, t2);
    } else {
        if (origin.z < hf.origin.z || origin.z > hf.origin.z + hf.length)
            return std::nullopt;
    }

    if (t_min > t_max) return std::nullopt;

    // Walk ray through cells using DDA
    glm::vec3 entry = origin + direction * std::max(t_min, 0.0f);

    // Convert entry to grid coords
    float gx = (entry.x - hf.origin.x) / cell_w;
    float gz = (entry.z - hf.origin.z) / cell_h;

    int ix = std::clamp(static_cast<int>(gx), 0, static_cast<int>(cols) - 2);
    int iz = std::clamp(static_cast<int>(gz), 0, static_cast<int>(rows) - 2);

    int step_x = (direction.x >= 0.0f) ? 1 : -1;
    int step_z = (direction.z >= 0.0f) ? 1 : -1;

    int end_x = (step_x > 0) ? static_cast<int>(cols) - 1 : -1;
    int end_z = (step_z > 0) ? static_cast<int>(rows) - 1 : -1;

    // t-distance to next cell boundary in each axis
    auto next_t = [](float pos, float dir, float cell_size, int cell, int step) -> float {
        if (std::abs(dir) < 1e-8f) return 1e30f;
        float boundary = (step > 0) ? (static_cast<float>(cell + 1) * cell_size)
                                     : (static_cast<float>(cell) * cell_size);
        return (boundary - pos) / dir;
    };

    float local_x = entry.x - hf.origin.x;
    float local_z = entry.z - hf.origin.z;

    float t_next_x = next_t(local_x, direction.x, cell_w, ix, step_x);
    float t_next_z = next_t(local_z, direction.z, cell_h, iz, step_z);
    float dt_x = (std::abs(direction.x) > 1e-8f) ? cell_w / std::abs(direction.x) : 1e30f;
    float dt_z = (std::abs(direction.z) > 1e-8f) ? cell_h / std::abs(direction.z) : 1e30f;

    std::optional<RayHit> best;
    int max_steps = static_cast<int>(cols + rows);  // Safety limit

    for (int step = 0; step < max_steps; ++step) {
        if (ix < 0 || ix >= static_cast<int>(cols) - 1 ||
            iz < 0 || iz >= static_cast<int>(rows) - 1)
            break;

        // Generate two triangles for cell (ix, iz)
        glm::vec3 v00 = vertex(static_cast<uint32_t>(ix),     static_cast<uint32_t>(iz));
        glm::vec3 v10 = vertex(static_cast<uint32_t>(ix + 1), static_cast<uint32_t>(iz));
        glm::vec3 v01 = vertex(static_cast<uint32_t>(ix),     static_cast<uint32_t>(iz + 1));
        glm::vec3 v11 = vertex(static_cast<uint32_t>(ix + 1), static_cast<uint32_t>(iz + 1));

        // Split along shorter diagonal
        float diag_a = glm::length(v00 - v11);
        float diag_b = glm::length(v10 - v01);

        auto test_tri = [&](const glm::vec3& a, const glm::vec3& b, const glm::vec3& c) {
            auto hit = ray_vs_triangle(origin, direction, a, b, c);
            if (hit && (!best || hit->t < best->t)) {
                best = hit;
            }
        };

        if (diag_a <= diag_b) {
            test_tri(v00, v10, v11);
            test_tri(v00, v11, v01);
        } else {
            test_tri(v00, v10, v01);
            test_tri(v10, v11, v01);
        }

        // If we found a hit in this cell, we can stop (DDA visits cells front-to-back)
        if (best) return best;

        // Advance to next cell
        if (t_next_x < t_next_z) {
            ix += step_x;
            t_next_x += dt_x;
        } else {
            iz += step_z;
            t_next_z += dt_z;
        }
    }

    return best;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cmake --build --preset macos-debug --target test_heightfield_intersect && ./build/macos-debug/test_heightfield_intersect`

Expected: All ray tests PASS, including backface rejection.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/collision/intersect.hpp \
        src/engine/collision/intersect.cpp \
        tests/test_heightfield_intersect.cpp
git commit -m "feat(collision): add ray_vs_heightfield with DDA grid traversal"
```

---

### Task 4: `capsule_vs_heightfield` overlap test

**Files:**
- Modify: `include/gseurat/engine/collision/intersect.hpp`
- Modify: `src/engine/collision/intersect.cpp`
- Modify: `tests/test_heightfield_intersect.cpp`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_heightfield_intersect.cpp` inside `main()`:

```cpp
    // ── capsule_vs_heightfield tests ─────────────────────────────────
    std::printf("\n-- capsule_vs_heightfield --\n");

    // Capsule resting on flat terrain at elevation 5
    {
        auto [data, hf] = make_flat_pair(5.0f);
        CapsuleData cap{0.3f, 0.5f};
        // Place capsule center at Y=5.0 (bottom hemisphere at Y=4.2, below terrain)
        auto contact = capsule_vs_heightfield(
            glm::vec3(5.0f, 5.0f, 5.0f),
            glm::quat(1, 0, 0, 0), cap, hf);
        check(contact.has_value(), "cap_flat: detects penetration");
        if (contact) {
            check(contact->normal.y > 0.9f, "cap_flat: push-out normal is up");
            check(contact->depth > 0.0f, "cap_flat: positive penetration depth");
        }
    }

    // Capsule well above terrain (no contact)
    {
        auto [data, hf] = make_flat_pair(5.0f);
        CapsuleData cap{0.3f, 0.5f};
        auto contact = capsule_vs_heightfield(
            glm::vec3(5.0f, 20.0f, 5.0f),
            glm::quat(1, 0, 0, 0), cap, hf);
        check(!contact.has_value(), "cap_above: no contact when far above");
    }

    // Capsule on slope — normal should be angled
    {
        auto [data, hf] = make_slope_pair(0.0f, 10.0f, 10.0f, 10.0f, 16);
        CapsuleData cap{0.3f, 0.5f};
        float mid_elev = 5.0f;
        auto contact = capsule_vs_heightfield(
            glm::vec3(5.0f, mid_elev, 5.0f),
            glm::quat(1, 0, 0, 0), cap, hf);
        check(contact.has_value(), "cap_slope: detects contact on slope");
        if (contact) {
            check(contact->normal.y > 0.3f, "cap_slope: normal has upward component");
        }
    }
```

- [ ] **Step 2: Run test to verify it fails**

Expected: Compile error — `capsule_vs_heightfield` not declared.

- [ ] **Step 3: Add declaration to intersect.hpp**

```cpp
/// Capsule overlap test against heightfield terrain.
/// Returns deepest penetrating contact (push-out toward capsule).
std::optional<Contact> capsule_vs_heightfield(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule, const HeightfieldInstance& hf);
```

- [ ] **Step 4: Implement capsule_vs_heightfield**

Add to `src/engine/collision/intersect.cpp`:

```cpp
// ── Capsule-triangle helper ──────────────────────────────────────────

static std::optional<Contact> capsule_vs_triangle(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule,
    const glm::vec3& v0, const glm::vec3& v1, const glm::vec3& v2) {
    // Capsule segment endpoints
    glm::vec3 up = cap_rot * glm::vec3(0, 1, 0);
    glm::vec3 a = cap_pos + up * capsule.half_height;
    glm::vec3 b = cap_pos - up * capsule.half_height;

    // Triangle normal
    glm::vec3 tri_normal = glm::normalize(glm::cross(v1 - v0, v2 - v0));

    // Skip backface triangles (normal pointing away)
    if (tri_normal.y < 0.0f) return std::nullopt;

    // Find closest point on capsule segment to triangle plane
    float dist_a = glm::dot(a - v0, tri_normal);
    float dist_b = glm::dot(b - v0, tri_normal);

    // If both endpoints are on the same side and farther than radius, no contact
    if (dist_a > capsule.radius && dist_b > capsule.radius) return std::nullopt;

    // Project the closer endpoint onto the triangle plane
    float t_seg = 0.5f;
    if (std::abs(dist_a - dist_b) > 1e-6f) {
        t_seg = dist_a / (dist_a - dist_b);
        t_seg = std::clamp(t_seg, 0.0f, 1.0f);
    }
    glm::vec3 closest_on_seg = a + (b - a) * t_seg;

    // Project onto triangle plane
    float dist_to_plane = glm::dot(closest_on_seg - v0, tri_normal);

    if (dist_to_plane > capsule.radius || dist_to_plane < -capsule.radius)
        return std::nullopt;

    // Find closest point on triangle to the projection
    glm::vec3 proj_point = closest_on_seg - tri_normal * dist_to_plane;

    // Clamp projection to triangle (barycentric)
    // Simplified: use closest point on edges if outside
    auto closest_on_edge = [](const glm::vec3& p,
                              const glm::vec3& e0, const glm::vec3& e1) -> glm::vec3 {
        glm::vec3 edge = e1 - e0;
        float t = glm::dot(p - e0, edge) / glm::dot(edge, edge);
        t = std::clamp(t, 0.0f, 1.0f);
        return e0 + edge * t;
    };

    // Check if point is inside triangle using cross products
    glm::vec3 c0 = glm::cross(v1 - v0, proj_point - v0);
    glm::vec3 c1 = glm::cross(v2 - v1, proj_point - v1);
    glm::vec3 c2 = glm::cross(v0 - v2, proj_point - v2);

    bool inside = (glm::dot(c0, tri_normal) >= 0.0f &&
                   glm::dot(c1, tri_normal) >= 0.0f &&
                   glm::dot(c2, tri_normal) >= 0.0f);

    glm::vec3 closest_on_tri;
    if (inside) {
        closest_on_tri = proj_point;
    } else {
        // Find closest point on any edge
        glm::vec3 p0 = closest_on_edge(proj_point, v0, v1);
        glm::vec3 p1 = closest_on_edge(proj_point, v1, v2);
        glm::vec3 p2 = closest_on_edge(proj_point, v2, v0);

        float d0 = glm::length2(proj_point - p0);
        float d1 = glm::length2(proj_point - p1);
        float d2 = glm::length2(proj_point - p2);

        if (d0 <= d1 && d0 <= d2) closest_on_tri = p0;
        else if (d1 <= d2) closest_on_tri = p1;
        else closest_on_tri = p2;
    }

    // Re-find closest point on capsule segment to the triangle point
    glm::vec3 seg_dir = b - a;
    float seg_len2 = glm::dot(seg_dir, seg_dir);
    float t_closest = 0.0f;
    if (seg_len2 > 1e-8f) {
        t_closest = glm::dot(closest_on_tri - a, seg_dir) / seg_len2;
        t_closest = std::clamp(t_closest, 0.0f, 1.0f);
    }
    glm::vec3 closest_on_cap = a + seg_dir * t_closest;

    glm::vec3 delta = closest_on_cap - closest_on_tri;
    float dist2 = glm::dot(delta, delta);
    float r2 = capsule.radius * capsule.radius;

    if (dist2 > r2) return std::nullopt;

    float dist = std::sqrt(dist2);
    float depth = capsule.radius - dist;

    glm::vec3 normal = (dist > 1e-6f) ? delta / dist : tri_normal;

    return Contact{closest_on_tri, normal, depth};
}

// ── capsule_vs_heightfield ───────────────────────────────────────────

std::optional<Contact> capsule_vs_heightfield(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule, const HeightfieldInstance& hf) {
    if (!hf.data || hf.data->img_width < 2 || hf.data->img_height < 2)
        return std::nullopt;

    uint32_t cols = hf.data->img_width;
    uint32_t rows = hf.data->img_height;
    float cell_w = hf.width / static_cast<float>(cols - 1);
    float cell_h = hf.length / static_cast<float>(rows - 1);

    // Capsule footprint: segment endpoints + radius expansion
    glm::vec3 up = cap_rot * glm::vec3(0, 1, 0);
    glm::vec3 seg_a = cap_pos + up * capsule.half_height;
    glm::vec3 seg_b = cap_pos - up * capsule.half_height;

    AABB cap_aabb;
    cap_aabb.expand(seg_a + glm::vec3(capsule.radius));
    cap_aabb.expand(seg_a - glm::vec3(capsule.radius));
    cap_aabb.expand(seg_b + glm::vec3(capsule.radius));
    cap_aabb.expand(seg_b - glm::vec3(capsule.radius));

    // Map XZ footprint to grid cell range
    int min_cx = static_cast<int>((cap_aabb.min.x - hf.origin.x) / cell_w);
    int min_cz = static_cast<int>((cap_aabb.min.z - hf.origin.z) / cell_h);
    int max_cx = static_cast<int>((cap_aabb.max.x - hf.origin.x) / cell_w);
    int max_cz = static_cast<int>((cap_aabb.max.z - hf.origin.z) / cell_h);

    min_cx = std::clamp(min_cx, 0, static_cast<int>(cols) - 2);
    min_cz = std::clamp(min_cz, 0, static_cast<int>(rows) - 2);
    max_cx = std::clamp(max_cx, 0, static_cast<int>(cols) - 2);
    max_cz = std::clamp(max_cz, 0, static_cast<int>(rows) - 2);

    auto vertex = [&](uint32_t ix, uint32_t iz) -> glm::vec3 {
        float wx = hf.origin.x + static_cast<float>(ix) * cell_w;
        float wz = hf.origin.z + static_cast<float>(iz) * cell_h;
        float s = static_cast<float>(hf.data->samples[iz * cols + ix]);
        float wy = hf.min_height + (s / 65535.0f) * (hf.max_height - hf.min_height);
        return glm::vec3(wx, wy, wz);
    };

    std::optional<Contact> deepest;

    for (int cz = min_cz; cz <= max_cz; ++cz) {
        for (int cx = min_cx; cx <= max_cx; ++cx) {
            glm::vec3 v00 = vertex(cx, cz);
            glm::vec3 v10 = vertex(cx + 1, cz);
            glm::vec3 v01 = vertex(cx, cz + 1);
            glm::vec3 v11 = vertex(cx + 1, cz + 1);

            // Split along shorter diagonal
            float diag_a = glm::length(v00 - v11);
            float diag_b = glm::length(v10 - v01);

            auto test = [&](const glm::vec3& a, const glm::vec3& b, const glm::vec3& c) {
                auto contact = capsule_vs_triangle(cap_pos, cap_rot, capsule, a, b, c);
                if (contact && (!deepest || contact->depth > deepest->depth)) {
                    deepest = contact;
                }
            };

            if (diag_a <= diag_b) {
                test(v00, v10, v11);
                test(v00, v11, v01);
            } else {
                test(v00, v10, v01);
                test(v10, v11, v01);
            }
        }
    }

    return deepest;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cmake --build --preset macos-debug --target test_heightfield_intersect && ./build/macos-debug/test_heightfield_intersect`

Expected: All capsule overlap tests PASS.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/collision/intersect.hpp \
        src/engine/collision/intersect.cpp \
        tests/test_heightfield_intersect.cpp
git commit -m "feat(collision): add capsule_vs_heightfield overlap with triangle decomposition"
```

---

### Task 5: `sweep_capsule_vs_heightfield` — analytic triangle gathering

**Files:**
- Modify: `include/gseurat/engine/collision/intersect.hpp`
- Modify: `src/engine/collision/intersect.cpp`
- Modify: `tests/test_heightfield_intersect.cpp`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_heightfield_intersect.cpp` inside `main()`:

```cpp
    // ── sweep_capsule_vs_heightfield tests ───────────────────────────
    std::printf("\n-- sweep_capsule_vs_heightfield --\n");

    // Sweep down onto flat terrain
    {
        auto [data, hf] = make_flat_pair(5.0f);
        CapsuleData cap{0.3f, 0.5f};
        // Start at Y=10, sweep down 10 units. Bottom hemisphere at Y=9.2.
        // Should hit terrain at Y=5.0 when bottom reaches 5.0.
        auto hit = sweep_capsule_vs_heightfield(
            glm::vec3(5.0f, 10.0f, 5.0f),
            glm::quat(1, 0, 0, 0), cap,
            glm::vec3(0.0f, -1.0f, 0.0f), 10.0f,
            hf);
        check(hit.has_value(), "sweep_down_flat: hits terrain");
        if (hit) {
            check(hit->t > 0.0f && hit->t < 1.0f, "sweep_down_flat: valid t fraction");
            check(hit->normal.y > 0.9f, "sweep_down_flat: normal points up");
        }
    }

    // Sweep horizontally across flat terrain (capsule above — no hit)
    {
        auto [data, hf] = make_flat_pair(5.0f);
        CapsuleData cap{0.3f, 0.5f};
        auto hit = sweep_capsule_vs_heightfield(
            glm::vec3(0.0f, 10.0f, 5.0f),
            glm::quat(1, 0, 0, 0), cap,
            glm::vec3(1.0f, 0.0f, 0.0f), 10.0f,
            hf);
        check(!hit.has_value(), "sweep_horiz_above: no hit when above terrain");
    }

    // Sweep horizontally onto a ramp (slope rising in X)
    {
        auto [data, hf] = make_slope_pair(0.0f, 10.0f, 10.0f, 10.0f, 16);
        CapsuleData cap{0.3f, 0.5f};
        // Start at x=0, y=1.0 (just above low end), sweep right
        auto hit = sweep_capsule_vs_heightfield(
            glm::vec3(0.0f, 1.0f, 5.0f),
            glm::quat(1, 0, 0, 0), cap,
            glm::vec3(1.0f, 0.0f, 0.0f), 10.0f,
            hf);
        check(hit.has_value(), "sweep_onto_ramp: hits rising terrain");
        if (hit) {
            check(hit->t > 0.0f && hit->t < 1.0f, "sweep_onto_ramp: valid t");
        }
    }

    // Sweep completely outside heightfield XZ bounds (miss)
    {
        auto [data, hf] = make_flat_pair(5.0f);
        CapsuleData cap{0.3f, 0.5f};
        auto hit = sweep_capsule_vs_heightfield(
            glm::vec3(20.0f, 10.0f, 20.0f),
            glm::quat(1, 0, 0, 0), cap,
            glm::vec3(0.0f, -1.0f, 0.0f), 10.0f,
            hf);
        check(!hit.has_value(), "sweep_oob: miss when outside heightfield");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Expected: Compile error — `sweep_capsule_vs_heightfield` not declared.

- [ ] **Step 3: Add declaration to intersect.hpp**

```cpp
/// Capsule sweep against heightfield using analytic triangle gathering.
/// Computes swept AABB, gathers affected cells, tests capsule-vs-triangle for exact TOI.
std::optional<SweepHit> sweep_capsule_vs_heightfield(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const HeightfieldInstance& hf);
```

- [ ] **Step 4: Implement sweep_capsule_vs_heightfield**

Add to `src/engine/collision/intersect.cpp`:

```cpp
// ── Sweep capsule vs single triangle (analytic TOI) ──────────────────

static std::optional<SweepHit> sweep_capsule_vs_triangle(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const glm::vec3& v0, const glm::vec3& v1, const glm::vec3& v2) {
    // Binary refine approach: test capsule at discrete positions along sweep,
    // then binary search for exact contact.
    // This is simpler than full analytic capsule-triangle sweep and sufficient
    // for per-cell granularity (cells are small, movement per-frame is 1-4 cells).

    constexpr int kSteps = 8;
    constexpr int kBinaryIters = 8;

    float step_size = 1.0f / static_cast<float>(kSteps);

    float prev_t = 0.0f;
    bool prev_contact = false;

    // Check if already penetrating at t=0
    {
        auto c = capsule_vs_triangle(cap_pos, cap_rot, capsule, v0, v1, v2);
        if (c) {
            return SweepHit{0.0f, c->point, c->normal};
        }
    }

    for (int i = 1; i <= kSteps; ++i) {
        float t = step_size * static_cast<float>(i);
        glm::vec3 test_pos = cap_pos + direction * (t * max_distance);

        auto c = capsule_vs_triangle(test_pos, cap_rot, capsule, v0, v1, v2);
        if (c) {
            // Binary search between prev_t and t
            float lo = prev_t;
            float hi = t;
            for (int b = 0; b < kBinaryIters; ++b) {
                float mid = (lo + hi) * 0.5f;
                glm::vec3 mid_pos = cap_pos + direction * (mid * max_distance);
                auto mid_c = capsule_vs_triangle(mid_pos, cap_rot, capsule, v0, v1, v2);
                if (mid_c) {
                    hi = mid;
                    c = mid_c;  // Update contact info
                } else {
                    lo = mid;
                }
            }
            return SweepHit{hi, c->point, c->normal};
        }
        prev_t = t;
    }

    return std::nullopt;
}

// ── sweep_capsule_vs_heightfield ─────────────────────────────────────

std::optional<SweepHit> sweep_capsule_vs_heightfield(
    const glm::vec3& cap_pos, const glm::quat& cap_rot,
    const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const HeightfieldInstance& hf) {
    if (!hf.data || hf.data->img_width < 2 || hf.data->img_height < 2)
        return std::nullopt;
    if (max_distance <= 0.0f) return std::nullopt;

    uint32_t cols = hf.data->img_width;
    uint32_t rows = hf.data->img_height;
    float cell_w = hf.width / static_cast<float>(cols - 1);
    float cell_h = hf.length / static_cast<float>(rows - 1);

    // Compute swept AABB of capsule over full movement
    glm::vec3 up = cap_rot * glm::vec3(0, 1, 0);
    glm::vec3 seg_a_start = cap_pos + up * capsule.half_height;
    glm::vec3 seg_b_start = cap_pos - up * capsule.half_height;
    glm::vec3 end_pos = cap_pos + direction * max_distance;
    glm::vec3 seg_a_end = end_pos + up * capsule.half_height;
    glm::vec3 seg_b_end = end_pos - up * capsule.half_height;

    AABB swept;
    swept.expand(seg_a_start + glm::vec3(capsule.radius));
    swept.expand(seg_a_start - glm::vec3(capsule.radius));
    swept.expand(seg_b_start + glm::vec3(capsule.radius));
    swept.expand(seg_b_start - glm::vec3(capsule.radius));
    swept.expand(seg_a_end + glm::vec3(capsule.radius));
    swept.expand(seg_a_end - glm::vec3(capsule.radius));
    swept.expand(seg_b_end + glm::vec3(capsule.radius));
    swept.expand(seg_b_end - glm::vec3(capsule.radius));

    // Early reject: swept AABB vs heightfield AABB
    if (!aabb_overlaps(swept, hf.world_aabb))
        return std::nullopt;

    // Map XZ footprint to cell range
    int min_cx = static_cast<int>((swept.min.x - hf.origin.x) / cell_w);
    int min_cz = static_cast<int>((swept.min.z - hf.origin.z) / cell_h);
    int max_cx = static_cast<int>((swept.max.x - hf.origin.x) / cell_w);
    int max_cz = static_cast<int>((swept.max.z - hf.origin.z) / cell_h);

    min_cx = std::clamp(min_cx, 0, static_cast<int>(cols) - 2);
    min_cz = std::clamp(min_cz, 0, static_cast<int>(rows) - 2);
    max_cx = std::clamp(max_cx, 0, static_cast<int>(cols) - 2);
    max_cz = std::clamp(max_cz, 0, static_cast<int>(rows) - 2);

    auto vertex = [&](uint32_t ix, uint32_t iz) -> glm::vec3 {
        float wx = hf.origin.x + static_cast<float>(ix) * cell_w;
        float wz = hf.origin.z + static_cast<float>(iz) * cell_h;
        float s = static_cast<float>(hf.data->samples[iz * cols + ix]);
        float wy = hf.min_height + (s / 65535.0f) * (hf.max_height - hf.min_height);
        return glm::vec3(wx, wy, wz);
    };

    std::optional<SweepHit> earliest;

    for (int cz = min_cz; cz <= max_cz; ++cz) {
        for (int cx = min_cx; cx <= max_cx; ++cx) {
            glm::vec3 v00 = vertex(cx, cz);
            glm::vec3 v10 = vertex(cx + 1, cz);
            glm::vec3 v01 = vertex(cx, cz + 1);
            glm::vec3 v11 = vertex(cx + 1, cz + 1);

            float diag_a = glm::length(v00 - v11);
            float diag_b = glm::length(v10 - v01);

            auto test = [&](const glm::vec3& a, const glm::vec3& b, const glm::vec3& c) {
                auto hit = sweep_capsule_vs_triangle(
                    cap_pos, cap_rot, capsule, direction, max_distance,
                    a, b, c);
                if (hit && (!earliest || hit->t < earliest->t)) {
                    earliest = hit;
                }
            };

            if (diag_a <= diag_b) {
                test(v00, v10, v11);
                test(v00, v11, v01);
            } else {
                test(v00, v10, v01);
                test(v10, v11, v01);
            }
        }
    }

    return earliest;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cmake --build --preset macos-debug --target test_heightfield_intersect && ./build/macos-debug/test_heightfield_intersect`

Expected: All sweep tests PASS.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/collision/intersect.hpp \
        src/engine/collision/intersect.cpp \
        tests/test_heightfield_intersect.cpp
git commit -m "feat(collision): add sweep_capsule_vs_heightfield with analytic triangle gathering"
```

---

### Task 6: CollisionSystem heightfield integration

**Files:**
- Modify: `include/gseurat/engine/collision/collision_system.hpp`
- Modify: `src/engine/collision/collision_system.cpp`
- Create: `tests/test_heightfield_system.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Write failing test — heightfield in CollisionSystem**

Create `tests/test_heightfield_system.cpp`:

```cpp
#include "gseurat/engine/collision/collision_system.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"

#include <cstdio>
#include <cmath>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.1f) {
    return std::abs(a - b) < eps;
}

int main() {
    std::printf("=== test_heightfield_system ===\n");

    // Set up ECS world with a flat heightfield entity
    ecs::World world;

    // Create heightfield entity
    auto terrain_entity = world.create();
    auto& transform = world.emplace<ecs::Transform>(terrain_entity);
    transform.position = coord::WorldPos(glm::vec3(0.0f));

    auto& hf = world.emplace<HeightfieldComponent>(terrain_entity);
    hf.image_path = "test";
    hf.width = 20.0f;
    hf.length = 20.0f;
    hf.min_height = 0.0f;
    hf.max_height = 50.0f;
    hf.collision_mask = 0xFFFFFFFF;
    // Fill with flat elevation at 5.0
    hf.data.img_width = 8;
    hf.data.img_height = 8;
    uint16_t flat_sample = static_cast<uint16_t>((5.0f / 50.0f) * 65535.0f);
    hf.data.samples.assign(64, flat_sample);
    // Compute AABB
    hf.world_aabb.min = glm::vec3(0.0f, 0.0f, 0.0f);
    hf.world_aabb.max = glm::vec3(20.0f, 50.0f, 20.0f);

    CollisionSystem cs;
    cs.rebuild_cache(world);

    // Test 1: Raycast down onto heightfield
    {
        auto hit = cs.raycast(
            glm::vec3(10.0f, 20.0f, 10.0f),  // above center
            glm::vec3(0.0f, -1.0f, 0.0f),
            100.0f, 0xFFFFFFFF);
        check(hit.has_value(), "raycast: hits heightfield");
        if (hit) {
            check(approx(hit->point.y, 5.0f), "raycast: hit Y ≈ 5.0");
        }
    }

    // Test 2: Sweep capsule down onto heightfield
    {
        CapsuleData cap{0.3f, 0.5f};
        auto result = cs.sweep(
            glm::vec3(10.0f, 15.0f, 10.0f),
            glm::quat(1, 0, 0, 0), cap,
            glm::vec3(0.0f, -1.0f, 0.0f), 15.0f,
            0xFFFFFFFF);
        check(result.has_value(), "sweep: hits heightfield");
        if (result) {
            check(result->hit.normal.y > 0.9f, "sweep: normal points up");
        }
    }

    // Test 3: Raycast miss (outside heightfield)
    {
        auto hit = cs.raycast(
            glm::vec3(30.0f, 20.0f, 10.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            100.0f, 0xFFFFFFFF);
        check(!hit.has_value(), "raycast_miss: outside heightfield XZ");
    }

    // Test 4: Heightfield + box primitive — sweep hits closest
    {
        auto box_entity = world.create();
        auto& box_t = world.emplace<ecs::Transform>(box_entity);
        box_t.position = coord::WorldPos(glm::vec3(10.0f, 8.0f, 10.0f));
        auto& box_c = world.emplace<ColliderComponent>(box_entity);
        box_c.shape = BoxData{glm::vec3(2.0f, 0.5f, 2.0f)};

        cs.mark_dirty();
        cs.rebuild_cache(world);

        CapsuleData cap{0.3f, 0.5f};
        auto result = cs.sweep(
            glm::vec3(10.0f, 15.0f, 10.0f),
            glm::quat(1, 0, 0, 0), cap,
            glm::vec3(0.0f, -1.0f, 0.0f), 15.0f,
            0xFFFFFFFF);
        check(result.has_value(), "mixed: sweep hits something");
        if (result) {
            // Should hit box first (at Y=8.5) before terrain (at Y=5)
            check(result->hit.point.y > 7.0f, "mixed: hits box before terrain");
        }
    }

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
```

- [ ] **Step 2: Add test to CMakeLists.txt**

After the `test_heightfield_intersect` entry:

```cmake
add_gseurat_test(test_heightfield_system
    src/engine/collision/collision_system.cpp
    src/engine/collision/intersect.cpp
    src/engine/collision/heightfield_loader.cpp
    src/engine/collision/bvh.cpp)
```

- [ ] **Step 3: Run test to verify it fails**

Expected: Compile error — `CollisionSystem::rebuild_cache` doesn't scan `HeightfieldComponent`.

- [ ] **Step 4: Add HeightfieldInstance to collision_system.hpp**

Add include at the top (after existing includes):

```cpp
#include "gseurat/engine/ecs/components/heightfield_component.hpp"
```

Add to the `CollisionSystem` class, in the public accessors section (after `is_dirty()`):

```cpp
    const std::vector<HeightfieldInstance>& heightfield_cache() const { return heightfield_cache_; }
```

Add to the private section (after `dirty_`):

```cpp
    std::vector<HeightfieldInstance> heightfield_cache_;
```

- [ ] **Step 5: Modify rebuild_cache to scan HeightfieldComponent**

In `src/engine/collision/collision_system.cpp`, in `rebuild_cache()`, add after the existing `world.view<...>().each(...)` block (before `rebuild_bvh()`):

```cpp
    // Scan heightfield entities
    heightfield_cache_.clear();
    world.view<ecs::Transform, HeightfieldComponent>().each(
        [&](ecs::Entity entity, ecs::Transform& transform,
            HeightfieldComponent& hfc) {
            if (hfc.data.img_width == 0 || hfc.data.img_height == 0) return;

            HeightfieldInstance inst;
            inst.origin        = transform.position.vec();
            inst.width         = hfc.width;
            inst.length        = hfc.length;
            inst.min_height    = hfc.min_height;
            inst.max_height    = hfc.max_height;
            inst.collision_mask = hfc.collision_mask;
            inst.data          = &hfc.data;

            // Compute world AABB
            inst.world_aabb.min = inst.origin +
                glm::vec3(0.0f, inst.min_height, 0.0f);
            inst.world_aabb.max = inst.origin +
                glm::vec3(inst.width, inst.max_height, inst.length);

            hfc.world_aabb = inst.world_aabb;
            heightfield_cache_.push_back(inst);
        });
```

- [ ] **Step 6: Modify rebuild_bvh to include heightfield AABBs**

In `rebuild_bvh()`, replace the existing body with:

```cpp
void CollisionSystem::rebuild_bvh() {
    bvh_aabbs_.clear();
    bvh_indices_.clear();

    size_t total = static_cast<size_t>(static_cache_.size()) + heightfield_cache_.size();
    bvh_aabbs_.reserve(total);
    bvh_indices_.resize(total);

    for (size_t i = 0; i < static_cache_.size(); ++i) {
        bvh_aabbs_.push_back(static_cache_[i].world_aabb);
    }
    for (size_t i = 0; i < heightfield_cache_.size(); ++i) {
        bvh_aabbs_.push_back(heightfield_cache_[i].world_aabb);
    }

    std::iota(bvh_indices_.begin(), bvh_indices_.end(), 0u);
    bvh_.build(bvh_aabbs_, bvh_indices_);
}
```

- [ ] **Step 7: Modify sweep() to dispatch heightfield candidates**

In `sweep()`, replace the narrow-phase loop (starting at `for (uint32_t idx : candidates)`) with:

```cpp
    // Narrow phase: find closest non-trigger hit
    std::optional<SweepResult> best;

    uint32_t hf_base = static_count + static_cast<uint32_t>(dynamic_cache_.size());

    for (uint32_t idx : candidates) {
        if (idx < static_count) {
            // Primitive collider
            const auto& inst = static_cache_[idx];
            if ((inst.collision_mask & mask) == 0) continue;
            if (inst.is_trigger) continue;

            auto hit = sweep_capsule(pos, rot, capsule, dir_norm, max_distance,
                                     inst.shape, inst.world_position,
                                     inst.world_rotation);
            if (hit && (!best || hit->t < best->hit.t)) {
                best = SweepResult{*hit, inst.entity, inst.is_trigger};
            }
        } else if (idx < static_count + static_cast<uint32_t>(heightfield_cache_.size())) {
            // Heightfield
            uint32_t hf_idx = idx - static_count;
            const auto& hf = heightfield_cache_[hf_idx];
            if ((hf.collision_mask & mask) == 0) continue;

            auto hit = sweep_capsule_vs_heightfield(
                pos, rot, capsule, dir_norm, max_distance, hf);
            if (hit && (!best || hit->t < best->hit.t)) {
                best = SweepResult{*hit, hf.entity, false};
            }
        }
        // else: dynamic (handled below)
    }

    // Dynamic colliders (linear scan, unchanged)
    for (uint32_t i = 0; i < static_cast<uint32_t>(dynamic_cache_.size()); ++i) {
        const auto& d = dynamic_cache_[i];
        if ((d.collision_mask & mask) == 0) continue;
        if (d.is_trigger) continue;
        if (!aabb_overlaps(swept_aabb, d.world_aabb)) continue;

        auto hit = sweep_capsule(pos, rot, capsule, dir_norm, max_distance,
                                 d.shape, d.world_position, d.world_rotation);
        if (hit && (!best || hit->t < best->hit.t)) {
            best = SweepResult{*hit, d.entity, d.is_trigger};
        }
    }

    return best;
```

Also update the dynamic candidate collection earlier in `sweep()` — remove the dynamic-into-candidates section and handle dynamics separately (as shown above). The existing code that pushes dynamic indices into `candidates` can be removed since we now linear-scan dynamics after the BVH loop.

- [ ] **Step 8: Modify raycast() to dispatch heightfield candidates**

In `raycast()`, after the static BVH loop, add heightfield dispatch:

```cpp
    // Heightfield candidates from BVH
    uint32_t static_count_rc = static_cast<uint32_t>(static_cache_.size());
    for (uint32_t idx : candidates) {
        if (idx < static_count_rc) {
            const auto& inst = static_cache_[idx];
            if ((inst.collision_mask & mask) == 0) continue;

            auto hit = ray_intersect(origin, dir_norm, inst.shape,
                                     inst.world_position, inst.world_rotation);
            if (!hit) continue;
            if (hit->t > max_dist) continue;
            if (!best || hit->t < best->t) best = *hit;
        } else {
            uint32_t hf_idx = idx - static_count_rc;
            if (hf_idx >= heightfield_cache_.size()) continue;
            const auto& hf = heightfield_cache_[hf_idx];
            if ((hf.collision_mask & mask) == 0) continue;

            auto hit = ray_vs_heightfield(origin, dir_norm, hf);
            if (!hit) continue;
            if (hit->t > max_dist) continue;
            if (!best || hit->t < best->t) best = *hit;
        }
    }
```

Replace the existing static candidate loop with this combined one.

- [ ] **Step 9: Run tests to verify they pass**

Run: `cmake --build --preset macos-debug --target test_heightfield_system && ./build/macos-debug/test_heightfield_system`

Expected: All system integration tests PASS.

Also run existing tests to verify no regressions:

Run: `cmake --build --preset macos-debug --target test_collision_system test_kcc test_intersect && ctest --preset macos-debug -R "test_(collision_system|kcc|intersect)" --output-on-failure`

Expected: All existing tests PASS.

- [ ] **Step 10: Commit**

```bash
git add include/gseurat/engine/collision/collision_system.hpp \
        src/engine/collision/collision_system.cpp \
        tests/test_heightfield_system.cpp \
        CMakeLists.txt
git commit -m "feat(collision): integrate heightfield into CollisionSystem BVH and query dispatch"
```

---

### Task 7: Component registration and scene loading

**Files:**
- Modify: `src/engine/app_base.cpp`
- Modify: `schemas/scene.schema.json`

- [ ] **Step 1: Register HeightfieldComponent in component registry**

In `src/engine/app_base.cpp`, add include at the top (near other component includes):

```cpp
#include "gseurat/engine/ecs/components/heightfield_component.hpp"
#include "gseurat/engine/collision/heightfield_loader.hpp"
```

After the `NavZoneVolume` registration (around line 596), add:

```cpp
    component_registry_.register_component<HeightfieldComponent>("HeightfieldComponent",
        [this](const nlohmann::json& j) -> HeightfieldComponent {
            auto hf = heightfield_from_json(j);
            // Load heightmap data from PNG
            if (!hf.image_path.empty()) {
                try {
                    hf.data = load_heightfield(hf.image_path);
                } catch (const std::exception& e) {
                    std::fprintf(stderr, "[Heightfield] Failed to load %s: %s\n",
                                 hf.image_path.c_str(), e.what());
                }
            }
            return hf;
        },
        [](const HeightfieldComponent& h) -> nlohmann::json {
            return heightfield_to_json(h);
        });
```

- [ ] **Step 2: Add HeightfieldComponent to scene schema**

In `schemas/scene.schema.json`, add after the `KinematicBody` schema definition:

```json
"HeightfieldComponent": {
  "type": "object",
  "required": ["image_path", "width", "length", "min_height", "max_height"],
  "properties": {
    "image_path":     { "type": "string" },
    "width":          { "type": "number", "exclusiveMinimum": 0 },
    "length":         { "type": "number", "exclusiveMinimum": 0 },
    "min_height":     { "type": "number" },
    "max_height":     { "type": "number" },
    "collision_mask": { "type": "integer", "default": 4294967295 }
  }
}
```

- [ ] **Step 3: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`

Expected: Full build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/engine/app_base.cpp schemas/scene.schema.json
git commit -m "feat(collision): register HeightfieldComponent and add scene schema"
```

---

### Task 8: Remove legacy elevation snapping from island demo

**Files:**
- Modify: `src/demo/island_demo_state.cpp`
- Modify: `include/gseurat/engine/collision_gen.hpp`
- Modify: `src/engine/collision_gen.cpp`

- [ ] **Step 1: Remove elevation snapping in update_player()**

In `src/demo/island_demo_state.cpp`, the legacy grid path (lines 1087-1128) contains the elevation snapping code. This block is inside the `} else {` branch that runs when the player does NOT have a `KinematicBody`. Once the player entity has a `HeightfieldComponent`-equipped terrain in the scene, the KCC path (lines 1065-1086) handles ground detection via sweep.

Delete the elevation reading from the legacy path. Replace lines 1092-1128 (the `// Snap Y to collision grid elevation` block) with a comment:

```cpp
        // Ground detection handled by CollisionSystem sweep (heightfield + primitives).
        // Legacy solid-cell blocking remains for nav-zone walkability until
        // solid cells are fully migrated to ColliderComponent boxes.
```

Keep the solid-cell blocking logic if `solid` array still exists in the grid — the legacy path may still be needed for scenes without `KinematicBody` on the player. The key change is removing the `get_elevation()` Y-snap.

- [ ] **Step 2: Remove elevation vector from CollisionGrid**

In `include/gseurat/engine/collision_gen.hpp`, remove the `elevation` vector and related methods from `CollisionGrid`:

Remove:
- `std::vector<float> elevation;`
- `float get_elevation(uint32_t x, uint32_t y) const { ... }`
- `void set_elevation(uint32_t x, uint32_t y, float e) { ... }`

- [ ] **Step 3: Fix compilation errors from elevation removal**

In `src/engine/collision_gen.cpp`, in `generate_collision_from_gaussians()`:
- Remove `grid.elevation.resize(...)` line
- Remove `grid.elevation[idx] = g.position.y;` and `grid.elevation[idx] = std::max(...)` lines
- Remove the slope detection loop that reads elevation (the "mark steep slopes" section)

In `src/engine/scene_loader.cpp`, remove the `elevation` array loading block (the `if (col.contains("elevation"))` section).

In `src/demo/island_demo_state.cpp`, remove any remaining references to `get_elevation()` or `set_elevation()` (search for `elevation`).

In `src/engine/coordinate.cpp`, if `to_world(CellPos, grid, AABB)` calls `grid.get_elevation()`, replace it with a fixed Y of 0.0f or remove the elevation sampling (height now comes from the heightfield, not the grid).

- [ ] **Step 4: Build to verify all compilation errors are fixed**

Run: `cmake --build --preset macos-debug 2>&1 | tail -20`

Expected: Build succeeds. Fix any remaining references to `elevation`, `get_elevation`, or `set_elevation`.

- [ ] **Step 5: Run all collision tests**

Run: `ctest --preset macos-debug -R "test_(collision|intersect|kcc|heightfield|bvh|primitive)" --output-on-failure`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/demo/island_demo_state.cpp \
        include/gseurat/engine/collision_gen.hpp \
        src/engine/collision_gen.cpp \
        src/engine/scene_loader.cpp \
        src/engine/coordinate.cpp
git commit -m "fix(collision): remove legacy elevation snapping, CollisionGrid.elevation deleted"
```

---

### Task 9: Offline migration script

**Files:**
- Create: `scripts/migrate_elevation_to_png.py`

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate_elevation_to_png.py`:

```python
#!/usr/bin/env python3
"""Migrate collision.elevation[] arrays from scene JSON files to 16-bit PNG heightmaps.

Usage:
    python3 scripts/migrate_elevation_to_png.py examples/island_demo/assets/scenes/*.json

For each scene JSON that contains a collision.elevation array:
  1. Reads width, height, cell_size, and elevation array
  2. Normalizes elevations to uint16 and writes a 16-bit grayscale PNG
  3. Injects a HeightfieldComponent game_object into the scene JSON
  4. Strips the elevation array from the collision block
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def migrate_scene(scene_path: str, output_dir: str, dry_run: bool = False) -> bool:
    """Migrate a single scene file. Returns True if modified."""
    with open(scene_path, "r") as f:
        data = json.load(f)

    collision = data.get("collision")
    if not collision:
        return False

    elevation = collision.get("elevation")
    if not elevation or len(elevation) == 0:
        print(f"  SKIP {scene_path}: no elevation data")
        return False

    width = collision["width"]
    height = collision["height"]
    cell_size = collision.get("cell_size", 1.0)

    if len(elevation) != width * height:
        print(f"  ERROR {scene_path}: elevation array length {len(elevation)} "
              f"!= {width}x{height}={width * height}")
        return False

    # Convert to numpy for processing
    elev = np.array(elevation, dtype=np.float32).reshape(height, width)
    min_elev = float(elev.min())
    max_elev = float(elev.max())

    # Handle flat terrain (avoid division by zero)
    height_range = max_elev - min_elev
    if height_range < 1e-6:
        pixels = np.zeros((height, width), dtype=np.uint16)
    else:
        normalized = (elev - min_elev) / height_range
        pixels = np.round(normalized * 65535.0).astype(np.uint16)

    # Output PNG path
    scene_name = Path(scene_path).stem
    png_name = f"{scene_name}_heightmap.png"
    png_dir = os.path.join(output_dir, "terrain")
    png_path = os.path.join(png_dir, png_name)
    relative_png = f"assets/terrain/{png_name}"

    print(f"  {scene_path}:")
    print(f"    Grid: {width}x{height}, cell_size={cell_size}")
    print(f"    Height range: [{min_elev:.2f}, {max_elev:.2f}]")
    print(f"    Output: {png_path}")

    if dry_run:
        print("    (dry run — no files written)")
        return False

    # Write PNG
    os.makedirs(png_dir, exist_ok=True)
    img = Image.fromarray(pixels, mode="I;16")
    img.save(png_path)

    # Inject HeightfieldComponent game_object
    terrain_go = {
        "name": "terrain_heightfield",
        "components": {
            "Transform": {"position": [0, 0, 0]},
            "HeightfieldComponent": {
                "image_path": relative_png,
                "width": float(width * cell_size),
                "length": float(height * cell_size),
                "min_height": min_elev,
                "max_height": max_elev
            }
        }
    }

    if "game_objects" not in data:
        data["game_objects"] = []
    data["game_objects"].append(terrain_go)

    # Strip elevation from collision block
    del collision["elevation"]

    # Write updated JSON
    with open(scene_path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"    Injected HeightfieldComponent, stripped elevation array")
    return True


def main():
    parser = argparse.ArgumentParser(description="Migrate elevation arrays to PNG heightmaps")
    parser.add_argument("files", nargs="+", help="Scene JSON files to migrate")
    parser.add_argument("--output-dir", default="examples/island_demo/assets",
                        help="Base asset directory for PNG output")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be done without writing files")
    args = parser.parse_args()

    migrated = 0
    for path in args.files:
        if migrate_scene(path, args.output_dir, args.dry_run):
            migrated += 1

    print(f"\nMigrated {migrated}/{len(args.files)} files")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test with --dry-run**

Run: `python3 scripts/migrate_elevation_to_png.py --dry-run examples/island_demo/assets/scenes/*.json`

Expected: Lists scene files, reports grid dimensions and height ranges, prints "(dry run)".

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate_elevation_to_png.py
git commit -m "feat(scripts): add migrate_elevation_to_png.py for heightfield migration"
```

---

### Task 10: Run migration and verify end-to-end

**Files:**
- Modify: scene JSON files (via migration script)
- New: PNG heightmap files

- [ ] **Step 1: Run the migration**

Run: `python3 scripts/migrate_elevation_to_png.py examples/island_demo/assets/scenes/*.json`

Expected: Processes scene files that have elevation data, generates PNGs, updates JSON.

- [ ] **Step 2: Verify generated PNGs**

Run: `python3 -c "from PIL import Image; img = Image.open('examples/island_demo/assets/terrain/seurat_island_heightmap.png'); print(f'Size: {img.size}, Mode: {img.mode}')"`

Expected: Reports 16-bit image with correct dimensions.

- [ ] **Step 3: Verify JSON cleanup**

Run: `python3 -c "import json; d=json.load(open('examples/island_demo/assets/scenes/seurat_island.json')); print('elevation' not in d.get('collision', {})); print(any(go.get('components',{}).get('HeightfieldComponent') for go in d.get('game_objects',[])))"`

Expected: `True` (elevation removed) and `True` (HeightfieldComponent present).

- [ ] **Step 4: Build and run all tests**

Run: `cmake --build --preset macos-debug && ctest --preset macos-debug --output-on-failure`

Expected: Full build succeeds, all tests pass.

- [ ] **Step 5: Commit migrated data**

```bash
git add examples/island_demo/assets/terrain/ \
        examples/island_demo/assets/scenes/
git commit -m "data: migrate elevation arrays to 16-bit PNG heightmaps"
```

---

### Task 11: Final regression test and cleanup

- [ ] **Step 1: Run full test suite**

Run: `cmake --build --preset macos-debug && ctest --preset macos-debug --output-on-failure`

Expected: All tests pass, no regressions.

- [ ] **Step 2: Run the demo**

Launch the demo and verify:
- Player walks on terrain (ground detection via KCC sweep)
- Player can walk onto box colliders placed on terrain
- Player falls off cliff edges
- Steep slopes block movement

- [ ] **Step 3: Commit any final fixes**

If any fixes were needed from the demo test, commit them.

- [ ] **Step 4: Create PR**

```bash
git push -u origin spec/heightfield-collider-kcc
gh pr create --title "feat(collision): heightfield collider for unified KCC ground detection" \
  --body "$(cat <<'EOF'
## Summary
- Adds `HeightfieldComponent` — loads 16-bit PNG heightmaps as collision terrain
- Integrates into master BVH alongside existing Box/Sphere/Capsule primitives
- New intersection math: `ray_vs_heightfield`, `capsule_vs_heightfield`, `sweep_capsule_vs_heightfield`
- KCC requires zero changes — ground probe sweeps against terrain natively
- Removes legacy `CollisionGrid::elevation` and manual Y-snapping from island demo
- Includes offline migration script (`migrate_elevation_to_png.py`)

## Test plan
- [ ] `test_heightfield_intersect` — unit tests for all intersection functions
- [ ] `test_heightfield_system` — integration test with CollisionSystem + BVH
- [ ] Existing `test_collision_system`, `test_kcc`, `test_intersect` pass (no regressions)
- [ ] Demo: player walks on terrain, onto boxes, falls off cliffs, blocked by steep slopes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
