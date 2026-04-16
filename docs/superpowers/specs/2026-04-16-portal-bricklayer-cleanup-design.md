# Bricklayer Portal Cleanup: Migrate Portals to Game Objects

## Problem

PR #264 migrated runtime portals to ECS components (`ProximityTrigger + PortalTarget` on Game Objects). But the **authoring path is still the legacy one**: Bricklayer's portal UI writes `world.json portals[]`, which the engine then auto-converts to ECS at scene load.

Result: two parallel portal data formats, two UI flows for the same concept, and one runtime workaround (`spawn_world_portal_entities`) that re-creates portal entities after every scene transition because world.json portals are "global."

## Solution

Single source of truth: scene.json `game_objects[]` with `ProximityTrigger + PortalTarget` components. Designers author portals through Bricklayer's existing Game Object editor (the same UI used for any other interactive object). World.json shrinks to chunks + streaming volumes only.

## Architecture

```
BEFORE                                    AFTER
─────────────────────────                ─────────────────────────
world.json                               world.json
  chunks[]                                 chunks[]
  streaming_volumes[]                      streaming_volumes[]
  portals[]    ────────┐                   (no portals)
  instances[]  ────────┤                   (no instances)
                       │
                       │  spawn_world_portal_entities()
                       │  resolves instance_id → scene_file
                       │  creates ECS Game Object with
                       │  ProximityTrigger + PortalTarget
                       ▼
                ECS Game Object                          ECS Game Object
                                                            ▲
                                                            │ scene_loader normal path
                                                            │
                                                         scene.json
                                                           game_objects[]
                                                             - ProximityTrigger
                                                             - PortalTarget
```

## Components

### What gets deleted

**Engine C++:**
- `WorldPortal` struct + `WorldManifest::portals[]` + `WorldManifest::instances[]` (in `world_manifest.hpp/cpp`)
- `WorldStreamer::entered_portal_id()` + portal-region detection in `update()` (already dead code)
- Portal serialize/deserialize in `scene_loader.cpp`
- World.json schema entries for `portals` and `instances` (in `schemas/world.schema.json`)

**Demo C++:**
- `IslandDemoState::spawn_world_portal_entities()` and the call to it from both `on_enter` and `perform_portal_transition`
- Includes/declarations no longer needed after deletion

**Dev overlay (engine):**
- `show_gizmo_portals` field in `dev_overlay.hpp`
- `View > Gizmo: Portals` menu item in `dev_overlay.cpp`
- All `show_gizmo_portals` references in the All-On / All-Off shortcuts

**Staging C++:**
- The `if (ov.show_gizmo_portals)` block in `staging_state.cpp:1078` (no portals in WorldManifest to draw)

**Bricklayer TypeScript:**
- `PortalEditor` in `panels/WorldPropertiesPanel.tsx`
- Portal add/remove buttons in `panels/WorldTree.tsx`
- `viewport/PortalMarkers.tsx` (file deleted)
- Portal usage in `viewport/WorldViewport.tsx`
- `addPortal/updatePortal/removePortal` actions + `portals` state in `store/useWorldStore.ts`
- `WorldPortalData` + `WorldInstance` types in `tools/packages/project-root/src/world.ts`
- Portal `selectedEntity` type from world-mode selection state

### What gets added

**Demo data (one-time migration):**

`examples/island_demo/assets/scenes/seurat_island.json` gains a Game Object:

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
}
```

`examples/island_demo/assets/scenes/dungeon.json` gains a Game Object:

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
}
```

`examples/island_demo/world.json` loses `portals[]` and `instances[]`.

### Backward-compat soft warning

When loading any `world.json` that still has `portals` or `instances`, log a one-line deprecation warning to stderr. No hard failure — the data is silently dropped. This catches stragglers if anyone has a custom world.json file lying around.

```cpp
if (j.contains("portals")) {
    std::fprintf(stderr,
        "[world.json] WARNING: 'portals' field is deprecated. "
        "Author portals as Game Objects with ProximityTrigger + PortalTarget components in scene.json.\n");
}
if (j.contains("instances")) {
    std::fprintf(stderr,
        "[world.json] WARNING: 'instances' field is deprecated and unused.\n");
}
```

## Coordinate System Note

`scene.json game_objects[].position` is `coord::GridPos` (the scene loader adds `terrain_aabb.min` to convert to world coords).
`world.json portals[].position` was direct `coord::WorldPos`.

For both demo scenes, the terrain AABB.min is at or very near `(0, 0, 0)` (verified by reading existing tree positions in `seurat_island.json` — they match their world-space rendered locations). So the portal positions transfer 1:1 from world.json to scene.json `game_objects[]` without recalculation.

If implementation reveals an offset, the migration values get adjusted then. Acceptance test: walking to the portal position in the demo triggers the fade.

## Data Flow

After migration:

```
1. SceneLoader::load("seurat_island.json")
   → SceneData.game_objects[] includes the portal Game Object
2. AppBase::load_gs_scene(scene_data, ...)
   → For each game_object with components:
       world.create() + add<Transform>(...)
       For each component name:
         component_registry.attach(world, entity, name, json)
         → ProximityTrigger and PortalTarget are attached
3. proximity_trigger_system → portal_trigger_handler → transition_system
   (unchanged from PR #264)
```

No special-case "world.json portal" code path anywhere.

## Testing

**Unchanged:**
- `test_transition_system` (13 tests) — runtime contract is identical
- `test_world_manifest` — still validates chunks + streaming_volumes; portal/instance assertions removed

**New:**
- A small unit test in `test_world_manifest` that loading a `world.json` containing `portals[]` triggers a deprecation warning to stderr (capture stderr, assert substring). Optional but cheap.

**Manual:**
- Run `gseurat_demo`, walk into the dungeon portal in the overworld, confirm fade-out → dungeon scene → portal_dungeon_exit visible in the dungeon → walk into it → fade back to overworld.
- Open Bricklayer in World mode — the portal editor and PortalMarkers should be gone; UI shouldn't have any "add portal" button.
- Open Bricklayer in Scene mode — placing a Game Object with `ProximityTrigger + PortalTarget` components should work via the existing component palette (no UI changes needed there).

## Risks

1. **Bricklayer rendering**: World viewport currently renders portal markers (`<PortalMarkers />` JSX). After deletion, World mode just shows chunks + streaming volumes. Confirm no JSX references break.
2. **Scene editor in Bricklayer**: Verify that `PortalTarget` is in the auto-discovered component list (component schemas live under `examples/island_demo/assets/components/portal_target.schema.json`, added in PR #264).
3. **WASM simulation**: If the WASM particle simulator depends on `WorldManifest` shape, removing fields could break it. The Explore report didn't flag any dependency, but worth checking during implementation.
4. **Build artifacts**: The `build/macos-*/world.json` files are stale copies; they get regenerated by `sync_assets`. No manual cleanup needed.

## Files Touched (estimate)

| Layer | Files | LoC delta |
|-------|-------|-----------|
| Engine C++ | `world_manifest.hpp/cpp`, `world_streamer.hpp/cpp`, `scene_loader.hpp/cpp`, `dev_overlay.hpp/cpp` | -150 |
| Demo C++ | `island_demo_state.cpp`, `island_demo_state.hpp` | -55 |
| Staging C++ | `staging_state.cpp` | -10 |
| Schemas | `schemas/world.schema.json` | -30 |
| Bricklayer TS | `WorldPropertiesPanel.tsx`, `WorldTree.tsx`, `PortalMarkers.tsx` (delete), `WorldViewport.tsx`, `useWorldStore.ts`, `tools/packages/project-root/src/world.ts`, App.tsx | -250 |
| Demo data | `world.json`, `seurat_island.json`, `dungeon.json` | -25, +50 |

Net: ~-470 lines (deletion-heavy), 1 file deleted.

## Out of Scope

- Adding new portal-specific UI affordances in Scene mode (portals use the same Game Object UI as any other component-bearing object — that's the design).
- Migrating `WorldInstance` to a different system. It's only used for portal target lookup; deleting it is the simplification.
- Renaming `world.json` (still useful for chunks + streaming volumes).
- Adding `region_shape: "box"` support to `ProximityTrigger`. Existing portals all use sphere; box shapes can be a future component if needed.
- Adding `spawn_facing` to `PortalTarget`. Default facing is fine for the existing portals.
