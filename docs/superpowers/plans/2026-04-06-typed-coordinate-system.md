# Typed Coordinate System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce compile-time coordinate space safety via `Position<Space>` template types, preventing bugs where Grid positions are silently used in World context (the PR #145 bug class).

**Architecture:** A `Position<Space>` template wraps `glm::vec3` with tag types (`Grid`, `World`, `CellIndex`, etc.). Hub-and-spoke through World — all conversions go `X ↔ World`. Phase 1 covers Grid↔World and Cell↔World; other spaces are declared but implemented later.

**Tech Stack:** C++23, GLM, nlohmann/json, Catch-style manual test harness

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `include/gseurat/engine/coordinate.hpp` | `Position<Space>` template, tag types, conversion function declarations |
| **Create:** `src/engine/coordinate.cpp` | Conversion implementations (Grid↔World, Cell↔World) |
| **Create:** `tests/test_coordinate.cpp` | Unit tests for coordinate types and conversions |
| **Modify:** `include/gseurat/engine/scene_loader.hpp` | `GameObjectData.position` → `coord::GridPos`, other scene positions → `coord::GridPos` |
| **Modify:** `src/engine/scene_loader.cpp` | Parse into `GridPos`, serialize from `GridPos` |
| **Modify:** `include/gseurat/engine/app_base.hpp` | Remove `gs_aabb_offset_`, replace `terrain_aabb_min_` with `AABB terrain_aabb_`, typed accessors |
| **Modify:** `src/engine/app_base.cpp` | Replace manual offset arithmetic with `coord::to_world()` |
| **Modify:** `include/gseurat/engine/ecs/default_components.hpp` | `Transform.position` → `coord::WorldPos` |
| **Modify:** `src/demo/island_systems.cpp` | Collision lookups use `coord::to_cell()` |
| **Modify:** `src/demo/island_demo_state.cpp` | Player collision lookups use `coord::to_cell()` |
| **Modify:** `tests/test_scene_loading.cpp` | Update to use typed positions |
| **Modify:** `CMakeLists.txt` | Add `src/engine/coordinate.cpp` to `gseurat_core`, add `test_coordinate` |

---

### Task 1: Position<Space> Template and Tag Types

**Files:**
- Create: `include/gseurat/engine/coordinate.hpp`
- Create: `tests/test_coordinate.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Write the test file with basic Position<Space> tests**

Create `tests/test_coordinate.cpp`:

```cpp
// Test: coordinate type system — Position<Space> construction, access, arithmetic, type safety.
// Run: ctest -R test_coordinate

#include "gseurat/engine/coordinate.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

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

static bool approx(float a, float b, float eps = 0.01f) {
    return std::fabs(a - b) < eps;
}

int main() {
    std::printf("\n=== Coordinate Type Tests ===\n\n");

    // ── 1. Construction and access ──
    std::printf("--- Construction and access ---\n\n");
    {
        gseurat::coord::GridPos p(glm::vec3(1.0f, 2.0f, 3.0f));
        check(approx(p.x(), 1.0f), "GridPos x()");
        check(approx(p.y(), 2.0f), "GridPos y()");
        check(approx(p.z(), 3.0f), "GridPos z()");
        check(approx(p.vec().x, 1.0f), "GridPos vec().x");
    }
    {
        gseurat::coord::WorldPos p(5.0f, 6.0f, 7.0f);
        check(approx(p.x(), 5.0f), "WorldPos 3-arg constructor x");
        check(approx(p.y(), 6.0f), "WorldPos 3-arg constructor y");
        check(approx(p.z(), 7.0f), "WorldPos 3-arg constructor z");
    }
    {
        gseurat::coord::GridPos p;
        check(approx(p.x(), 0.0f), "default-constructed GridPos x = 0");
        check(approx(p.y(), 0.0f), "default-constructed GridPos y = 0");
        check(approx(p.z(), 0.0f), "default-constructed GridPos z = 0");
    }

    // ── 2. Same-space arithmetic ──
    std::printf("\n--- Same-space arithmetic ---\n\n");
    {
        gseurat::coord::WorldPos a(1.0f, 2.0f, 3.0f);
        gseurat::coord::WorldPos b(10.0f, 20.0f, 30.0f);
        auto sum = a + b;
        check(approx(sum.x(), 11.0f), "WorldPos + WorldPos x");
        check(approx(sum.y(), 22.0f), "WorldPos + WorldPos y");
        check(approx(sum.z(), 33.0f), "WorldPos + WorldPos z");

        auto diff = b - a;
        check(approx(diff.x(), 9.0f), "WorldPos - WorldPos x");
    }
    {
        gseurat::coord::GridPos p(1.0f, 2.0f, 3.0f);
        gseurat::coord::GridPos d(0.5f, 0.5f, 0.5f);
        p += d;
        check(approx(p.x(), 1.5f), "GridPos += GridPos x");
        p -= d;
        check(approx(p.x(), 1.0f), "GridPos -= GridPos x");
    }

    // ── 3. Equality ──
    std::printf("\n--- Equality ---\n\n");
    {
        gseurat::coord::WorldPos a(1.0f, 2.0f, 3.0f);
        gseurat::coord::WorldPos b(1.0f, 2.0f, 3.0f);
        gseurat::coord::WorldPos c(9.0f, 9.0f, 9.0f);
        check(a == b, "equal positions are ==");
        check(a != c, "different positions are !=");
    }

    // ── 4. Mutable vec() access ──
    std::printf("\n--- Mutable vec() ---\n\n");
    {
        gseurat::coord::WorldPos p(0.0f, 0.0f, 0.0f);
        p.vec().x = 42.0f;
        check(approx(p.x(), 42.0f), "mutable vec() modifies underlying data");
    }

    // ── 5. sizeof matches glm::vec3 ──
    std::printf("\n--- sizeof ---\n\n");
    {
        check(sizeof(gseurat::coord::GridPos) == sizeof(glm::vec3),
              "sizeof(GridPos) == sizeof(glm::vec3)");
        check(sizeof(gseurat::coord::WorldPos) == sizeof(glm::vec3),
              "sizeof(WorldPos) == sizeof(glm::vec3)");
    }

    // ── 6. Trivially copyable (required for ECS archetype memcpy) ──
    std::printf("\n--- Trivially copyable ---\n\n");
    {
        check(std::is_trivially_copyable_v<gseurat::coord::GridPos>,
              "GridPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::WorldPos>,
              "WorldPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::CellPos>,
              "CellPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::LocalPos>,
              "LocalPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::CameraPos>,
              "CameraPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::ScreenPos>,
              "ScreenPos is trivially copyable");
    }

    // ── Cross-space arithmetic is a compile error ──
    // The following would NOT compile (uncomment to verify):
    // gseurat::coord::GridPos g(1,2,3);
    // gseurat::coord::WorldPos w(4,5,6);
    // auto bad = g + w;  // ERROR: no operator+ for Position<Grid> + Position<World>

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
```

- [ ] **Step 2: Create minimal header to make test compile (but fail to link)**

Create `include/gseurat/engine/coordinate.hpp`:

```cpp
#pragma once

#include <glm/glm.hpp>

#include <type_traits>

namespace gseurat {

// Forward declarations for conversion context types
struct AABB;
struct CollisionGrid;

namespace coord {

// Tag types — empty structs, zero runtime cost
struct Grid {};       // Bricklayer 0-based scene JSON coordinates
struct World {};      // PLY / rendering world space
struct CellIndex {};  // Integer collision grid indices (gx, gz)
struct Local {};      // Per-object model space (before transform)
struct Camera {};     // View space (GS parallax, orbit camera)
struct Screen {};     // Pixel coordinates (UI, mouse)

template <typename Space>
class Position {
public:
    Position() = default;
    explicit Position(glm::vec3 v) : v_(v) {}
    explicit Position(float x, float y, float z) : v_(x, y, z) {}

    const glm::vec3& vec() const { return v_; }
    glm::vec3& vec() { return v_; }

    float x() const { return v_.x; }
    float y() const { return v_.y; }
    float z() const { return v_.z; }

    Position operator+(const Position& rhs) const { return Position(v_ + rhs.v_); }
    Position operator-(const Position& rhs) const { return Position(v_ - rhs.v_); }
    Position& operator+=(const Position& rhs) { v_ += rhs.v_; return *this; }
    Position& operator-=(const Position& rhs) { v_ -= rhs.v_; return *this; }

    bool operator==(const Position& rhs) const { return v_ == rhs.v_; }
    bool operator!=(const Position& rhs) const { return v_ != rhs.v_; }

private:
    glm::vec3 v_{0.0f};
};

// Convenience aliases
using GridPos   = Position<Grid>;
using WorldPos  = Position<World>;
using CellPos   = Position<CellIndex>;
using LocalPos  = Position<Local>;
using CameraPos = Position<Camera>;
using ScreenPos = Position<Screen>;

// ── Conversion declarations (Phase 1: Grid↔World, Cell↔World) ──

WorldPos to_world(GridPos pos, const AABB& terrain_aabb);
GridPos  to_grid(WorldPos pos, const AABB& terrain_aabb);

WorldPos to_world(CellPos cell, const CollisionGrid& grid, const AABB& terrain_aabb);
CellPos  to_cell(WorldPos pos, const CollisionGrid& grid, const AABB& terrain_aabb);

// ── Phase 2 declarations (implemented when subsystems are migrated) ──

WorldPos  to_world(LocalPos pos, const glm::mat4& model_transform);
LocalPos  to_local(WorldPos pos, const glm::mat4& inv_model_transform);

WorldPos  to_world(CameraPos pos, const glm::mat4& inv_view);
CameraPos to_camera(WorldPos pos, const glm::mat4& view);

WorldPos  to_world(ScreenPos pos, const glm::mat4& inv_vp, uint32_t viewport_w, uint32_t viewport_h);
ScreenPos to_screen(WorldPos pos, const glm::mat4& vp, uint32_t viewport_w, uint32_t viewport_h);

}  // namespace coord
}  // namespace gseurat
```

- [ ] **Step 3: Add test to CMakeLists.txt**

In `CMakeLists.txt`, after the existing `add_gseurat_test` lines (around line 294), add:

```cmake
add_gseurat_test(test_coordinate      src/engine/coordinate.cpp)
```

- [ ] **Step 4: Create empty implementation file**

Create `src/engine/coordinate.cpp`:

```cpp
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/collision_gen.hpp"

namespace gseurat::coord {

// Phase 1 implementations will be added in Task 2

}  // namespace gseurat::coord
```

- [ ] **Step 5: Run test to verify it compiles and passes**

Run: `cmake --build --preset macos-debug --target test_coordinate 2>&1 | tail -5 && ctest -R test_coordinate --test-dir build/macos-debug --output-on-failure`

Expected: All construction, arithmetic, equality, sizeof, and trivially-copyable tests PASS.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/coordinate.hpp src/engine/coordinate.cpp tests/test_coordinate.cpp CMakeLists.txt
git commit -m "feat: add Position<Space> coordinate type template with tag types"
```

---

### Task 2: Grid↔World and Cell↔World Conversion Functions

**Files:**
- Modify: `src/engine/coordinate.cpp`
- Modify: `tests/test_coordinate.cpp`

- [ ] **Step 1: Add conversion tests to test_coordinate.cpp**

Append before the final results print in `tests/test_coordinate.cpp` (before `std::printf("\n=== Results:`):

```cpp
    // ── 7. Grid → World conversion ──
    std::printf("\n--- Grid to World ---\n\n");
    {
        // Terrain PLY with AABB min at (-128, -70, 0), max at (127, 70, 127)
        gseurat::AABB terrain_aabb;
        terrain_aabb.min = glm::vec3(-128.0f, -70.0f, 0.0f);
        terrain_aabb.max = glm::vec3(127.0f, 70.0f, 127.0f);

        gseurat::coord::GridPos grid(50.0f, 50.0f, 64.0f);
        auto world = gseurat::coord::to_world(grid, terrain_aabb);

        check(approx(world.x(), -78.0f), "grid→world X: 50 + (-128) = -78");
        check(approx(world.y(), -20.0f), "grid→world Y: 50 + (-70) = -20");
        check(approx(world.z(), 64.0f),  "grid→world Z: 64 + 0 = 64");
    }

    // ── 8. World → Grid conversion ──
    std::printf("\n--- World to Grid ---\n\n");
    {
        gseurat::AABB terrain_aabb;
        terrain_aabb.min = glm::vec3(-128.0f, -70.0f, 0.0f);
        terrain_aabb.max = glm::vec3(127.0f, 70.0f, 127.0f);

        gseurat::coord::WorldPos world(-78.0f, -20.0f, 64.0f);
        auto grid = gseurat::coord::to_grid(world, terrain_aabb);

        check(approx(grid.x(), 50.0f), "world→grid X: -78 - (-128) = 50");
        check(approx(grid.y(), 50.0f), "world→grid Y: -20 - (-70) = 50");
        check(approx(grid.z(), 64.0f), "world→grid Z: 64 - 0 = 64");
    }

    // ── 9. Grid→World→Grid round-trip ──
    std::printf("\n--- Grid round-trip ---\n\n");
    {
        gseurat::AABB aabb;
        aabb.min = glm::vec3(-50.0f, -25.0f, -10.0f);
        aabb.max = glm::vec3(50.0f, 25.0f, 10.0f);

        gseurat::coord::GridPos orig(33.3f, 12.7f, 5.5f);
        auto world = gseurat::coord::to_world(orig, aabb);
        auto back = gseurat::coord::to_grid(world, aabb);

        check(approx(back.x(), orig.x()), "round-trip X preserved");
        check(approx(back.y(), orig.y()), "round-trip Y preserved");
        check(approx(back.z(), orig.z()), "round-trip Z preserved");
    }

    // ── 10. Cell → World conversion ──
    std::printf("\n--- Cell to World ---\n\n");
    {
        gseurat::CollisionGrid grid;
        grid.width = 256;
        grid.height = 128;
        grid.cell_size = 1.0f;
        grid.elevation.resize(256 * 128, 5.0f);  // flat terrain at Y=5

        gseurat::AABB aabb;
        aabb.min = glm::vec3(-128.0f, 0.0f, 0.0f);
        aabb.max = glm::vec3(127.0f, 10.0f, 127.0f);

        gseurat::coord::CellPos cell(10.0f, 0.0f, 20.0f);  // gx=10, gz=20
        auto world = gseurat::coord::to_world(cell, grid, aabb);

        // world.x = 10 * 1.0 + (-128) = -118
        // world.y = elevation(10, 20) = 5.0
        // world.z = 20 * 1.0 + 0 = 20
        check(approx(world.x(), -118.0f), "cell→world X: 10*1 + (-128)");
        check(approx(world.y(), 5.0f),    "cell→world Y: elevation");
        check(approx(world.z(), 20.0f),   "cell→world Z: 20*1 + 0");
    }

    // ── 11. World → Cell conversion ──
    std::printf("\n--- World to Cell ---\n\n");
    {
        gseurat::CollisionGrid grid;
        grid.width = 256;
        grid.height = 128;
        grid.cell_size = 2.0f;  // 2-unit cells

        gseurat::AABB aabb;
        aabb.min = glm::vec3(-100.0f, 0.0f, -50.0f);
        aabb.max = glm::vec3(100.0f, 10.0f, 50.0f);

        gseurat::coord::WorldPos world(-90.0f, 5.0f, -40.0f);
        auto cell = gseurat::coord::to_cell(world, grid, aabb);

        // gx = (-90 - (-100)) / 2 = 5
        // gz = (-40 - (-50)) / 2 = 5
        check(approx(cell.x(), 5.0f), "world→cell gx: (-90-(-100))/2 = 5");
        check(approx(cell.z(), 5.0f), "world→cell gz: (-40-(-50))/2 = 5");
    }

    // ── 12. Cell round-trip ──
    std::printf("\n--- Cell round-trip ---\n\n");
    {
        gseurat::CollisionGrid grid;
        grid.width = 100;
        grid.height = 100;
        grid.cell_size = 1.0f;
        grid.elevation.resize(10000, 3.0f);

        gseurat::AABB aabb;
        aabb.min = glm::vec3(-50.0f, 0.0f, -50.0f);
        aabb.max = glm::vec3(50.0f, 10.0f, 50.0f);

        gseurat::coord::CellPos orig(25.0f, 0.0f, 30.0f);
        auto world = gseurat::coord::to_world(orig, grid, aabb);
        auto back = gseurat::coord::to_cell(world, grid, aabb);

        check(approx(back.x(), orig.x()), "cell round-trip gx preserved");
        check(approx(back.z(), orig.z()), "cell round-trip gz preserved");
    }

    // ── 13. Zero AABB (no terrain) ──
    std::printf("\n--- Zero AABB ---\n\n");
    {
        gseurat::AABB aabb;
        aabb.min = glm::vec3(0.0f);
        aabb.max = glm::vec3(0.0f);

        gseurat::coord::GridPos grid(10.0f, 5.0f, 20.0f);
        auto world = gseurat::coord::to_world(grid, aabb);

        check(approx(world.x(), 10.0f), "zero AABB: grid→world X unchanged");
        check(approx(world.y(), 5.0f),  "zero AABB: grid→world Y unchanged");
        check(approx(world.z(), 20.0f), "zero AABB: grid→world Z unchanged");
    }
```

- [ ] **Step 2: Run tests to verify they fail (linker errors for unimplemented functions)**

Run: `cmake --build --preset macos-debug --target test_coordinate 2>&1 | tail -10`

Expected: Linker errors for `to_world`, `to_grid`, `to_cell`.

- [ ] **Step 3: Implement conversion functions**

Replace `src/engine/coordinate.cpp` contents:

```cpp
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/collision_gen.hpp"

namespace gseurat::coord {

// ── Grid ↔ World ──

WorldPos to_world(GridPos pos, const AABB& terrain_aabb) {
    return WorldPos(pos.vec() + terrain_aabb.min);
}

GridPos to_grid(WorldPos pos, const AABB& terrain_aabb) {
    return GridPos(pos.vec() - terrain_aabb.min);
}

// ── CellIndex ↔ World ──

WorldPos to_world(CellPos cell, const CollisionGrid& grid, const AABB& terrain_aabb) {
    float world_x = cell.x() * grid.cell_size + terrain_aabb.min.x;
    float world_z = cell.z() * grid.cell_size + terrain_aabb.min.z;

    // Look up elevation from grid
    auto gx = static_cast<uint32_t>(cell.x());
    auto gz = static_cast<uint32_t>(cell.z());
    float world_y = grid.get_elevation(gx, gz);

    return WorldPos(world_x, world_y, world_z);
}

CellPos to_cell(WorldPos pos, const CollisionGrid& grid, const AABB& terrain_aabb) {
    float gx = (pos.x() - terrain_aabb.min.x) / grid.cell_size;
    float gz = (pos.z() - terrain_aabb.min.z) / grid.cell_size;
    return CellPos(static_cast<float>(static_cast<int>(gx)), 0.0f,
                   static_cast<float>(static_cast<int>(gz)));
}

// ── Phase 2 stubs (implemented when subsystems are migrated) ──

WorldPos to_world(LocalPos pos, const glm::mat4& model_transform) {
    return WorldPos(glm::vec3(model_transform * glm::vec4(pos.vec(), 1.0f)));
}

LocalPos to_local(WorldPos pos, const glm::mat4& inv_model_transform) {
    return LocalPos(glm::vec3(inv_model_transform * glm::vec4(pos.vec(), 1.0f)));
}

WorldPos to_world(CameraPos pos, const glm::mat4& inv_view) {
    return WorldPos(glm::vec3(inv_view * glm::vec4(pos.vec(), 1.0f)));
}

CameraPos to_camera(WorldPos pos, const glm::mat4& view) {
    return CameraPos(glm::vec3(view * glm::vec4(pos.vec(), 1.0f)));
}

WorldPos to_world(ScreenPos pos, const glm::mat4& inv_vp, uint32_t viewport_w, uint32_t viewport_h) {
    // NDC from screen coords
    float ndc_x = (2.0f * pos.x() / static_cast<float>(viewport_w)) - 1.0f;
    float ndc_y = (2.0f * pos.y() / static_cast<float>(viewport_h)) - 1.0f;
    glm::vec4 clip(ndc_x, ndc_y, pos.z(), 1.0f);
    glm::vec4 world = inv_vp * clip;
    world /= world.w;
    return WorldPos(glm::vec3(world));
}

ScreenPos to_screen(WorldPos pos, const glm::mat4& vp, uint32_t viewport_w, uint32_t viewport_h) {
    glm::vec4 clip = vp * glm::vec4(pos.vec(), 1.0f);
    clip /= clip.w;
    float sx = (clip.x + 1.0f) * 0.5f * static_cast<float>(viewport_w);
    float sy = (clip.y + 1.0f) * 0.5f * static_cast<float>(viewport_h);
    return ScreenPos(sx, sy, clip.z);
}

}  // namespace gseurat::coord
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cmake --build --preset macos-debug --target test_coordinate 2>&1 | tail -5 && ctest -R test_coordinate --test-dir build/macos-debug --output-on-failure`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/coordinate.cpp tests/test_coordinate.cpp
git commit -m "feat: implement Grid↔World and Cell↔World coordinate conversions"
```

---

### Task 3: Add coordinate.cpp to gseurat_core Object Library

**Files:**
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Add source to gseurat_core**

In `CMakeLists.txt`, add `src/engine/coordinate.cpp` to the `gseurat_core` OBJECT library source list. Insert after `src/engine/gs_spline.cpp` (around line 174):

```cmake
    src/engine/coordinate.cpp
```

- [ ] **Step 2: Build the full project to verify no conflicts**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`

Expected: Build succeeds with no duplicate symbol or missing symbol errors.

- [ ] **Step 3: Commit**

```bash
git add CMakeLists.txt
git commit -m "build: add coordinate.cpp to gseurat_core object library"
```

---

### Task 4: Migrate SceneLoader to GridPos

**Files:**
- Modify: `include/gseurat/engine/scene_loader.hpp`
- Modify: `src/engine/scene_loader.cpp`

- [ ] **Step 1: Update GameObjectData.position to GridPos**

In `include/gseurat/engine/scene_loader.hpp`, add the include and change the position field:

Add after `#include "gseurat/engine/types.hpp"` (line 12):

```cpp
#include "gseurat/engine/coordinate.hpp"
```

Change `GameObjectData` (line 43-52):

```cpp
struct GameObjectData {
    std::string id;
    std::string name;
    coord::GridPos position;
    glm::vec3 rotation{0.0f};         // euler angles in degrees
    float scale = 1.0f;
    std::string ply_file;              // optional PLY visual
    nlohmann::json components;         // { "Health": { "max_hp": 50 }, ... }
    std::optional<PbdConfig> pbd;
};
```

Change `SceneData` position fields (lines 139-141):

```cpp
    // Player
    coord::GridPos player_position;
    glm::vec4 player_tint{1.0f};
```

Change `PortalData` position fields (lines 118-124):

```cpp
struct PortalData {
    coord::GridPos position;
    glm::vec2 size{1.0f};
    std::string target_scene;
    coord::GridPos spawn_position;
    Direction spawn_facing = Direction::Down;
};
```

Change `VfxInstanceRef.position` (line 159):

```cpp
        coord::GridPos position;
```

- [ ] **Step 2: Update SceneLoader parsing to construct GridPos**

In `src/engine/scene_loader.cpp`, update all position parsing sites to wrap in `coord::GridPos`. The key changes:

Where `obj.position = parse_vec3(go["position"])` (line 282), change to:

```cpp
            if (go.contains("position")) obj.position = coord::GridPos(parse_vec3(go["position"]));
```

Where `obj.rotation = parse_vec3(go["rotation"])` — leave as `glm::vec3` (rotation is not a position).

Where `data.player_position = parse_vec3(p["position"])` (line 270), change to:

```cpp
        data.player_position = coord::GridPos(parse_vec3(p["position"]));
```

Where legacy NPC parsing sets `go.position` (line 322), change to:

```cpp
            if (npc_j.contains("position")) go.position = coord::GridPos(parse_vec3(npc_j["position"]));
```

Where legacy object parsing sets `go.position` (line 381), change to:

```cpp
            if (obj_j.contains("position")) go.position = coord::GridPos(parse_vec3(obj_j["position"]));
```

Where portal parsing sets positions (lines 365, 368), change to:

```cpp
            portal.position = coord::GridPos(parse_vec3(portal_j["position"]));
            // ...
            portal.spawn_position = coord::GridPos(parse_vec3(portal_j["spawn_position"]));
```

Where VFX instance parsing sets position (line 420), change to:

```cpp
            if (vi.contains("position")) inst.position = coord::GridPos(parse_vec3(vi["position"]));
```

- [ ] **Step 3: Update SceneLoader serialization (to_json)**

In `to_json()`, where `GameObjectData.position` is serialized, extract the `glm::vec3` via `.vec()`. Find all `vec3_json(go.position)` calls and change to `vec3_json(go.position.vec())`. Same for `player_position.vec()`, portal position `.vec()`, VFX instance position `.vec()`.

- [ ] **Step 4: Build and fix compile errors**

Run: `cmake --build --preset macos-debug 2>&1 | grep "error:" | head -20`

Fix any remaining sites where `GameObjectData.position` is used as `glm::vec3` — these are exactly the sites that need conversion, which we'll address in Task 5. For now, use `.vec()` at call sites that will be migrated later (e.g., collision grid snap in `app_base.cpp`), adding a `// TODO(coord): convert to use coord::to_cell()` comment.

- [ ] **Step 5: Run existing scene loading tests**

Run: `cmake --build --preset macos-debug --target test_scene_loading 2>&1 | tail -5 && ctest -R test_scene_loading --test-dir build/macos-debug --output-on-failure`

Expected: All existing tests still pass (round-trip, parsing, etc.).

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/scene_loader.hpp src/engine/scene_loader.cpp
git commit -m "refactor: SceneLoader positions use coord::GridPos"
```

---

### Task 5: Migrate AppBase Offset Arithmetic to coord::to_world()

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp`
- Modify: `src/engine/app_base.cpp`

- [ ] **Step 1: Update AppBase header**

In `include/gseurat/engine/app_base.hpp`:

Add include after `#include "gseurat/engine/scene_loader.hpp"` (line 28):

```cpp
#include "gseurat/engine/coordinate.hpp"
```

Replace `terrain_aabb_min_` (line 252) and `gs_aabb_offset_` (line 251) with a single AABB:

Remove these two lines:
```cpp
    glm::vec2 gs_aabb_offset_{0.0f};
    glm::vec3 terrain_aabb_min_{0.0f};  // terrain PLY AABB min (for game object grid→world mapping)
```

Add in their place:
```cpp
    AABB terrain_aabb_;  // terrain PLY AABB (for grid→world coordinate conversion)
```

Update the `gs_aabb_offset()` accessor (line 214) to compute from AABB:

```cpp
    glm::vec2 gs_aabb_offset() const { return glm::vec2(terrain_aabb_.min.x, terrain_aabb_.min.y); }
```

Add a new accessor:
```cpp
    const AABB& terrain_aabb() const { return terrain_aabb_; }
```

- [ ] **Step 2: Update load_gs_scene() in app_base.cpp — terrain AABB init**

In `src/engine/app_base.cpp`, replace the terrain AABB initialization block (lines 392-400):

Replace:
```cpp
        terrain_aabb_min_ = glm::vec3(0.0f);
        if (has_terrain) {
            auto terrain_aabb = cloud.bounds();
            terrain_aabb_min_ = terrain_aabb.min;
        }
```

With:
```cpp
        terrain_aabb_ = AABB{};
        terrain_aabb_.min = glm::vec3(0.0f);
        terrain_aabb_.max = glm::vec3(0.0f);
        if (has_terrain) {
            terrain_aabb_ = cloud.bounds();
        }
```

- [ ] **Step 3: Update game object grid→world conversion (lines 419-424)**

Replace the game object grid→world conversion block (lines 419-425):

Replace:
```cpp
        // Apply terrain AABB offset to convert grid coords → world coords
        if (has_terrain) {
            for (auto& go : snapped_objects) {
                go.position += terrain_aabb_min_;
            }
        }
        scene_game_object_data_ = snapped_objects;
```

With:
```cpp
        // Store grid-coordinate objects for round-trip serialization
        scene_game_object_data_ = snapped_objects;

        // Compute world positions for PLY merge and ECS entity creation
        std::vector<coord::WorldPos> world_positions;
        world_positions.reserve(snapped_objects.size());
        for (const auto& go : snapped_objects) {
            world_positions.push_back(coord::to_world(go.position, terrain_aabb_));
        }
```

Note: `GameObjectData.position` remains `GridPos` in `scene_game_object_data_` (for round-trip serialization). World positions are computed into a parallel vector and used for PLY merge and ECS entity creation.

Then update the PLY merge loop (line 433 `for (const auto& go : snapped_objects)`) to use `world_positions[i]` instead of `go.position`:

```cpp
                for (size_t i = 0; i < snapped_objects.size(); ++i) {
                    const auto& go = snapped_objects[i];
                    if (go.ply_file.empty()) continue;
                    // ...
                    glm::vec3 adjusted_pos = world_positions[i].vec();
```

And the ECS entity creation (line 510-517):

```cpp
            for (size_t i = 0; i < snapped_objects.size(); ++i) {
                const auto& go = snapped_objects[i];
                if (go.components.empty() || go.components.is_null()) continue;
                auto entity = world_.create();
                world_.add<ecs::Transform>(entity, {{world_positions[i].vec()}, {go.scale, go.scale}});
                for (auto& [name, data] : go.components.items()) {
                    component_registry_.attach(world_, entity, name, data);
                }
            }
```

- [ ] **Step 4: Update AABB offset for lights (lines 583-609)**

Replace:
```cpp
            auto aabb = cloud.bounds();
            gs_aabb_offset_ = glm::vec2(aabb.min.x, aabb.min.y);

            std::vector<PointLight> gs_lights;
            for (const auto& pl : scene_data.static_lights) {
                PointLight t = pl;
                t.position_and_radius.x += aabb.min.x;
                t.position_and_radius.z += aabb.min.y;
                gs_lights.push_back(t);
            }
```

With:
```cpp
            std::vector<PointLight> gs_lights;
            for (const auto& pl : scene_data.static_lights) {
                PointLight t = pl;
                // Light JSON position is [x, height, z] in grid coords.
                // PointLight stores (world_x, world_z, height, radius).
                // Apply grid→world offset to the x and z components.
                t.position_and_radius.x += terrain_aabb_.min.x;
                t.position_and_radius.z += terrain_aabb_.min.y;
                gs_lights.push_back(t);
            }
```

- [ ] **Step 5: Update emitter offset (lines 612-617)**

Replace:
```cpp
            for (const auto& em : scene_data.gs_particle_emitters) {
                auto config = em.config;
                config.position.x += aabb.min.x;
                config.position.y += aabb.min.y;
                renderer_.add_gs_particle_emitter(config);
            }
```

With:
```cpp
            for (const auto& em : scene_data.gs_particle_emitters) {
                auto config = em.config;
                auto world_pos = coord::to_world(
                    coord::GridPos(config.position), terrain_aabb_);
                config.position = world_pos.vec();
                renderer_.add_gs_particle_emitter(config);
            }
```

- [ ] **Step 6: Update animation offset (lines 620-627)**

Replace:
```cpp
            for (const auto& anim : scene_data.gs_animations) {
                auto region = anim.region;
                region.center.x += aabb.min.x;
                region.center.y += aabb.min.y;
```

With:
```cpp
            for (const auto& anim : scene_data.gs_animations) {
                auto region = anim.region;
                auto world_center = coord::to_world(
                    coord::GridPos(region.center), terrain_aabb_);
                region.center = world_center.vec();
```

- [ ] **Step 7: Update VFX instance offset (lines 681-684)**

Replace:
```cpp
            auto pos = vi.position;
            pos.x += gs_aabb_offset_.x;
            pos.y += gs_aabb_offset_.y;
```

With:
```cpp
            auto world_pos = coord::to_world(vi.position, terrain_aabb_);
```

Then pass `world_pos.vec()` to `inst.init()`:

```cpp
            inst.init(preset, world_pos.vec(), vi.loop, vi.rotation_y);
```

- [ ] **Step 8: Update update_scene_data command handler (lines 947-1017)**

Apply the same pattern to the `update_scene_data` handler. Replace all `gs_aabb_offset_` and `terrain_aabb_min_` usage with `coord::to_world()`:

Lights (lines 948-953):
```cpp
                for (const auto& pl : scene_data.static_lights) {
                    PointLight t = pl;
                    t.position_and_radius.x += terrain_aabb_.min.x;
                    t.position_and_radius.z += terrain_aabb_.min.y;
                    gs_lights.push_back(t);
                }
```

Emitters (lines 968-973):
```cpp
                for (const auto& em : scene_data.gs_particle_emitters) {
                    auto config = em.config;
                    auto world_pos = coord::to_world(
                        coord::GridPos(config.position), terrain_aabb_);
                    config.position = world_pos.vec();
                    renderer_.add_gs_particle_emitter(config);
                }
```

Animations (lines 977-980):
```cpp
                for (const auto& anim : scene_data.gs_animations) {
                    auto region = anim.region;
                    auto world_center = coord::to_world(
                        coord::GridPos(region.center), terrain_aabb_);
                    region.center = world_center.vec();
```

VFX (lines 993-996):
```cpp
                    auto world_pos = coord::to_world(vi.position, terrain_aabb_);
                    inst.init(preset, world_pos.vec(), vi.loop, vi.rotation_y);
```

Game objects (lines 1000-1006):
```cpp
                {
                    scene_game_object_data_ = scene_data.game_objects;

                    std::vector<coord::WorldPos> world_positions;
                    world_positions.reserve(scene_data.game_objects.size());
                    for (const auto& go : scene_data.game_objects) {
                        world_positions.push_back(coord::to_world(go.position, terrain_aabb_));
                    }

                    for (size_t i = 0; i < scene_data.game_objects.size(); ++i) {
                        const auto& go = scene_data.game_objects[i];
                        if (go.components.empty() || go.components.is_null()) continue;
                        auto entity = world_.create();
                        world_.add<ecs::Transform>(entity, {{world_positions[i].vec()}, {go.scale, go.scale}});
                        for (auto& [name, data] : go.components.items()) {
                            component_registry_.attach(world_, entity, name, data);
                        }
                    }
                }
```

- [ ] **Step 9: Update update_vfx_positions handler (lines 1039-1041)**

Replace:
```cpp
                    new_pos.x += gs_aabb_offset_.x;
                    new_pos.y += gs_aabb_offset_.y;
```

With:
```cpp
                    auto world_pos = coord::to_world(coord::GridPos(new_pos), terrain_aabb_);
                    new_pos = world_pos.vec();
```

- [ ] **Step 10: Update clear_scene() in staging_app.cpp**

In `src/staging/staging_app.cpp`, replace:
```cpp
    terrain_aabb_min_ = glm::vec3(0.0f);
```

With:
```cpp
    terrain_aabb_ = AABB{};
    terrain_aabb_.min = glm::vec3(0.0f);
    terrain_aabb_.max = glm::vec3(0.0f);
```

- [ ] **Step 11: Build and fix remaining compile errors**

Run: `cmake --build --preset macos-debug 2>&1 | grep "error:" | head -30`

Fix any remaining references to `terrain_aabb_min_` or `gs_aabb_offset_` in the codebase. Each should be replaced with `terrain_aabb_.min` or `coord::to_world()`.

- [ ] **Step 12: Run all tests**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5 && ctest --test-dir build/macos-debug --output-on-failure`

Expected: All tests pass.

- [ ] **Step 13: Commit**

```bash
git add include/gseurat/engine/app_base.hpp src/engine/app_base.cpp src/staging/staging_app.cpp
git commit -m "refactor: replace manual AABB offset arithmetic with coord::to_world()"
```

---

### Task 6: Migrate ECS Transform to WorldPos

**Files:**
- Modify: `include/gseurat/engine/ecs/default_components.hpp`
- Modify: `src/demo/island_systems.cpp`
- Modify: `src/demo/island_demo_state.cpp`

- [ ] **Step 1: Update Transform.position to WorldPos**

In `include/gseurat/engine/ecs/default_components.hpp`:

Add include:
```cpp
#include "gseurat/engine/coordinate.hpp"
```

Change `Transform`:
```cpp
struct Transform {
    coord::WorldPos position;
    glm::vec2 scale{1.0f, 1.0f};
};
```

- [ ] **Step 2: Build and collect compile errors**

Run: `cmake --build --preset macos-debug 2>&1 | grep "error:" | head -40`

This will show every site that accesses `Transform.position` as `glm::vec3`. Each is a site that needs explicit `.vec()` or typed conversion.

- [ ] **Step 3: Fix island_systems.cpp collision lookups**

In `src/demo/island_systems.cpp`, the NPC walker system (line 157-158) converts world position to grid cell:

Replace:
```cpp
                int gx = static_cast<int>((t.position.x - grid_ox) / grid->cell_size);
                int gz = static_cast<int>((t.position.z - grid_oz) / grid->cell_size);
```

With:
```cpp
                int gx = static_cast<int>((t.position.x() - grid_ox) / grid->cell_size);
                int gz = static_cast<int>((t.position.z() - grid_oz) / grid->cell_size);
```

And for elevation assignment (line 169):

Replace:
```cpp
                    t.position.y = grid->get_elevation(
```

With:
```cpp
                    t.position.vec().y = grid->get_elevation(
```

Apply similar changes throughout `island_systems.cpp` for all `t.position.x`, `t.position.y`, `t.position.z` accesses — use `.x()`, `.y()`, `.z()` for reads and `.vec().x` etc. for writes.

- [ ] **Step 4: Fix island_demo_state.cpp collision lookups**

In `src/demo/island_demo_state.cpp`, apply the same pattern:

Replace `transform->position.x` reads with `transform->position.x()`.
Replace `transform->position.z` reads with `transform->position.z()`.
Replace `transform->position.y = ...` writes with `transform->position.vec().y = ...`.
Replace `transform->position -= ...` with `transform->position -= coord::WorldPos(...)` or use `.vec()`.

- [ ] **Step 5: Fix all remaining compile errors**

Run: `cmake --build --preset macos-debug 2>&1 | grep "error:" | head -40`

Fix each remaining error — these will be in files that read `Transform.position` as `glm::vec3`. Add `.vec()` at the boundary to renderer/physics APIs, use `.x()/.y()/.z()` for component reads.

- [ ] **Step 6: Run all tests**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5 && ctest --test-dir build/macos-debug --output-on-failure`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/engine/ecs/default_components.hpp src/demo/island_systems.cpp src/demo/island_demo_state.cpp
git commit -m "refactor: ECS Transform.position uses coord::WorldPos"
```

---

### Task 7: Update test_scene_loading.cpp

**Files:**
- Modify: `tests/test_scene_loading.cpp`

- [ ] **Step 1: Update test helper and Section 10 to use typed positions**

In `tests/test_scene_loading.cpp`:

Add include at top:
```cpp
#include "gseurat/engine/coordinate.hpp"
```

Update Section 10 (lines 525-546) to use typed conversions:

```cpp
    // ── Section 10: Game object AABB offset (typed coordinates) ──
    {
        std::printf("\n== Section 10: game object AABB offset (typed) ==\n");

        gseurat::AABB terrain_aabb;
        terrain_aabb.min = glm::vec3(-128.0f, -70.0f, 0.0f);
        terrain_aabb.max = glm::vec3(127.0f, 70.0f, 127.0f);

        // Game object at grid position (50, 50, 64) — this is a GridPos
        gseurat::coord::GridPos grid_pos(50.0f, 50.0f, 64.0f);

        // Convert to world via typed function
        auto world_pos = gseurat::coord::to_world(grid_pos, terrain_aabb);

        check(approx(world_pos.x(), -78.0f), "typed: game object X shifted by terrain AABB min X");
        check(approx(world_pos.y(), -20.0f), "typed: game object Y shifted by terrain AABB min Y");
        check(approx(world_pos.z(), 64.0f),  "typed: game object Z shifted by terrain AABB min Z (0)");

        // Verify round-trip
        auto back = gseurat::coord::to_grid(world_pos, terrain_aabb);
        check(approx(back.x(), 50.0f), "typed: round-trip X preserved");
        check(approx(back.y(), 50.0f), "typed: round-trip Y preserved");
        check(approx(back.z(), 64.0f), "typed: round-trip Z preserved");

        // Center of terrain in world space
        glm::vec3 terrain_center = (terrain_aabb.min + terrain_aabb.max) * 0.5f;
        check(world_pos.x() < terrain_center.x, "game object LEFT of terrain center");
    }
```

Update test 6.1 (GameObjectData round-trip) to use `GridPos`:

Where `go1.position = {10.0f, 5.0f, 3.0f}` (line 350), change to:
```cpp
        go1.position = gseurat::coord::GridPos(10.0f, 5.0f, 3.0f);
```

And the check (line 370):
```cpp
        check(approx(rt.game_objects[0].position.x(), 10.0f), "go1 position.x preserved");
```

Apply similar `.x()` → accessor changes wherever `GameObjectData.position` components are read in the test file.

- [ ] **Step 2: Build and run scene loading tests**

Run: `cmake --build --preset macos-debug --target test_scene_loading 2>&1 | tail -5 && ctest -R test_scene_loading --test-dir build/macos-debug --output-on-failure`

Expected: All tests pass.

- [ ] **Step 3: Run full test suite**

Run: `ctest --test-dir build/macos-debug --output-on-failure`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/test_scene_loading.cpp
git commit -m "test: update scene loading tests to use typed coordinate positions"
```

---

### Task 8: Clean Up — Remove Dead Code and Add Final Documentation

**Files:**
- Modify: `src/engine/app_base.cpp` (remove any remaining `// TODO(coord)` comments)
- Modify: `include/gseurat/engine/app_base.hpp` (verify `gs_aabb_offset_` is fully removed)

- [ ] **Step 1: Search for any remaining raw offset patterns**

Run grep to find any leftover manual offset arithmetic:

```bash
grep -rn "gs_aabb_offset_\|terrain_aabb_min_\|aabb\.min\.x\|aabb\.min\.y" src/ include/ --include="*.cpp" --include="*.hpp" | grep -v "coordinate\.\(cpp\|hpp\)" | grep -v "test_"
```

Fix any remaining instances.

- [ ] **Step 2: Search for TODO(coord) markers**

```bash
grep -rn "TODO(coord)" src/ include/ tests/
```

Remove any temporary markers added during migration.

- [ ] **Step 3: Build and run full test suite**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5 && ctest --test-dir build/macos-debug --output-on-failure`

Expected: Clean build, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove legacy offset arithmetic, finalize coordinate type migration"
```
