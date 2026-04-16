# Bricklayer Portal Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the legacy world.json portal authoring path; portals become regular Game Objects in scene.json `game_objects[]` with `ProximityTrigger + PortalTarget` components.

**Architecture:** Single deletion-heavy PR. Engine C++ loses `WorldPortal`, scene-level `PortalData`, `WorldInstance`, `WorldStreamer` portal detection, and `spawn_world_portal_entities`. Bricklayer loses `PortalEditor`, `PortalMarkers`, World-mode portal store actions, and scene-level portal store actions. The demo's 2 existing portals get hand-migrated into the appropriate scene.json files.

**Tech Stack:** C++23, TypeScript/React (Bricklayer), JSON Schema, CMake.

**Spec:** `docs/superpowers/specs/2026-04-16-portal-bricklayer-cleanup-design.md`

---

## File Structure

| File | Action | Reason |
|------|--------|--------|
| `include/gseurat/engine/world_manifest.hpp` | Modify | Delete `WorldPortal`, `WorldInstance` structs + `portals[]`, `instances[]` fields |
| `src/engine/world_manifest.cpp` | Modify | Delete portal/instance JSON parsing + serialization; add deprecation warnings |
| `include/gseurat/engine/world_streamer.hpp` | Modify | Delete `entered_portal_id()`, `PORTAL_ENTERED`, `active_portals_`, `entered_portal_id_` |
| `src/engine/world_streamer.cpp` | Modify | Delete portal-region detection block |
| `include/gseurat/engine/scene_loader.hpp` | Modify | Delete `PortalData` struct + `SceneData::portals[]` |
| `src/engine/scene_loader.cpp` | Modify | Delete portal JSON parsing + serialization |
| `include/gseurat/engine/scene_objects.hpp` | Modify | Delete `portals` field from scene_objects struct |
| `src/staging/staging_app.cpp` | Modify | Delete `scene_objects_.portals = ...` assignment |
| `src/engine/command_dispatcher.cpp` | Modify | Delete `ctx_.scene_objects.portals = ...` assignment |
| `src/staging/staging_state.cpp` | Modify | Delete `PORTAL_ENTERED` event handler + `show_gizmo_portals` block |
| `include/gseurat/engine/dev_overlay.hpp` | Modify | Delete `show_gizmo_portals` field |
| `src/engine/dev_overlay.cpp` | Modify | Delete `View > Gizmo: Portals` menu + All-On/All-Off references |
| `src/demo/island_demo_state.cpp` | Modify | Delete `spawn_world_portal_entities()` + both call sites |
| `include/gseurat/demo/island_demo_state.hpp` | Modify | Delete `spawn_world_portal_entities` declaration |
| `examples/island_demo/world.json` | Modify | Delete `portals[]` and `instances[]` arrays |
| `examples/island_demo/assets/scenes/seurat_island.json` | Modify | Add `portal_dungeon` Game Object |
| `examples/island_demo/assets/scenes/dungeon.json` | Modify | Add `portal_dungeon_exit` Game Object |
| `schemas/world.schema.json` | Modify | Delete `portals` and `instances` definitions |
| `tools/packages/project-root/src/world.ts` | Modify | Delete `WorldPortalData`, `WorldInstance` types + manifest fields |
| `tools/apps/bricklayer/src/store/useWorldStore.ts` | Modify | Delete `addPortal/updatePortal/removePortal` + `portals` state |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Modify | Delete scene-level `addPortal/updatePortal/removePortal` + `portals` state |
| `tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx` | Modify | Delete `PortalEditor` component + render conditional |
| `tools/apps/bricklayer/src/panels/WorldTree.tsx` | Modify | Delete portal section + add/remove buttons |
| `tools/apps/bricklayer/src/viewport/PortalMarkers.tsx` | Delete | File deleted |
| `tools/apps/bricklayer/src/viewport/Viewport.tsx` | Modify | Delete `PortalMarkers` import + JSX + `sel.type === 'portal'` cases |
| `tools/apps/bricklayer/src/viewport/WorldViewport.tsx` | Modify | Delete portal rendering loop + selection cases |
| `tools/apps/bricklayer/src/App.tsx` | Modify | Delete `sel.type === 'portal'` cases |

---

### Task 1: Remove `WorldStreamer` portal detection (engine)

**Files:**
- Modify: `include/gseurat/engine/world_streamer.hpp`
- Modify: `src/engine/world_streamer.cpp`

Pure dead-code deletion. PR #264 stopped consuming `entered_portal_id()`; this physically removes it.

- [ ] **Step 1: Delete portal references in `world_streamer.hpp`**

In `include/gseurat/engine/world_streamer.hpp`, find and remove:

```cpp
                    PORTAL_ENTERED };
```

(it's the third enum value of `StreamEvent::Type`. Leave the comma after the previous value if it was last in the list.)

Find and remove:

```cpp
    // Query: which portal was entered this frame? Empty string if none.
    const std::string& entered_portal_id() const { return entered_portal_id_; }
```

Find and remove:

```cpp
    std::unordered_set<std::string> active_portals_;     // currently-inside portal IDs
```

Find and remove:

```cpp
    std::string entered_portal_id_;             // filled each frame
```

The comment on line 31 (`// grid key, volume id, or portal id`) should change to `// grid key, or volume id`.

- [ ] **Step 2: Delete portal-detection block in `world_streamer.cpp`**

In `src/engine/world_streamer.cpp`, find this block (around line 97-118) and delete it entirely:

```cpp
    // Portal detection (one-shot: only fires on enter, not every frame)
    for (const auto& portal : manifest_.portals) {
        bool inside = false;
        if (portal.region_shape == "box") {
            glm::vec3 d = glm::abs(camera_pos - portal.position);
            inside = (d.x <= portal.region_half_extents.x &&
                      d.y <= portal.region_half_extents.y &&
                      d.z <= portal.region_half_extents.z);
        } else {
            float dist = glm::length(camera_pos - portal.position);
            inside = dist <= portal.region_radius;
        }

        bool was_inside = active_portals_.count(portal.id) > 0;
        if (inside && !was_inside) {
            active_portals_.insert(portal.id);
            entered_portal_id_ = portal.id;
            events.push_back({StreamEvent::Type::PORTAL_ENTERED, portal.id});
        } else if (!inside && was_inside) {
            active_portals_.erase(portal.id);
        }
    }
```

Also remove the two `entered_portal_id_.clear();` lines (around lines 21 and 42).

- [ ] **Step 3: Build to confirm WorldStreamer compiles**

Run: `cmake --build build/macos-debug --target gseurat_core 2>&1 | tail -3`
Expected: Build succeeds. Other files still reference `manifest.portals` so the engine won't fully build yet — but world_streamer.cpp itself compiles.

(If the build fails because `island_demo_state.cpp:1711` mentions `WorldStreamer::entered_portal_id()` in a *comment*, that's fine — comments don't break compilation.)

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/world_streamer.hpp src/engine/world_streamer.cpp
git commit -m "refactor: remove dead WorldStreamer portal detection"
```

---

### Task 2: Remove `WorldPortal` + `WorldInstance` from `WorldManifest`

**Files:**
- Modify: `include/gseurat/engine/world_manifest.hpp`
- Modify: `src/engine/world_manifest.cpp`

- [ ] **Step 1: Delete struct definitions from header**

In `include/gseurat/engine/world_manifest.hpp`, delete:

```cpp
struct WorldPortal {
    std::string id;
    glm::vec3 position{0.0f};
    std::string region_shape{"sphere"};
    float region_radius{2.0f};
    glm::vec3 region_half_extents{1.0f};
    std::string target_instance_id;
    glm::vec3 spawn_position{0.0f};
    std::string spawn_facing;
};

struct WorldInstance {
    std::string id;
    std::string display_name;
    std::string scene_file;
};
```

In the `WorldManifest` struct, delete:

```cpp
    std::vector<WorldPortal> portals;
    std::vector<WorldInstance> instances;
```

- [ ] **Step 2: Replace JSON-parsing block with deprecation warning**

In `src/engine/world_manifest.cpp`, find the block starting at line 80:

```cpp
    if (j.contains("portals")) {
        for (const auto& pj : j["portals"]) {
            WorldPortal p;
            ...
            m.portals.push_back(std::move(p));
        }
    }

    if (j.contains("instances")) {
        for (const auto& ij : j["instances"]) {
            WorldInstance inst;
            ...
            m.instances.push_back(std::move(inst));
        }
    }
```

Replace with:

```cpp
    if (j.contains("portals")) {
        std::fprintf(stderr,
            "[world.json] WARNING: 'portals' field is deprecated and ignored. "
            "Author portals as Game Objects with ProximityTrigger + PortalTarget components in scene.json.\n");
    }
    if (j.contains("instances")) {
        std::fprintf(stderr,
            "[world.json] WARNING: 'instances' field is deprecated and ignored.\n");
    }
```

Add `#include <cstdio>` near the top of the file if not already present (check first with `grep -n 'cstdio' src/engine/world_manifest.cpp`).

- [ ] **Step 3: Delete JSON-serialization block in `to_json`**

In `src/engine/world_manifest.cpp`, find and delete the entire block starting at line 137 through 160:

```cpp
    j["portals"] = nlohmann::json::array();
    for (const auto& p : m.portals) {
        ...
        j["portals"].push_back(std::move(pj));
    }

    if (!m.instances.empty()) {
        j["instances"] = nlohmann::json::array();
        for (const auto& inst : m.instances) {
            ...
            j["instances"].push_back(std::move(ij));
        }
    }
```

The function should now end with `return j;` immediately after the `streaming_volumes` block.

- [ ] **Step 4: Build to confirm world_manifest compiles cleanly**

Run: `cmake --build build/macos-debug --target gseurat_core 2>&1 | tail -10`
Expected: build fails at OTHER files referencing `WorldPortal`/`WorldInstance`/`manifest.portals`/`manifest.instances`. world_manifest.cpp itself compiles.

The next tasks fix those references.

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/world_manifest.hpp src/engine/world_manifest.cpp
git commit -m "refactor: remove WorldPortal+WorldInstance from WorldManifest (deprecation warnings)"
```

---

### Task 3: Remove scene-level `PortalData` from `SceneLoader`

**Files:**
- Modify: `include/gseurat/engine/scene_loader.hpp`
- Modify: `src/engine/scene_loader.cpp`
- Modify: `include/gseurat/engine/scene_objects.hpp`
- Modify: `src/staging/staging_app.cpp`
- Modify: `src/engine/command_dispatcher.cpp`

Scene-level `PortalData` is a separate parallel type (distinct from world-level `WorldPortal`). It's parsed from scene.json's `portals[]` array but only stored in `scene_objects.portals` — never read. Dead data.

- [ ] **Step 1: Delete `PortalData` struct from header**

In `include/gseurat/engine/scene_loader.hpp`, delete the `PortalData` struct (around lines 121-130, search for `struct PortalData`):

```cpp
struct PortalData {
    coord::GridPos position;
    std::string region_shape{"box"};
    float region_radius{2.0f};
    glm::vec3 region_half_extents{1.0f, 1.0f, 1.0f};
    std::string target_scene;
    std::string target_instance_id;
    coord::GridPos spawn_position;
    Direction spawn_facing = Direction::Down;
};
```

In `SceneData`, delete the line:

```cpp
    std::vector<PortalData> portals;
```

(around line 159)

- [ ] **Step 2: Delete portal parsing in `scene_loader.cpp`**

In `src/engine/scene_loader.cpp`, find the block around line 484 that starts with `if (j.contains("portals"))` and parses portal entries. Delete the entire `if (j.contains("portals")) { ... }` block.

Verify: `grep -n "PortalData\|data.portals" src/engine/scene_loader.cpp` returns no matches.

- [ ] **Step 3: Delete portal serialization in `scene_loader.cpp`**

In `src/engine/scene_loader.cpp`, find the block around line 1192 that starts with `if (!data.portals.empty())` in `to_json`. Delete the entire `if` block.

- [ ] **Step 4: Delete `portals` field from scene_objects**

In `include/gseurat/engine/scene_objects.hpp` (find with `grep -rn "struct SceneObjects\|portals" include/gseurat/engine/scene_objects.hpp`), find and delete the `std::vector<PortalData> portals;` field.

- [ ] **Step 5: Delete `scene_objects.portals = ...` assignments**

In `src/staging/staging_app.cpp` line 73, delete:

```cpp
    scene_objects_.portals = scene_data.portals;
```

In `src/engine/command_dispatcher.cpp` line 367, delete:

```cpp
            ctx_.scene_objects.portals = scene_data.portals;
```

- [ ] **Step 6: Build to confirm scene_loader compiles**

Run: `cmake --build build/macos-debug --target gseurat_core 2>&1 | tail -10`
Expected: build progresses. There may still be errors from later tasks (demo, staging) referencing other removed things — that's fine; we're checking that scene_loader itself is clean.

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/engine/scene_loader.hpp src/engine/scene_loader.cpp \
        include/gseurat/engine/scene_objects.hpp \
        src/staging/staging_app.cpp src/engine/command_dispatcher.cpp
git commit -m "refactor: remove scene-level PortalData from SceneLoader (dead data)"
```

---

### Task 4: Remove `Gizmo: Portals` from dev overlay

**Files:**
- Modify: `include/gseurat/engine/dev_overlay.hpp`
- Modify: `src/engine/dev_overlay.cpp`
- Modify: `src/staging/staging_state.cpp`

`show_gizmo_portals` was only consumed by staging's now-defunct world-portal renderer. Already redundant with `View > Gizmo: Triggers` (which shows portal triggers in orange post-PR #264).

- [ ] **Step 1: Delete `show_gizmo_portals` field from header**

In `include/gseurat/engine/dev_overlay.hpp`, delete the line:

```cpp
    bool show_gizmo_portals = true;
```

(Search for it; should be near other `show_gizmo_*` fields around line 47.)

- [ ] **Step 2: Delete View menu item + All-On/All-Off references**

In `src/engine/dev_overlay.cpp`, find and delete:

```cpp
            ImGui::MenuItem("Gizmo: Portals", nullptr, &show_gizmo_portals);
```

(around line 154)

In the All-On block (around line 162):

```cpp
                show_gizmo_camera_zones = show_gizmo_portals = show_gizmo_world = show_gizmo_collision = true;
```

remove `show_gizmo_portals = ` so it becomes:

```cpp
                show_gizmo_camera_zones = show_gizmo_world = show_gizmo_collision = true;
```

In the All-Off block (around line 168), do the same:

```cpp
                show_gizmo_camera_zones = show_gizmo_world = show_gizmo_collision = false;
```

- [ ] **Step 3: Delete the staging `if (ov.show_gizmo_portals)` block**

In `src/staging/staging_state.cpp` around line 1078, find and delete the entire `if (ov.show_gizmo_portals) { ... }` block. (It iterates `manifest.portals` which no longer exists anyway — would not compile if left in.)

- [ ] **Step 4: Delete the staging `PORTAL_ENTERED` event handler**

In `src/staging/staging_state.cpp` around line 566, find and delete the `case WorldStreamer::StreamEvent::PORTAL_ENTERED:` case (and its body up to the next `break;`). The enum value is gone, so this won't compile.

- [ ] **Step 5: Build**

Run: `cmake --build build/macos-debug --target gseurat_core gseurat_staging 2>&1 | tail -10`
Expected: build succeeds for `gseurat_core` and `gseurat_staging`.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/dev_overlay.hpp src/engine/dev_overlay.cpp src/staging/staging_state.cpp
git commit -m "refactor: remove dev overlay 'Gizmo: Portals' (now covered by Gizmo: Triggers)"
```

---

### Task 5: Remove `spawn_world_portal_entities` from demo

**Files:**
- Modify: `include/gseurat/demo/island_demo_state.hpp`
- Modify: `src/demo/island_demo_state.cpp`

The demo's runtime conversion of world.json portals → ECS entities is no longer needed because portals come from scene.json `game_objects[]` via the standard scene-load path.

- [ ] **Step 1: Delete `spawn_world_portal_entities` declaration from header**

In `include/gseurat/demo/island_demo_state.hpp`, find and delete:

```cpp
    /// Spawn ECS Game Object entities for every portal in the world.json manifest.
    /// Called from on_enter (initial) and from perform_portal_transition (after
    /// world.clear() wipes the previous portal entities).
    void spawn_world_portal_entities(AppBase& app);
```

- [ ] **Step 2: Delete the method body in `island_demo_state.cpp`**

In `src/demo/island_demo_state.cpp`, find and delete the entire method:

```cpp
void IslandDemoState::spawn_world_portal_entities(AppBase& app) {
    if (!world_streamer_) return;
    for (const auto& portal : world_streamer_->manifest().portals) {
        ...
        std::fprintf(stderr, "[IslandDemo] Portal '%s' -> '%s' as ECS entity at (%.1f,%.1f,%.1f) r=%.1f\n",
            ...);
    }
}
```

(Search for `void IslandDemoState::spawn_world_portal_entities`.)

- [ ] **Step 3: Delete both call sites**

In `src/demo/island_demo_state.cpp`, find and delete the call in `on_enter`:

```cpp
            // Spawn ECS portal entities for the initial scene.
            // (perform_portal_transition will re-spawn them after future scene swaps.)
            spawn_world_portal_entities(app);
```

Find and delete the call in `perform_portal_transition`:

```cpp
    // Re-spawn ECS portal entities. The world.clear() above wiped the previous
    // ones, so the destination scene would have NO exit portals without this.
    // World.json portals are global to the manifest — both the dungeon's exit
    // (at world coords 45,0,42) and the overworld's entry (at 203,3,175) get
    // re-created. Spatial separation ensures only the geographically-relevant
    // one fires for the player's current position.
    spawn_world_portal_entities(app);
```

Also delete unused includes if any are now orphaned. Check:

```
grep -n "PortalTarget\|portal_target.hpp" src/demo/island_demo_state.cpp
```

If `portal_target.hpp` is no longer used in this file, delete the `#include "gseurat/engine/ecs/components/portal_target.hpp"` line. (It WILL still be needed if other code in the file references PortalTarget — verify before removing.)

- [ ] **Step 4: Build the demo**

Run: `cmake --build build/macos-debug --target gseurat_demo 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/demo/island_demo_state.hpp src/demo/island_demo_state.cpp
git commit -m "refactor: remove demo's spawn_world_portal_entities (portals come from scene.json now)"
```

---

### Task 6: Migrate the 2 demo portals into scene.json

**Files:**
- Modify: `examples/island_demo/assets/scenes/seurat_island.json`
- Modify: `examples/island_demo/assets/scenes/dungeon.json`

Hand-migrate the 2 existing world.json portals into the appropriate scene.json `game_objects[]` arrays.

- [ ] **Step 1: Add `portal_dungeon` Game Object to `seurat_island.json`**

In `examples/island_demo/assets/scenes/seurat_island.json`, find the `"game_objects": [` line. Insert a new object as the FIRST element of the array (right after the `[`):

```json
    {
      "id": "portal_dungeon",
      "name": "Portal to Dungeon",
      "position": [203, 3, 175],
      "scale": 1.0,
      "components": {
        "ProximityTrigger": { "radius": 5.0, "one_shot": true },
        "PortalTarget": {
          "target_scene": "assets/scenes/dungeon.json",
          "target_position": [5, 0, 5],
          "fade_color": [1, 1, 1],
          "fade_duration": 0.5
        }
      }
    },
```

(Don't forget the trailing comma — it precedes the next existing Game Object.)

Verify JSON is valid:

```bash
python3 -c "import json; json.load(open('examples/island_demo/assets/scenes/seurat_island.json')); print('OK')"
```

Expected: `OK`.

- [ ] **Step 2: Add `portal_dungeon_exit` Game Object to `dungeon.json`**

In `examples/island_demo/assets/scenes/dungeon.json`, find `"game_objects": [`. Insert at the start of the array:

```json
    {
      "id": "portal_dungeon_exit",
      "name": "Portal Back to Overworld",
      "position": [45, 0, 42],
      "scale": 1.0,
      "components": {
        "ProximityTrigger": { "radius": 5.0, "one_shot": true },
        "PortalTarget": {
          "target_scene": "assets/scenes/seurat_island.json",
          "target_position": [192, 3, 197],
          "fade_color": [1, 1, 1],
          "fade_duration": 0.5
        }
      }
    },
```

If `dungeon.json` does NOT have a `game_objects` array, add one:

```json
  "game_objects": [
    {
      ... portal here ...
    }
  ],
```

Verify:

```bash
python3 -c "import json; json.load(open('examples/island_demo/assets/scenes/dungeon.json')); print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Sync assets to build directory**

Run: `cmake --build build/macos-debug --target sync_assets 2>&1 | tail -3`
Expected: assets sync.

- [ ] **Step 4: Commit**

```bash
git add examples/island_demo/assets/scenes/seurat_island.json examples/island_demo/assets/scenes/dungeon.json
git commit -m "demo: migrate 2 world.json portals into scene.json game_objects"
```

---

### Task 7: Remove `portals[]` and `instances[]` from `world.json`

**Files:**
- Modify: `examples/island_demo/world.json`
- Modify: `schemas/world.schema.json`

- [ ] **Step 1: Delete `portals[]` and `instances[]` from world.json**

In `examples/island_demo/world.json`, find the `"portals": [` array and the `"instances": [` array. Delete both arrays entirely (including their content). Also remove the trailing comma from the preceding `"streaming_volumes"` entry if needed to keep valid JSON.

Verify:

```bash
python3 -c "import json; m=json.load(open('examples/island_demo/world.json')); print('keys:', list(m.keys()))"
```

Expected: `keys: ['version', 'grid_cell_size', 'chunks', 'streaming_volumes']` (no `portals` or `instances`).

- [ ] **Step 2: Delete `portals` and `instances` definitions from schema**

In `schemas/world.schema.json`, find the `"portals"` property in the schema's `properties` object and delete it. Same for `"instances"`. Also remove `"portals"` and `"instances"` from any `"required"` array (likely not in required — they're optional).

Verify the schema parses:

```bash
python3 -c "import json; s=json.load(open('schemas/world.schema.json')); print('schema OK, props:', list(s['properties'].keys()))"
```

Expected output should not include `portals` or `instances`.

- [ ] **Step 3: Sync assets**

Run: `cmake --build build/macos-debug --target sync_assets 2>&1 | tail -3`

- [ ] **Step 4: Smoke test demo launch**

Run:
```
cd build/macos-debug && timeout 8 ./gseurat_demo 2>&1 | grep -E "WARNING|portal|Portal|fatal" | head -10
```
Expected: NO warnings about deprecated `portals` (since world.json no longer has them). Demo loads without errors. Portal Game Objects spawn from scene.json (look for them as ECS entities — but no log line is needed since the engine doesn't print individual entity spawns).

- [ ] **Step 5: Commit**

```bash
git add examples/island_demo/world.json schemas/world.schema.json
git commit -m "demo: remove world.json portals[] and instances[] arrays"
```

---

### Task 8: Remove portal types from Bricklayer's TypeScript world schema

**Files:**
- Modify: `tools/packages/project-root/src/world.ts`

- [ ] **Step 1: Delete `WorldPortalData` and `WorldInstance` types**

In `tools/packages/project-root/src/world.ts`, find and delete:

```typescript
export interface WorldPortalData {
  ...
}

export interface WorldInstance {
  ...
}
```

In the `WorldManifest` interface, delete:

```typescript
  portals: WorldPortalData[];
  instances?: WorldInstance[];
```

(or whichever exact field declarations appear — match the file's existing style.)

- [ ] **Step 2: Build the TypeScript packages**

Run: `cd tools && pnpm --filter @gseurat/project-root build 2>&1 | tail -5`
Expected: TypeScript compiles cleanly. (May fail in dependent packages — those get fixed in the next task.)

- [ ] **Step 3: Commit**

```bash
git add tools/packages/project-root/src/world.ts
git commit -m "refactor(ts): remove WorldPortalData and WorldInstance types"
```

---

### Task 9: Remove portal store APIs from Bricklayer

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useWorldStore.ts`
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`

- [ ] **Step 1: Delete World-mode portal API**

In `tools/apps/bricklayer/src/store/useWorldStore.ts`:

Remove `WorldPortalData` from the `import` line at the top of the file.

Remove `'world_portal'` from the `selectedEntity.type` union (around line 11):

```typescript
  type: 'chunk' | 'streaming_volume' | 'world_portal';
```

becomes:

```typescript
  type: 'chunk' | 'streaming_volume';
```

Delete the action declarations (around lines 32-34):

```typescript
  addPortal: () => void;
  updatePortal: (id: string, patch: Partial<WorldPortalData>) => void;
  removePortal: (id: string) => void;
```

Delete `let nextPortalId = 1;` (around line 47).

Delete the `addPortal`, `updatePortal`, `removePortal` implementations (around lines 142-182).

- [ ] **Step 2: Delete scene-mode portal API**

In `tools/apps/bricklayer/src/store/useSceneStore.ts`:

Remove `PortalData` from the `import` line at the top of the file.

Delete the field `portals: PortalData[];` (around line 239).

Delete the action declarations (around lines 312-314):

```typescript
  addPortal: (position?: [number, number, number]) => void;
  updatePortal: (id: string, patch: Partial<PortalData>) => void;
  removePortal: (id: string) => void;
```

Delete the initializer `portals: [],` (line 517).

Delete the `addPortal`, `updatePortal`, `removePortal` implementations (around lines 735-752).

Delete the second `portals: [],` (around line 1251 — likely in a reset/clear function).

Verify no lingering portal references in either store:

```bash
grep -n "portal\|Portal" tools/apps/bricklayer/src/store/useWorldStore.ts tools/apps/bricklayer/src/store/useSceneStore.ts
```

Expected: no matches.

- [ ] **Step 3: Build**

Run: `cd tools && pnpm --filter @gseurat/bricklayer build 2>&1 | tail -10`
Expected: build fails because UI components still reference removed APIs. That's fine — next tasks fix those.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/store/useWorldStore.ts tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "refactor(bricklayer): remove portal actions from world+scene stores"
```

---

### Task 10: Remove Bricklayer World-mode portal UI

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx`
- Modify: `tools/apps/bricklayer/src/panels/WorldTree.tsx`
- Delete: `tools/apps/bricklayer/src/viewport/PortalMarkers.tsx`
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx`
- Modify: `tools/apps/bricklayer/src/viewport/WorldViewport.tsx`
- Modify: `tools/apps/bricklayer/src/App.tsx`

- [ ] **Step 1: Delete `PortalEditor` component from `WorldPropertiesPanel.tsx`**

In `tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx`, find and delete:

```tsx
// ── Portal Editor ──

function PortalEditor({ id }: { id: string }) {
  ...
}
```

(The whole function definition — search for `function PortalEditor`.)

Find and delete the conditional render (around line 311):

```tsx
      {selectedEntity?.type === 'world_portal' && (
        <PortalEditor id={selectedEntity.id} />
      )}
```

- [ ] **Step 2: Delete portal section from `WorldTree.tsx`**

In `tools/apps/bricklayer/src/panels/WorldTree.tsx`, find and delete the lines that pull `addPortal` and `removePortal` from the store (around lines 86-87):

```tsx
  const addPortal = useWorldStore((s) => s.addPortal);
  const removePortal = useWorldStore((s) => s.removePortal);
```

Find and delete the entire Global Portals section (around line 181-end-of-portal-block). Search for `Global Portals` and delete the surrounding `<div>` / `<section>` / map iteration.

- [ ] **Step 3: Delete `PortalMarkers.tsx`**

```bash
rm tools/apps/bricklayer/src/viewport/PortalMarkers.tsx
```

- [ ] **Step 4: Remove `PortalMarkers` from `Viewport.tsx`**

In `tools/apps/bricklayer/src/viewport/Viewport.tsx`:

Delete the import:

```tsx
import { PortalMarkers } from './PortalMarkers.js';
```

Delete the JSX usage:

```tsx
      <PortalMarkers />
```

(around line 304)

Delete `sel.type === 'portal'` cases (around lines 124, comment line 108):

```tsx
  // portal: always Y=0
```

Delete:

```tsx
  } else if (sel.type === 'portal') {
    store.updatePortal(sel.id, { position: [x, y, z] });
```

(Make sure to keep the `} else if (...)` chain syntactically valid after removal.)

- [ ] **Step 5: Remove portal rendering from `WorldViewport.tsx`**

In `tools/apps/bricklayer/src/viewport/WorldViewport.tsx`, find and delete the entire `{/* Global Portals */}` block (around lines 167-196):

```tsx
      {/* Global Portals */}
      {manifest.portals.map((portal) => {
        const isSelected = selectedEntity?.type === 'world_portal' && selectedEntity.id === portal.id;
        ...
        );
      })}
```

- [ ] **Step 6: Remove portal cases from `App.tsx`**

In `tools/apps/bricklayer/src/App.tsx`:

Delete the line (around 362):

```tsx
          else if (sel.type === 'portal') store.updatePortal(sel.id, { position: pos });
```

Delete the block (around 397-399):

```tsx
          } else if (sel.type === 'portal') {
            const portal = store.portals.find((p) => p.id === sel.id);
            if (portal) pos = [...portal.position];
```

Delete the similar block around 453-455.

(After deletion, surrounding `if/else if` chains should still be syntactically valid. Verify by reading the surrounding ±5 lines after each deletion.)

- [ ] **Step 7: Build**

Run: `cd tools && pnpm --filter @gseurat/bricklayer build 2>&1 | tail -10`
Expected: builds cleanly.

If it fails with "no exported member" or "property does not exist", grep for any remaining `portal`/`Portal` references in `tools/apps/bricklayer/src/`:

```bash
grep -rn "portal\|Portal" tools/apps/bricklayer/src/ | grep -v node_modules | grep -v __tests__
```

Address any remaining hits.

- [ ] **Step 8: Run Bricklayer tests**

Run: `cd tools && pnpm --filter @gseurat/bricklayer test 2>&1 | tail -10`
Expected: tests pass (any failing tests likely test the removed portal UI; either delete those tests or update them).

- [ ] **Step 9: Commit**

```bash
git add tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx \
        tools/apps/bricklayer/src/panels/WorldTree.tsx \
        tools/apps/bricklayer/src/viewport/Viewport.tsx \
        tools/apps/bricklayer/src/viewport/WorldViewport.tsx \
        tools/apps/bricklayer/src/App.tsx
git rm tools/apps/bricklayer/src/viewport/PortalMarkers.tsx
git commit -m "refactor(bricklayer): remove World-mode portal UI (PortalEditor, PortalMarkers, etc.)"
```

---

### Task 11: Full build, test sweep, manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full ctest run**

```
cmake --build build/macos-debug --target test_transition_system test_world_manifest test_world_streamer test_gaussian_cloud test_scene_loading 2>&1 | tail -5
ctest --test-dir build/macos-debug --output-on-failure 2>&1 | tail -5
```

Expected: All tests pass. If `test_world_manifest` or `test_world_streamer` had assertions about portals, they need updating (delete portal-related test cases).

- [ ] **Step 2: Build the demo and smoke-test**

```
cmake --build build/macos-debug --target gseurat_demo
cd build/macos-debug && timeout 8 ./gseurat_demo 2>&1 | grep -E "WARNING|fatal|portal|Portal" | head -10
```

Expected: no WARNING about deprecated portals (since world.json no longer has them). No fatal. Demo runs.

- [ ] **Step 3: Manual playtest the round-trip**

Run interactively: `cd build/macos-release && cmake --build .. --target gseurat_demo && ./gseurat_demo`

Expected behavior:
- In overworld, walk to (203, 3, 175) — orange portal gizmo visible (now sourced from scene.json).
- Walking into it triggers fade-out → dungeon load → fade-in. (Same as PR #264; this PR shouldn't change runtime behavior.)
- In dungeon, walk to (45, 0, 42) — orange portal gizmo visible (sourced from dungeon.json).
- Triggers fade-out → overworld load → fade-in.

If anything regresses, check: did the position values transfer correctly through the GridPos → WorldPos conversion? (See spec Section "Coordinate System Note".)

- [ ] **Step 4: Final commit**

If the previous tasks left any cleanup or doc updates, commit them. Otherwise this task is verification-only.

```bash
git status   # ensure no uncommitted changes
git log main..HEAD --oneline   # review all commits
```

---

## Out of Scope

- Adding portal-creation hints to Bricklayer's Game Object UI. The existing component palette already supports `PortalTarget`; no special UI needed.
- Renaming `world.json` (still useful for chunks + streaming volumes).
- Adding `region_shape: "box"` support to `ProximityTrigger`. Existing portals all use sphere; box shapes can be a future component if needed.
- Adding `spawn_facing` to `PortalTarget`. Default facing is fine for the existing portals.
- Migrating the `WorldInstance` mechanism to a different system. It's only used for portal target lookup; deleting it is the simplification.
