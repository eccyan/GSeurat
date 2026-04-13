# Phase 3: Seamless Streaming for Vast Maps — Design Spec

## Goal

Transform GSeurat from a single-room renderer into an open-world streaming engine. Introduce spatial partitioning via `world.json`, Streaming Volumes in Bricklayer, and GPU frustum culling in the Staging engine so that the O(N) radix sort stays fast with millions of resident splats.

## Architecture Overview

Three distinct subsystems, built sequentially:

1. **World Manifest & Spatial Partitioning** — `world.json` schema, `@gseurat/project-root` types, Bricklayer WORLD mode with proxy rendering
2. **Streaming Volumes** — New scene component in Bricklayer for triggering async chunk/instance loads
3. **GPU Frustum Culling Pre-pass** — Shader-level per-splat frustum test in `gs_preprocess.comp`

### Key Architectural Distinction: Chunks vs Instances

- **Chunks** are tiles in a global coordinate system. They render simultaneously side-by-side. Loaded/unloaded automatically by camera distance (spatial streaming). Each chunk is a raw PLY file + optional per-chunk scene JSON for local entities.
- **Instances** (from Phase 2) are isolated environments in their own local coordinate system (centered at origin). Entered via Portals (event-driven). The player leaves the open world context entirely when entering an Instance.

This separation is critical: Chunks are spatial, Instances are event-driven. They must not be conflated.

---

## Requirement 1: `world.json` Schema & Bricklayer World Context

### 1.1 `world.json` Schema

```json
{
  "version": 1,
  "grid_cell_size": [64.0, 32.0, 64.0],
  "chunks": [
    {
      "grid": [0, 0, 0],
      "ply_file": "assets/maps/chunk_0_0_0.ply",
      "scene_file": "assets/scenes/chunk_0_0_0.json"
    }
  ],
  "streaming_volumes": [
    {
      "id": "sv_dungeon_entrance",
      "shape": "box",
      "position": [96.0, 0.0, 48.0],
      "half_extents": [8.0, 8.0, 8.0],
      "preload_target_ids": ["dungeon_01"]
    }
  ],
  "portals": [
    {
      "id": "portal_dungeon",
      "position": [100.0, 0.0, 50.0],
      "region_shape": "sphere",
      "region_radius": 2.0,
      "target_instance_id": "dungeon_01"
    }
  ]
}
```

**Design decisions:**

- **Fixed uniform grid.** All chunks occupy the same cell size. AABB is derived (not stored):
  - `aabb_min = grid * grid_cell_size`
  - `aabb_max = aabb_min + grid_cell_size`
  - This enables O(1) camera-to-chunk lookups via integer division.
- **`grid_cell_size` is vec3** `[x, y, z]` — allows vertical stacking and non-square cells.
- **Each chunk has `ply_file` + optional `scene_file`** — PLY for GPU streaming, scene JSON for local game objects/lights/emitters. Separation of concerns: GPU data vs entity data.
- **StreamingVolumes and global Portals live in `world.json`** — not in per-chunk scene files. This is mandatory because StreamingVolumes trigger chunk loads and must be globally evaluated before any chunk is loaded. Per-chunk scene files only contain chunk-local entities.
- **Positions in `world.json` are global world coordinates** — not GridPos (since there is no single chunk's terrain AABB to convert against).

### 1.2 `@gseurat/project-root` Types

New file: `tools/packages/project-root/src/world.ts`

```typescript
export interface WorldChunk {
  grid: [number, number, number];
  ply_file: string;          // asset-relative path
  scene_file?: string;       // asset-relative path, optional
}

export interface StreamingVolumeData {
  id: string;
  shape: 'box' | 'sphere';
  position: [number, number, number];
  half_extents?: [number, number, number];  // for box
  radius?: number;                           // for sphere
  preload_target_ids: string[];              // chunk grid keys or instance IDs
}

export interface WorldPortalData {
  id: string;
  position: [number, number, number];
  region_shape: 'box' | 'sphere';
  region_radius?: number;
  region_half_extents?: [number, number, number];
  target_instance_id: string;
  spawn_position?: [number, number, number];
  spawn_facing?: string;
}

export interface WorldManifest {
  version: 1;
  grid_cell_size: [number, number, number];
  chunks: WorldChunk[];
  streaming_volumes: StreamingVolumeData[];
  portals: WorldPortalData[];
}
```

Add `world: 'world.json'` to `PROJECT_LAYOUT`.

### 1.3 Bricklayer WORLD Mode

**New top-level mode tab** alongside TERRAIN / SCENE / SETTINGS.

**Viewport (React Three Fiber):**
- Renders NO PLY data — only lightweight wireframe geometry:
  - Each chunk → colored wireframe box at derived AABB. Green = has PLY, gray = empty slot, blue = selected.
  - StreamingVolumes → semi-transparent orange wireframe (box or sphere).
  - Global Portals → cyan wireframe (consistent with existing portal markers).
  - Flat ground-plane grid showing cell boundaries.
- Free-orbit camera in global world coordinates.

**Left panel (World Tree):**
- "Chunks" section: list all chunks by grid coordinate (e.g., `[0,0,0]`). Add/remove. Select highlights in viewport.
- "Streaming Volumes" section: list with add/remove.
- "Global Portals" section: list with add/remove.

**Right panel (Properties):**
- World selected → grid_cell_size editor (vec3 NumberInput).
- Chunk selected → grid position (read-only), PLY file picker (asset registry `maps`), scene file picker (`scenes`).
- StreamingVolume selected → ID, shape dropdown, position, half_extents/radius, `preload_target_ids` multi-select.
- Portal selected → reuses existing portal property UI pattern.

**"Enter Chunk" action:**
- Double-click chunk wireframe or button in properties → switch to SCENE mode, load that chunk's `scene_file`. Store chunk grid offset so local edits save relative to chunk origin.

**Ghosted wireframes in SCENE mode:**
- When editing a specific chunk in SCENE mode, the neighboring chunk wireframes (and ground grid) remain visible as a ghosted background layer. This helps level designers align content near chunk boundaries. The wireframe data comes from `useWorldStore` and renders behind the active chunk's PLY viewport.

### 1.4 Store Architecture

- New store: `useWorldStore.ts` — manages `WorldManifest` state (chunks, streaming_volumes, portals, grid_cell_size). Save/load via FSAPI to `world.json` at project root.
- Existing `useSceneStore` continues to manage per-chunk scene data in SCENE mode.
- WORLD mode and SCENE mode are mutually exclusive viewport states (no simultaneous PLY + full wireframe rendering), but SCENE mode shows ghosted chunk wireframes as background context.

---

## Requirement 2: Streaming Volumes

### 2.1 Concept

A StreamingVolume is an invisible trigger zone placed in the global open world. When the camera/player enters the volume, the Staging engine uses Phase 2's async transfer queue to preload the referenced chunks or instances into VRAM before the player reaches them.

### 2.2 Data Model (in `world.json`)

Already defined in Section 1.1. Key fields:
- `shape`: `"box"` or `"sphere"` — consistent with portal and emitter region shapes.
- `position`: global world coordinates (vec3).
- `half_extents` / `radius`: size of the trigger zone.
- `preload_target_ids`: array of strings. Each ID is either:
  - A chunk grid key like `"0,0,0"` (comma-separated grid indices) for preloading a specific chunk.
  - An instance ID (e.g., `"dungeon_01"`) for preloading an Instance's PLY data before the player walks through the portal.

### 2.3 Bricklayer UI

Edited in WORLD mode (Section 1.3). The properties panel for a StreamingVolume:
- ID (text input, auto-generated)
- Shape dropdown (box / sphere)
- Position (vec3 NumberInput with drag-to-scrub)
- Half Extents (vec3, shown when shape=box)
- Radius (number, shown when shape=sphere)
- Preload Targets (multi-select list of chunk grid keys + instance IDs from the project)

Viewport: orange wireframe box or sphere at the volume's position/extents. Draggable gizmo for repositioning.

### 2.4 Engine-Side Evaluation (Staging)

The Staging engine:
1. Parses `world.json` at startup (or when pushed via bridge).
2. Each frame, tests camera position against all StreamingVolume shapes.
3. When camera enters a volume, calls `load_cloud_async()` for each `preload_target_id` that isn't already loaded or loading.
4. Distance-based unloading handles cleanup (chunks beyond `unload_radius` are released via `unload_cloud()`).

This is a hint system — it supplements distance-based streaming, not replaces it. Chunks within the camera's load radius are always loaded regardless of StreamingVolumes.

---

## Requirement 3: GPU Frustum Culling Pre-pass

### 3.1 Problem

With the slab allocator, VRAM may hold 10M+ resident splats across multiple loaded chunks. The radix sort processes all dispatched splats. Sorting millions of off-screen splats wastes GPU cycles.

### 3.2 Solution: Per-splat Frustum Test in `gs_preprocess.comp`

After projecting the Gaussian center to clip space `(cx, cy, cz, cw)`, test against the 6 frustum planes:

```glsl
bool frustum_visible(vec4 clip) {
    float pad = clip.w * 1.1;  // padding for splat radius bleed
    return clip.z >= -pad       // near plane
        && clip.z <= pad        // far plane  
        && clip.x >= -pad       // left
        && clip.x <= pad        // right
        && clip.y >= -pad       // bottom
        && clip.y <= pad;       // top
}
```

If culled: write sort key `0xFFFF`, skip projected buffer write, do not increment `counts_index` via atomicAdd. Culled splats sink to the end of radix sort and are skipped by the tile rasterizer.

### 3.3 Clip-Space Frustum Test (No Extra Push Constants)

The preprocess shader already receives the View-Projection matrix and projects each Gaussian center to clip space: `vec4 clip = vp * vec4(world_pos, 1.0)`. The `frustum_visible()` test operates directly on this clip-space result — no separate frustum plane extraction or additional push constant data is needed.

The `1.1` padding factor on `clip.w` accounts for splat visual extent beyond the center point, preventing popping at screen edges.

**Implementation:** Add `frustum_visible()` check after clip-space projection and before sort key write. Zero additional CPU-side work beyond what the shader already does.

### 3.4 Integration

- **Static/dynamic split preserved.** Frustum culling applies identically to both preprocess dispatches. The `counts_index` atomicAdd only increments for visible splats, so `visible_count` naturally reflects frustum-visible count.
- **No CPU-side per-splat work.** Everything is GPU-side.
- **Always-on.** No specialization constant needed — frustum culling is pure upside when streaming is active (and harmless when not). The 5 ALU ops per splat are negligible compared to radix sort cost.
- **Index-Merge compatible.** Static and dynamic layers both cull independently. The merge shader receives only visible entries from each layer.

### 3.5 Performance Expectation

When the camera faces one direction in a multi-chunk world, 50-75% of resident splats will fail the frustum test. Radix sort workload drops proportionally. The tile rasterizer also benefits since it only processes visible entries.

---

## Acceptance Criteria

1. **World Serialization:** Bricklayer can create, save, and load a `world.json` that references multiple chunk PLYs with a fixed uniform grid.
2. **Browser Memory Safety:** Bricklayer WORLD mode viewport renders only wireframe proxies — no PLY data loaded. Memory usage stays stable regardless of chunk count.
3. **Editor UI:** Users can place StreamingVolumes in WORLD mode and assign preload target IDs via the properties panel.
4. **Ghosted Context:** When editing a chunk in SCENE mode, neighboring chunk wireframes remain visible as background.
5. **GPU Frustum Culling:** In Staging, panning the camera away from a dense chunk visibly drops the active rendered splat count (verified via counts SSBO readback or perf overlay).

---

## Files Changed

### New Files
- `tools/packages/project-root/src/world.ts` — WorldManifest types
- `schemas/world.schema.json` — JSON schema for world.json
- `tools/apps/bricklayer/src/store/useWorldStore.ts` — World state management
- `tools/apps/bricklayer/src/viewport/WorldViewport.tsx` — WORLD mode viewport (wireframe grid + proxy boxes)
- `tools/apps/bricklayer/src/viewport/ChunkWireframes.tsx` — Ghosted chunk wireframes for SCENE mode
- `tools/apps/bricklayer/src/panels/WorldTree.tsx` — Left panel for WORLD mode
- `tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx` — Right panel for WORLD mode

### Modified Files
- `tools/packages/project-root/src/layout.ts` — Add `world: 'world.json'` to PROJECT_LAYOUT
- `tools/packages/project-root/src/index.ts` — Re-export world types
- `tools/apps/bricklayer/src/store/types.ts` — Reference WorldManifest types
- `tools/apps/bricklayer/src/App.tsx` (or mode switcher) — Add WORLD tab
- `shaders/gs_preprocess.comp` — Add frustum_visible() test
- `src/engine/gs_renderer.cpp` — No shader push constant changes needed (VP already available)
- `include/gseurat/engine/scene_loader.hpp` / `src/engine/scene_loader.cpp` — Parse world.json
- `src/staging/staging_state.cpp` — StreamingVolume evaluation, world loading
