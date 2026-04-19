# Bricklayer World Orchestrator Refactoring Design

**Date:** 2026-04-18
**Goal:** Transform Bricklayer from a terrain/voxel editor into a pure World Orchestrator and Scene Assembler. Terrain creation stays in Echidna/external tools; Bricklayer reads `.ply` files as read-only visual references for placing GameObjects, Portals, and Streaming Volumes.

## Motivation

Bricklayer currently has four modes (WORLD, TERRAIN, SCENE, SETTINGS). The TERRAIN mode duplicates functionality that belongs in Echidna (voxel editing, collision painting). The WORLD and SCENE modes are disconnected — clicking a chunk in WORLD doesn't load its scene. This refactoring unifies world and scene management into a single coherent workflow.

## Phased Approach

Three independent phases, each producing working software:

1. **Schema Evolution** — Extend `WorldManifest`, clean up `BricklayerFile`
2. **Unified Navigation Tree + Context Switching** — New UI paradigm
3. **Terrain Tab Removal** — Delete voxel editing, clean up dead code

---

## Phase 1: Schema Evolution

### WorldManifest Extensions

Add `instances[]` and `portals[]` to `WorldManifest` in `tools/packages/project-root/src/world.ts`:

```typescript
interface InstanceData {
  id: string;
  display_name: string;
  scene_file: string;
}

interface PortalData {
  id: string;
  display_name: string;
  position: [number, number, number];
  half_extents: [number, number, number];
  source_chunk: string;        // grid key "x,y,z" of the chunk this portal sits in
  target_instance: string;     // instance ID to teleport into
  target_spawn: [number, number, number]; // spawn point inside instance
}
```

Updated manifest:
```json
{
  "version": 1,
  "grid_cell_size": [192.0, 64.0, 192.0],
  "chunks": [...],
  "instances": [
    { "id": "dungeon_01", "display_name": "Tavern Interior", "scene_file": "assets/scenes/tavern.json" }
  ],
  "streaming_volumes": [...],
  "portals": [
    {
      "id": "portal_tavern_entrance",
      "display_name": "Tavern Door",
      "position": [50.0, 0.0, 30.0],
      "half_extents": [1.0, 2.0, 0.5],
      "source_chunk": "0,0,0",
      "target_instance": "dungeon_01",
      "target_spawn": [0.0, 0.0, 0.0]
    }
  ]
}
```

### BricklayerFile Cleanup

Remove `instances?: InstanceData[]` from `BricklayerFile.scene` in `types.ts`. Instance ownership moves to `world.json`.

### Store Updates

- `useWorldStore` gains CRUD actions for instances and portals
- `projectIO.ts` already reads/writes `world.json` — no structural change needed (new fields are part of `WorldManifest`)
- `createEmptyManifest()` updated to include empty `instances` and `portals` arrays

---

## Phase 2: Unified Navigation Tree + Context Switching

### New Mode System

Replace 4-mode tabs (`terrain | scene | settings | world`) with 2-mode system:

- **WORLD view** — Macroscopic: chunk wireframes, portals, streaming volumes, global placement
- **SCENE view** — Microscopic: loaded chunk/instance scene with GameObjects, lights, VFX, camera zones

SETTINGS becomes a panel/dialog within SCENE view, not a separate mode.

### Master Navigation Tree (Left Panel)

```
WORLD (world.json)
  Chunks
    [0, 0, 0] seurat_island
    [0, 0, -1] northern_forest
  Instances
    dungeon_01 — Tavern Interior
    cave_02 — Crystal Cave
  Streaming Volumes
    dungeon_approach
    forest_approach
  Portals
    portal_tavern_entrance — Tavern Door
```

Clicking a Chunk or Instance loads its `scene_file` and switches to SCENE view. Clicking WORLD root or Streaming Volumes/Portals stays in WORLD view.

### Context Switching

When switching between chunks/instances:
1. Check `useSceneStore.isDirty` — prompt save if dirty
2. Clear current scene store state
3. Load new scene's `.bricklayer` file into `useSceneStore`
4. Switch viewport to scene mode
5. Apply coordinate offset for chunks (global grid offset), or origin `[0,0,0]` for instances

### Viewport Behavior

- **WORLD view:** `WorldViewport` — chunk wireframes, portal gizmos, streaming volume gizmos
- **SCENE view:** Existing `Viewport` — GameObjects, lights, PLY reference mesh (read-only), VFX, camera zones

---

## Phase 3: Terrain Tab Removal

### Delete

- `TerrainLeftPanel.tsx` — voxel tools, palettes, brush controls
- `TerrainRightPanel.tsx` — voxel stats
- `CollisionLeftPanel.tsx` — collision painting
- `VoxelMesh.tsx` — voxel geometry rendering
- `GhostVoxel.tsx` — preview voxel during placement
- `CollisionOverlay.tsx` — collision grid display
- All voxel-related state from `useSceneStore`: `voxels`, `activeTool`, `activeColor`, `brushSize`, `yLevelLock`, `yClipMin/Max`, `mirrorX/Z`, `collisionGridData`, `collisionLayer`, `collisionHeight`, `activeNavZone`, `undoStack`, `redoStack`
- All voxel actions: `placeVoxel`, `paintVoxel`, `eraseVoxel`, `fillVoxels`, `extrudeVoxels`, `eyedrop`, collision actions

### Deprecate in BricklayerFile

- `voxels[]` — no longer written; ignored on load (back-compat)
- `collisionGridData` — no longer written; ignored on load
- `collision` (legacy string array) — already deprecated

### Keep

- `GameObjectMarkers`, `LightGizmos`, `PlayerMarker`, `VfxInstanceMarkers`, `CameraZoneMarkers`, etc. — all scene placement visuals remain

---

## Portal Rules (Single Source of Truth)

1. **World -> Instance (Global Portals):** Owned entirely by `world.json` `portals[]`. Placed and rendered in WORLD view using global coordinates. Similar to StreamingVolumes but trigger context switch + teleport.

2. **Instance -> World (Local Exit Portals):** Standard GameObjects with `PortalTarget` component inside the instance's local `scene_file`. The global world is unloaded during instance editing, so exit portals must be local.

This eliminates hybrid sync issues — no split-state between `world.json` and scene files.

---

## Data Not Recoverable After Terrain Removal

| Data | Reason |
|---|---|
| Voxel geometry | PLY files from Echidna are the source of truth |
| Collision grid | Will be generated from PLY heightmaps or authored in Echidna |
| Undo/redo history | Only applied to voxel operations |
| Color palettes | Echidna manages color palettes |
