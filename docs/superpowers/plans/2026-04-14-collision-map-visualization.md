# CollisionMap Grid Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collision grid overlay gizmo to Developer Mode so solid/walkable cells are visible when debugging movement issues.

**Architecture:** Add a `show_gizmo_collision` flag to `DevOverlay`, wire it into the View menu, and draw semi-transparent filled quads for each collision cell in `StagingState::draw_gizmos()`. Solid cells are red, walkable cells are green. Cell corners are converted from grid indices to world coordinates using `coord::to_world(CellPos, grid, terrain_aabb)`, then projected to screen with `project_to_screen()`.

**Tech Stack:** C++23, ImGui (ImDrawList), existing `DevOverlay` gizmo system, `coord::to_world()` coordinate conversion.

---

### Task 1: Add `show_gizmo_collision` flag to DevOverlay

**Files:**
- Modify: `include/gseurat/engine/dev_overlay.hpp:48`
- Modify: `src/engine/dev_overlay.cpp:155` (View menu)
- Modify: `src/engine/dev_overlay.cpp:159-161` (Show All)
- Modify: `src/engine/dev_overlay.cpp:165-167` (Hide All)

- [ ] **Step 1: Add the flag to DevOverlay header**

In `include/gseurat/engine/dev_overlay.hpp`, after `show_gizmo_world` (line 48), add:

```cpp
    bool show_gizmo_collision = false;  // off by default — overlay is heavy
```

Note: default `false` because the overlay draws thousands of quads; user enables it on demand.

- [ ] **Step 2: Add View menu entry**

In `src/engine/dev_overlay.cpp`, after the `Gizmo: World` menu item (line 155), add:

```cpp
            ImGui::MenuItem("Gizmo: Collision", nullptr, &show_gizmo_collision);
```

- [ ] **Step 3: Include collision in Show All / Hide All**

In `src/engine/dev_overlay.cpp`, update the Show All block (line 161) to also set:

```cpp
                show_gizmo_collision = true;
```

And the Hide All block (line 167) to also set:

```cpp
                show_gizmo_collision = false;
```

- [ ] **Step 4: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/dev_overlay.hpp src/engine/dev_overlay.cpp
git commit -m "feat(staging): add show_gizmo_collision flag to DevOverlay"
```

---

### Task 2: Draw collision grid overlay in StagingState::draw_gizmos()

**Files:**
- Modify: `src/staging/staging_state.cpp:1109` (after camera zone gizmos, before world manifest gizmos)

The collision drawing code goes in `draw_gizmos()` between the Camera Zone gizmos block (line 1109) and the World manifest gizmos block (line 1112). This positions it before chunk wireframes so the semi-transparent fill doesn't obscure other gizmo labels.

- [ ] **Step 1: Add the include for coordinate.hpp**

In `src/staging/staging_state.cpp`, check whether `coordinate.hpp` is already included. If not, add after the existing includes (near line 9):

```cpp
#include "gseurat/engine/coordinate.hpp"
```

Also ensure `collision_gen.hpp` is included (for `CollisionGrid`):

```cpp
#include "gseurat/engine/collision_gen.hpp"
```

- [ ] **Step 2: Add collision grid drawing code**

In `src/staging/staging_state.cpp`, inside `draw_gizmos()`, after the camera zone gizmo block (line 1109) and before the world manifest gizmo block (line 1112), add:

```cpp
    // ── Collision grid overlay ──
    if (ov.show_gizmo_collision && last_scene_data_ && last_scene_data_->collision.has_value()) {
        const auto& grid = *last_scene_data_->collision;
        auto terrain_aabb = app.gs_terrain().terrain_aabb;

        ImU32 solid_col    = IM_COL32(204, 0, 0, 77);    // red, alpha ~0.3
        ImU32 walkable_col = IM_COL32(0, 204, 0, 38);    // green, alpha ~0.15
        ImU32 grid_line_col = IM_COL32(255, 255, 255, 51); // white, alpha ~0.2

        for (uint32_t gz = 0; gz < grid.height; gz++) {
            for (uint32_t gx = 0; gx < grid.width; gx++) {
                // Four corners of the cell in world space
                auto p00 = coord::to_world(
                    coord::CellPos(static_cast<float>(gx), 0.0f, static_cast<float>(gz)),
                    grid, terrain_aabb);
                auto p10 = coord::to_world(
                    coord::CellPos(static_cast<float>(gx + 1), 0.0f, static_cast<float>(gz)),
                    grid, terrain_aabb);
                auto p01 = coord::to_world(
                    coord::CellPos(static_cast<float>(gx), 0.0f, static_cast<float>(gz + 1)),
                    grid, terrain_aabb);
                auto p11 = coord::to_world(
                    coord::CellPos(static_cast<float>(gx + 1), 0.0f, static_cast<float>(gz + 1)),
                    grid, terrain_aabb);

                // Project all 4 corners to screen
                float sx00, sy00, sx10, sy10, sx01, sy01, sx11, sy11;
                bool v00 = project_to_screen(p00.vec(), vp, sw, sh, sx00, sy00);
                bool v10 = project_to_screen(p10.vec(), vp, sw, sh, sx10, sy10);
                bool v01 = project_to_screen(p01.vec(), vp, sw, sh, sx01, sy01);
                bool v11 = project_to_screen(p11.vec(), vp, sw, sh, sx11, sy11);

                // Skip if all 4 corners are behind camera
                if (!v00 && !v10 && !v01 && !v11) continue;

                // Skip if all 4 corners are off-screen (simple AABB check)
                float min_x = std::min({sx00, sx10, sx01, sx11});
                float max_x = std::max({sx00, sx10, sx01, sx11});
                float min_y = std::min({sy00, sy10, sy01, sy11});
                float max_y = std::max({sy00, sy10, sy01, sy11});
                if (max_x < 0 || min_x > sw || max_y < 0 || min_y > sh) continue;

                bool is_solid = grid.is_solid(gx, gz);
                ImU32 fill = is_solid ? solid_col : walkable_col;

                // Filled quad
                dl->AddQuadFilled(
                    ImVec2(sx00, sy00), ImVec2(sx10, sy10),
                    ImVec2(sx11, sy11), ImVec2(sx01, sy01), fill);

                // Grid lines (only draw right and bottom edges to avoid double-drawing)
                dl->AddLine(ImVec2(sx10, sy10), ImVec2(sx11, sy11), grid_line_col, 1.0f);
                dl->AddLine(ImVec2(sx01, sy01), ImVec2(sx11, sy11), grid_line_col, 1.0f);
            }
        }
    }
```

Key design decisions:
- Uses `coord::to_world(CellPos, grid, terrain_aabb)` for correct world-space positioning
- Each cell gets 4 corner projections (gx,gz), (gx+1,gz), (gx,gz+1), (gx+1,gz+1)
- Frustum culling: skip cells where all 4 corners are behind camera or off-screen
- Grid lines drawn only on right+bottom edges to avoid double-drawing shared edges
- Default off (`show_gizmo_collision = false`) since 192x192 = 36k quads is heavy

- [ ] **Step 3: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/staging/staging_state.cpp
git commit -m "feat(staging): draw collision grid overlay in Developer Mode gizmos"
```

---

### Task 3: Manual verification in Staging

- [ ] **Step 1: Launch Staging with seurat_island scene**

Run: `./build/macos-debug/gseurat --staging`

Load the seurat_island scene (it has a 192x192 collision grid).

- [ ] **Step 2: Toggle Developer Mode and enable collision gizmo**

Press F1 to open Developer Mode. Open View menu → check "Gizmo: Collision".

Verify:
- Red overlay appears on solid (impassable) cells
- Green overlay appears on walkable cells
- Grid lines are visible between cells
- Overlay does not obscure other gizmo types when both are enabled
- Performance is acceptable (may be slower with full 192x192 grid visible)

- [ ] **Step 3: Verify Show All / Hide All**

View menu → "Show All" → collision overlay appears.
View menu → "Hide All" → collision overlay disappears.

- [ ] **Step 4: Test with Camera Review mode**

Enter Camera Review mode (WASD walking). Navigate to areas that were previously impassable. Check that solid cells visually match the areas where the player cannot walk.
