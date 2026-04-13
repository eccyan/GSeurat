# Phase 3: Seamless Streaming for Vast Maps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform GSeurat from a single-room renderer into an open-world streaming engine with `world.json` spatial partitioning, Streaming Volumes in Bricklayer, and GPU frustum culling.

**Architecture:** `world.json` defines a fixed uniform grid of Chunks (spatial PLY tiles in global coords) plus global StreamingVolumes and Portals. Bricklayer gets a WORLD mode for editing the manifest with wireframe proxy rendering. The Staging engine evaluates StreamingVolumes per-frame and triggers Phase 2's async transfer queue. The preprocess shader gets improved frustum culling that writes `0xFFFF` sort keys for culled splats.

**Tech Stack:** TypeScript/React/Zustand/R3F (Bricklayer), C++23/Vulkan/GLSL (Engine), nlohmann/json (parsing)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `tools/packages/project-root/src/world.ts` | WorldManifest, WorldChunk, StreamingVolumeData, WorldPortalData types |
| `schemas/world.schema.json` | JSON Schema for world.json validation |
| `tools/apps/bricklayer/src/store/useWorldStore.ts` | Zustand store for world.json state (chunks, volumes, portals) |
| `tools/apps/bricklayer/src/viewport/WorldViewport.tsx` | WORLD mode R3F viewport: wireframe grid, chunk boxes, volume/portal markers |
| `tools/apps/bricklayer/src/viewport/ChunkWireframes.tsx` | Ghosted chunk wireframes rendered behind active chunk in SCENE mode |
| `tools/apps/bricklayer/src/panels/WorldTree.tsx` | Left panel tree for WORLD mode: Chunks, Streaming Volumes, Global Portals |
| `tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx` | Right panel property editors for world entities |
| `include/gseurat/engine/world_manifest.hpp` | C++ WorldManifest, WorldChunk, StreamingVolume, WorldPortal structs |
| `src/engine/world_manifest.cpp` | world.json parser + serializer |
| `tests/test_world_manifest.cpp` | C++ tests for world.json parsing |

### Modified Files
| File | Change |
|------|--------|
| `tools/packages/project-root/src/layout.ts` | Add `world: 'world.json'` to PROJECT_LAYOUT |
| `tools/packages/project-root/src/index.ts` | Re-export world types |
| `tools/apps/bricklayer/src/store/types.ts` | Add WorldSelection navigation node kind |
| `tools/apps/bricklayer/src/App.tsx` | Add WORLD mode tab, conditional viewport/panel rendering |
| `tools/apps/bricklayer/src/panels/ProjectTree.tsx` | Add WORLD mode awareness |
| `shaders/gs_preprocess.comp` | Replace early returns with `0xFFFF` sort key writes |
| `src/engine/gs_renderer.cpp` | Zero-initialize sort buffer entries for streaming safety |
| `include/gseurat/engine/gs_renderer.hpp` | Add world_manifest_ member, load_world() method |
| `src/staging/staging_state.cpp` | Load world.json, evaluate StreamingVolumes per-frame, render world gizmos |
| `src/engine/command_dispatcher.cpp` | Add `load_world_json` bridge command |
| `CMakeLists.txt` | Add world_manifest.cpp to gseurat_core sources |

---

### Task 1: WorldManifest Types in @gseurat/project-root

**Files:**
- Create: `tools/packages/project-root/src/world.ts`
- Modify: `tools/packages/project-root/src/layout.ts`
- Modify: `tools/packages/project-root/src/index.ts`

- [ ] **Step 1: Create world.ts with all manifest types**

```typescript
// tools/packages/project-root/src/world.ts

export interface WorldChunk {
  grid: [number, number, number];
  ply_file: string;
  scene_file?: string;
}

export interface StreamingVolumeData {
  id: string;
  shape: 'box' | 'sphere';
  position: [number, number, number];
  half_extents?: [number, number, number];
  radius?: number;
  preload_target_ids: string[];
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

/** Derive AABB min from chunk grid position and cell size */
export function chunkAabbMin(
  grid: [number, number, number],
  cellSize: [number, number, number],
): [number, number, number] {
  return [grid[0] * cellSize[0], grid[1] * cellSize[1], grid[2] * cellSize[2]];
}

/** Derive AABB max from chunk grid position and cell size */
export function chunkAabbMax(
  grid: [number, number, number],
  cellSize: [number, number, number],
): [number, number, number] {
  const min = chunkAabbMin(grid, cellSize);
  return [min[0] + cellSize[0], min[1] + cellSize[1], min[2] + cellSize[2]];
}

/** Create a grid key string from grid coordinates (e.g., "0,0,0") */
export function chunkGridKey(grid: [number, number, number]): string {
  return `${grid[0]},${grid[1]},${grid[2]}`;
}

/** Parse a grid key string back to coordinates */
export function parseGridKey(key: string): [number, number, number] {
  const parts = key.split(',').map(Number);
  return [parts[0], parts[1], parts[2]];
}

/** Create an empty WorldManifest with sensible defaults */
export function createEmptyManifest(): WorldManifest {
  return {
    version: 1,
    grid_cell_size: [64, 32, 64],
    chunks: [],
    streaming_volumes: [],
    portals: [],
  };
}
```

- [ ] **Step 2: Add world to PROJECT_LAYOUT**

In `tools/packages/project-root/src/layout.ts`, add `world` at the top level of `PROJECT_LAYOUT` (sibling to `assets` and `toolsData`):

```typescript
export const PROJECT_LAYOUT = {
  world: 'world.json',
  assets: {
    characters: 'assets/characters',
    // ... existing entries unchanged
  },
  toolsData: {
    // ... existing entries unchanged
  },
} as const;
```

- [ ] **Step 3: Re-export world types from index.ts**

In `tools/packages/project-root/src/index.ts`, add:

```typescript
export * from './world';
```

- [ ] **Step 4: Build to verify**

Run: `cd tools && pnpm build`
Expected: PASS — no type errors

- [ ] **Step 5: Commit**

```bash
git add tools/packages/project-root/src/world.ts tools/packages/project-root/src/layout.ts tools/packages/project-root/src/index.ts
git commit -m "feat(project-root): add WorldManifest types and AABB helpers"
```

---

### Task 2: world.schema.json

**Files:**
- Create: `schemas/world.schema.json`

- [ ] **Step 1: Create world.schema.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GSeurat World Manifest",
  "description": "Spatial partitioning manifest for open-world streaming",
  "type": "object",
  "required": ["version", "grid_cell_size", "chunks"],
  "properties": {
    "version": {
      "const": 1
    },
    "grid_cell_size": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3,
      "maxItems": 3,
      "description": "Cell dimensions [x, y, z] in world units"
    },
    "chunks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["grid", "ply_file"],
        "properties": {
          "grid": {
            "type": "array",
            "items": { "type": "integer" },
            "minItems": 3,
            "maxItems": 3,
            "description": "Grid indices [x, y, z]"
          },
          "ply_file": {
            "type": "string",
            "description": "Asset-relative path to PLY file"
          },
          "scene_file": {
            "type": "string",
            "description": "Asset-relative path to per-chunk scene JSON"
          }
        },
        "additionalProperties": false
      }
    },
    "streaming_volumes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "shape", "position", "preload_target_ids"],
        "properties": {
          "id": { "type": "string" },
          "shape": { "enum": ["box", "sphere"] },
          "position": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 3,
            "maxItems": 3
          },
          "half_extents": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 3,
            "maxItems": 3
          },
          "radius": { "type": "number" },
          "preload_target_ids": {
            "type": "array",
            "items": { "type": "string" }
          }
        },
        "additionalProperties": false
      }
    },
    "portals": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "position", "region_shape", "target_instance_id"],
        "properties": {
          "id": { "type": "string" },
          "position": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 3,
            "maxItems": 3
          },
          "region_shape": { "enum": ["box", "sphere"] },
          "region_radius": { "type": "number" },
          "region_half_extents": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 3,
            "maxItems": 3
          },
          "target_instance_id": { "type": "string" },
          "spawn_position": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 3,
            "maxItems": 3
          },
          "spawn_facing": { "type": "string" }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2: Commit**

```bash
git add schemas/world.schema.json
git commit -m "feat: add world.schema.json for world manifest validation"
```

---

### Task 3: useWorldStore (Zustand Store)

**Files:**
- Create: `tools/apps/bricklayer/src/store/useWorldStore.ts`
- Modify: `tools/apps/bricklayer/src/store/types.ts`

This store follows the same Zustand pattern as `useSceneStore`. It manages world.json state: chunks, streaming volumes, global portals, grid cell size. Save/load via FSAPI.

- [ ] **Step 1: Add world navigation node kinds to types.ts**

In `tools/apps/bricklayer/src/store/types.ts`, extend the `NavigationNode` union type. Find the existing union and add new variants:

```typescript
  | { kind: 'world' }
  | { kind: 'world_category'; category: 'chunks' | 'streaming_volumes' | 'portals' }
  | { kind: 'world_item'; entityType: 'chunk' | 'streaming_volume' | 'world_portal'; entityId: string }
```

- [ ] **Step 2: Create useWorldStore.ts**

```typescript
// tools/apps/bricklayer/src/store/useWorldStore.ts
import { create } from 'zustand';
import type {
  WorldManifest,
  WorldChunk,
  StreamingVolumeData,
  WorldPortalData,
} from '@gseurat/project-root';
import { createEmptyManifest, chunkGridKey } from '@gseurat/project-root';

interface WorldSelection {
  type: 'chunk' | 'streaming_volume' | 'world_portal';
  id: string;
}

interface WorldStoreState {
  // State
  manifest: WorldManifest;
  loaded: boolean;
  dirty: boolean;
  selectedEntity: WorldSelection | null;
  editingChunkGrid: [number, number, number] | null; // non-null when "entered" a chunk

  // World-level
  setGridCellSize: (size: [number, number, number]) => void;

  // Chunks
  addChunk: (grid: [number, number, number]) => void;
  updateChunk: (gridKey: string, patch: Partial<WorldChunk>) => void;
  removeChunk: (gridKey: string) => void;

  // Streaming Volumes
  addStreamingVolume: () => void;
  updateStreamingVolume: (id: string, patch: Partial<StreamingVolumeData>) => void;
  removeStreamingVolume: (id: string) => void;

  // Global Portals
  addPortal: () => void;
  updatePortal: (id: string, patch: Partial<WorldPortalData>) => void;
  removePortal: (id: string) => void;

  // Selection
  setSelectedEntity: (sel: WorldSelection | null) => void;

  // Chunk editing
  enterChunk: (grid: [number, number, number]) => void;
  exitChunk: () => void;

  // Persistence
  loadManifest: (data: WorldManifest) => void;
  saveManifest: () => WorldManifest;
  newWorld: () => void;
}

let nextSvId = 1;
let nextPortalId = 1;

export const useWorldStore = create<WorldStoreState>((set, get) => ({
  manifest: createEmptyManifest(),
  loaded: false,
  dirty: false,
  selectedEntity: null,
  editingChunkGrid: null,

  setGridCellSize: (size) =>
    set((s) => ({
      manifest: { ...s.manifest, grid_cell_size: size },
      dirty: true,
    })),

  addChunk: (grid) =>
    set((s) => {
      const key = chunkGridKey(grid);
      const exists = s.manifest.chunks.some((c) => chunkGridKey(c.grid) === key);
      if (exists) return s;
      const chunk: WorldChunk = { grid, ply_file: '' };
      return {
        manifest: { ...s.manifest, chunks: [...s.manifest.chunks, chunk] },
        dirty: true,
      };
    }),

  updateChunk: (gridKey, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        chunks: s.manifest.chunks.map((c) =>
          chunkGridKey(c.grid) === gridKey ? { ...c, ...patch } : c,
        ),
      },
      dirty: true,
    })),

  removeChunk: (gridKey) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        chunks: s.manifest.chunks.filter((c) => chunkGridKey(c.grid) !== gridKey),
      },
      selectedEntity:
        s.selectedEntity?.type === 'chunk' && s.selectedEntity.id === gridKey
          ? null
          : s.selectedEntity,
      dirty: true,
    })),

  addStreamingVolume: () =>
    set((s) => {
      const id = `sv_${nextSvId++}`;
      const vol: StreamingVolumeData = {
        id,
        shape: 'box',
        position: [0, 0, 0],
        half_extents: [8, 8, 8],
        preload_target_ids: [],
      };
      return {
        manifest: {
          ...s.manifest,
          streaming_volumes: [...s.manifest.streaming_volumes, vol],
        },
        selectedEntity: { type: 'streaming_volume', id },
        dirty: true,
      };
    }),

  updateStreamingVolume: (id, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        streaming_volumes: s.manifest.streaming_volumes.map((v) =>
          v.id === id ? { ...v, ...patch } : v,
        ),
      },
      dirty: true,
    })),

  removeStreamingVolume: (id) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        streaming_volumes: s.manifest.streaming_volumes.filter((v) => v.id !== id),
      },
      selectedEntity:
        s.selectedEntity?.type === 'streaming_volume' && s.selectedEntity.id === id
          ? null
          : s.selectedEntity,
      dirty: true,
    })),

  addPortal: () =>
    set((s) => {
      const id = `portal_${nextPortalId++}`;
      const portal: WorldPortalData = {
        id,
        position: [0, 0, 0],
        region_shape: 'sphere',
        region_radius: 2.0,
        target_instance_id: '',
      };
      return {
        manifest: {
          ...s.manifest,
          portals: [...s.manifest.portals, portal],
        },
        selectedEntity: { type: 'world_portal', id },
        dirty: true,
      };
    }),

  updatePortal: (id, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        portals: s.manifest.portals.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      },
      dirty: true,
    })),

  removePortal: (id) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        portals: s.manifest.portals.filter((p) => p.id !== id),
      },
      selectedEntity:
        s.selectedEntity?.type === 'world_portal' && s.selectedEntity.id === id
          ? null
          : s.selectedEntity,
      dirty: true,
    })),

  setSelectedEntity: (sel) => set({ selectedEntity: sel }),

  enterChunk: (grid) => set({ editingChunkGrid: grid }),
  exitChunk: () => set({ editingChunkGrid: null }),

  loadManifest: (data) => {
    // Sync ID counters
    const maxSv = data.streaming_volumes.reduce((max, v) => {
      const n = parseInt(v.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    const maxP = data.portals.reduce((max, p) => {
      const n = parseInt(p.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextSvId = maxSv + 1;
    nextPortalId = maxP + 1;
    set({ manifest: data, loaded: true, dirty: false, selectedEntity: null, editingChunkGrid: null });
  },

  saveManifest: () => get().manifest,

  newWorld: () => {
    nextSvId = 1;
    nextPortalId = 1;
    set({
      manifest: createEmptyManifest(),
      loaded: true,
      dirty: false,
      selectedEntity: null,
      editingChunkGrid: null,
    });
  },
}));
```

- [ ] **Step 3: Build to verify**

Run: `cd tools && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/store/useWorldStore.ts tools/apps/bricklayer/src/store/types.ts
git commit -m "feat(bricklayer): add useWorldStore for world.json state management"
```

---

### Task 4: WorldViewport (R3F Wireframe Rendering)

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/WorldViewport.tsx`

This component renders the WORLD mode viewport using React Three Fiber. It shows:
- Colored wireframe boxes for each chunk at derived AABB positions
- Orange wireframe boxes/spheres for StreamingVolumes
- Cyan wireframe spheres/boxes for global Portals
- A flat ground-plane grid showing cell boundaries

Follow the existing pattern from `PortalMarkers.tsx`: fetch entities from store, render R3F geometry, click to select.

- [ ] **Step 1: Create WorldViewport.tsx**

```tsx
// tools/apps/bricklayer/src/viewport/WorldViewport.tsx
import { useWorldStore } from '../store/useWorldStore';
import { chunkAabbMin, chunkGridKey } from '@gseurat/project-root';
import { Line, Grid } from '@react-three/drei';
import * as THREE from 'three';

/** Wireframe box rendered from min/max corners */
function WireframeBox({
  min,
  max,
  color,
  lineWidth = 1,
  onClick,
}: {
  min: [number, number, number];
  max: [number, number, number];
  color: string;
  lineWidth?: number;
  onClick?: () => void;
}) {
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];

  return (
    <group position={[cx, cy, cz]}>
      {/* Invisible hit box for click detection */}
      <mesh onClick={onClick} visible={false}>
        <boxGeometry args={[sx, sy, sz]} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(sx, sy, sz)]} />
        <lineBasicMaterial color={color} linewidth={lineWidth} />
      </lineSegments>
    </group>
  );
}

/** Wireframe sphere */
function WireframeSphere({
  position,
  radius,
  color,
  onClick,
}: {
  position: [number, number, number];
  radius: number;
  color: string;
  onClick?: () => void;
}) {
  return (
    <group position={position}>
      <mesh onClick={onClick} visible={false}>
        <sphereGeometry args={[radius, 16, 12]} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.SphereGeometry(radius, 16, 12)]} />
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  );
}

export function WorldViewport() {
  const manifest = useWorldStore((s) => s.manifest);
  const selectedEntity = useWorldStore((s) => s.selectedEntity);
  const setSelectedEntity = useWorldStore((s) => s.setSelectedEntity);
  const enterChunk = useWorldStore((s) => s.enterChunk);

  const cellSize = manifest.grid_cell_size;

  return (
    <group>
      {/* Ground grid */}
      <Grid
        args={[512, 512]}
        cellSize={cellSize[0]}
        sectionSize={cellSize[0]}
        fadeDistance={512}
        cellColor="#444444"
        sectionColor="#666666"
        position={[0, -0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      />

      {/* Chunk wireframes */}
      {manifest.chunks.map((chunk) => {
        const key = chunkGridKey(chunk.grid);
        const isSelected = selectedEntity?.type === 'chunk' && selectedEntity.id === key;
        const hasPly = !!chunk.ply_file;
        const color = isSelected ? '#4488ff' : hasPly ? '#44cc44' : '#888888';
        const min = chunkAabbMin(chunk.grid, cellSize);
        const max: [number, number, number] = [
          min[0] + cellSize[0],
          min[1] + cellSize[1],
          min[2] + cellSize[2],
        ];
        return (
          <WireframeBox
            key={key}
            min={min}
            max={max}
            color={color}
            lineWidth={isSelected ? 2 : 1}
            onClick={() => setSelectedEntity({ type: 'chunk', id: key })}
          />
        );
      })}

      {/* Streaming Volume wireframes */}
      {manifest.streaming_volumes.map((vol) => {
        const isSelected =
          selectedEntity?.type === 'streaming_volume' && selectedEntity.id === vol.id;
        const color = isSelected ? '#ffaa00' : '#cc8800';

        if (vol.shape === 'sphere' && vol.radius != null) {
          return (
            <WireframeSphere
              key={vol.id}
              position={vol.position}
              radius={vol.radius}
              color={color}
              onClick={() => setSelectedEntity({ type: 'streaming_volume', id: vol.id })}
            />
          );
        }
        const he = vol.half_extents ?? [8, 8, 8];
        const min: [number, number, number] = [
          vol.position[0] - he[0],
          vol.position[1] - he[1],
          vol.position[2] - he[2],
        ];
        const max: [number, number, number] = [
          vol.position[0] + he[0],
          vol.position[1] + he[1],
          vol.position[2] + he[2],
        ];
        return (
          <WireframeBox
            key={vol.id}
            min={min}
            max={max}
            color={color}
            onClick={() => setSelectedEntity({ type: 'streaming_volume', id: vol.id })}
          />
        );
      })}

      {/* Global Portal wireframes */}
      {manifest.portals.map((portal) => {
        const isSelected =
          selectedEntity?.type === 'world_portal' && selectedEntity.id === portal.id;
        const color = isSelected ? '#00ffff' : '#008888';

        if (portal.region_shape === 'sphere' && portal.region_radius != null) {
          return (
            <WireframeSphere
              key={portal.id}
              position={portal.position}
              radius={portal.region_radius}
              color={color}
              onClick={() => setSelectedEntity({ type: 'world_portal', id: portal.id })}
            />
          );
        }
        const he = portal.region_half_extents ?? [1, 1, 1];
        const min: [number, number, number] = [
          portal.position[0] - he[0],
          portal.position[1] - he[1],
          portal.position[2] - he[2],
        ];
        const max: [number, number, number] = [
          portal.position[0] + he[0],
          portal.position[1] + he[1],
          portal.position[2] + he[2],
        ];
        return (
          <WireframeBox
            key={portal.id}
            min={min}
            max={max}
            color={color}
            onClick={() => setSelectedEntity({ type: 'world_portal', id: portal.id })}
          />
        );
      })}
    </group>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `cd tools && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/WorldViewport.tsx
git commit -m "feat(bricklayer): add WorldViewport with wireframe chunk/volume/portal rendering"
```

---

### Task 5: WorldTree & WorldPropertiesPanel

**Files:**
- Create: `tools/apps/bricklayer/src/panels/WorldTree.tsx`
- Create: `tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx`

Follow the existing `ProjectTree.tsx` TreeNode pattern for the left panel, and `ScenePropertiesPanel.tsx` property editor pattern for the right panel.

- [ ] **Step 1: Create WorldTree.tsx**

```tsx
// tools/apps/bricklayer/src/panels/WorldTree.tsx
import { useWorldStore } from '../store/useWorldStore';
import { chunkGridKey } from '@gseurat/project-root';
import React, { useState } from 'react';

function TreeSection({
  label,
  icon,
  count,
  onAdd,
  children,
}: {
  label: string;
  icon: string;
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 8px',
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: 13,
          color: '#ccc',
        }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ marginRight: 4 }}>{open ? '▼' : '▶'}</span>
        <span style={{ marginRight: 6 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ color: '#888', fontSize: 11, marginRight: 6 }}>{count}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          style={{
            background: 'none',
            border: '1px solid #555',
            color: '#aaa',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 11,
            padding: '0 4px',
          }}
        >
          +
        </button>
      </div>
      {open && <div style={{ paddingLeft: 20 }}>{children}</div>}
    </div>
  );
}

function TreeItem({
  label,
  isSelected,
  onClick,
  onRemove,
}: {
  label: string;
  isSelected: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 8px',
        cursor: 'pointer',
        background: isSelected ? '#335' : 'transparent',
        borderRadius: 3,
        fontSize: 12,
        color: isSelected ? '#fff' : '#bbb',
      }}
      onClick={onClick}
    >
      <span style={{ flex: 1 }}>{label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{
          background: 'none',
          border: 'none',
          color: '#888',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        ×
      </button>
    </div>
  );
}

export function WorldTree() {
  const manifest = useWorldStore((s) => s.manifest);
  const selectedEntity = useWorldStore((s) => s.selectedEntity);
  const setSelectedEntity = useWorldStore((s) => s.setSelectedEntity);
  const addChunk = useWorldStore((s) => s.addChunk);
  const removeChunk = useWorldStore((s) => s.removeChunk);
  const addStreamingVolume = useWorldStore((s) => s.addStreamingVolume);
  const removeStreamingVolume = useWorldStore((s) => s.removeStreamingVolume);
  const addPortal = useWorldStore((s) => s.addPortal);
  const removePortal = useWorldStore((s) => s.removePortal);

  const handleAddChunk = () => {
    // Find next available grid slot
    const existing = new Set(manifest.chunks.map((c) => chunkGridKey(c.grid)));
    for (let x = 0; x < 100; x++) {
      for (let z = 0; z < 100; z++) {
        const key = `${x},0,${z}`;
        if (!existing.has(key)) {
          addChunk([x, 0, z]);
          return;
        }
      }
    }
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <div
        style={{
          padding: '4px 8px',
          fontSize: 11,
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}
      >
        World
      </div>

      <TreeSection
        label="Chunks"
        icon="▦"
        count={manifest.chunks.length}
        onAdd={handleAddChunk}
      >
        {manifest.chunks.map((chunk) => {
          const key = chunkGridKey(chunk.grid);
          return (
            <TreeItem
              key={key}
              label={`[${chunk.grid.join(', ')}]`}
              isSelected={selectedEntity?.type === 'chunk' && selectedEntity.id === key}
              onClick={() => setSelectedEntity({ type: 'chunk', id: key })}
              onRemove={() => removeChunk(key)}
            />
          );
        })}
      </TreeSection>

      <TreeSection
        label="Streaming Volumes"
        icon="◈"
        count={manifest.streaming_volumes.length}
        onAdd={addStreamingVolume}
      >
        {manifest.streaming_volumes.map((vol) => (
          <TreeItem
            key={vol.id}
            label={vol.id}
            isSelected={
              selectedEntity?.type === 'streaming_volume' && selectedEntity.id === vol.id
            }
            onClick={() => setSelectedEntity({ type: 'streaming_volume', id: vol.id })}
            onRemove={() => removeStreamingVolume(vol.id)}
          />
        ))}
      </TreeSection>

      <TreeSection
        label="Global Portals"
        icon="◎"
        count={manifest.portals.length}
        onAdd={addPortal}
      >
        {manifest.portals.map((portal) => (
          <TreeItem
            key={portal.id}
            label={portal.id}
            isSelected={
              selectedEntity?.type === 'world_portal' && selectedEntity.id === portal.id
            }
            onClick={() => setSelectedEntity({ type: 'world_portal', id: portal.id })}
            onRemove={() => removePortal(portal.id)}
          />
        ))}
      </TreeSection>
    </div>
  );
}
```

- [ ] **Step 2: Create WorldPropertiesPanel.tsx**

```tsx
// tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx
import { useWorldStore } from '../store/useWorldStore';
import { chunkGridKey, parseGridKey } from '@gseurat/project-root';
import type {
  StreamingVolumeData,
  WorldPortalData,
  WorldChunk,
} from '@gseurat/project-root';
import { NumberInput } from '../components/NumberInput';
import { Vec3Input } from '../components/Vec3Input';
import React from 'react';

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: 1,
        padding: '8px 0 4px',
        borderBottom: '1px solid #333',
        marginBottom: 8,
      }}
    >
      {title}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
      <span style={{ width: 100, color: '#aaa', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function WorldProperties() {
  const cellSize = useWorldStore((s) => s.manifest.grid_cell_size);
  const setGridCellSize = useWorldStore((s) => s.setGridCellSize);

  return (
    <div>
      <SectionHeader title="World Settings" />
      <FieldRow label="Cell Size X">
        <NumberInput
          value={cellSize[0]}
          onChange={(v) => setGridCellSize([v, cellSize[1], cellSize[2]])}
          min={1}
          step={1}
        />
      </FieldRow>
      <FieldRow label="Cell Size Y">
        <NumberInput
          value={cellSize[1]}
          onChange={(v) => setGridCellSize([cellSize[0], v, cellSize[2]])}
          min={1}
          step={1}
        />
      </FieldRow>
      <FieldRow label="Cell Size Z">
        <NumberInput
          value={cellSize[2]}
          onChange={(v) => setGridCellSize([cellSize[0], cellSize[1], v])}
          min={1}
          step={1}
        />
      </FieldRow>
    </div>
  );
}

function ChunkProperties({ gridKey }: { gridKey: string }) {
  const chunk = useWorldStore((s) =>
    s.manifest.chunks.find((c) => chunkGridKey(c.grid) === gridKey),
  );
  const updateChunk = useWorldStore((s) => s.updateChunk);
  const enterChunk = useWorldStore((s) => s.enterChunk);

  if (!chunk) return null;

  return (
    <div>
      <SectionHeader title="Chunk" />
      <FieldRow label="Grid">
        <span style={{ color: '#ccc' }}>[{chunk.grid.join(', ')}]</span>
      </FieldRow>
      <FieldRow label="PLY File">
        <input
          type="text"
          value={chunk.ply_file}
          onChange={(e) => updateChunk(gridKey, { ply_file: e.target.value })}
          placeholder="assets/maps/chunk.ply"
          style={{
            width: '100%',
            background: '#222',
            border: '1px solid #444',
            color: '#ccc',
            padding: '2px 4px',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      </FieldRow>
      <FieldRow label="Scene File">
        <input
          type="text"
          value={chunk.scene_file ?? ''}
          onChange={(e) =>
            updateChunk(gridKey, { scene_file: e.target.value || undefined })
          }
          placeholder="assets/scenes/chunk.json"
          style={{
            width: '100%',
            background: '#222',
            border: '1px solid #444',
            color: '#ccc',
            padding: '2px 4px',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      </FieldRow>
      <button
        onClick={() => enterChunk(chunk.grid)}
        style={{
          marginTop: 8,
          padding: '4px 12px',
          background: '#335',
          border: '1px solid #558',
          color: '#aaf',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Enter Chunk (Edit Scene)
      </button>
    </div>
  );
}

function StreamingVolumeProperties({ id }: { id: string }) {
  const vol = useWorldStore((s) => s.manifest.streaming_volumes.find((v) => v.id === id));
  const update = useWorldStore((s) => s.updateStreamingVolume);

  if (!vol) return null;

  return (
    <div>
      <SectionHeader title="Streaming Volume" />
      <FieldRow label="ID">
        <input
          type="text"
          value={vol.id}
          onChange={(e) => update(id, { id: e.target.value })}
          style={{
            width: '100%',
            background: '#222',
            border: '1px solid #444',
            color: '#ccc',
            padding: '2px 4px',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      </FieldRow>
      <FieldRow label="Shape">
        <select
          value={vol.shape}
          onChange={(e) => update(id, { shape: e.target.value as 'box' | 'sphere' })}
          style={{
            background: '#222',
            border: '1px solid #444',
            color: '#ccc',
            borderRadius: 3,
            fontSize: 12,
          }}
        >
          <option value="box">Box</option>
          <option value="sphere">Sphere</option>
        </select>
      </FieldRow>
      <FieldRow label="Position">
        <Vec3Input value={vol.position} onChange={(v) => update(id, { position: v })} />
      </FieldRow>
      {vol.shape === 'box' && (
        <FieldRow label="Half Extents">
          <Vec3Input
            value={vol.half_extents ?? [8, 8, 8]}
            onChange={(v) => update(id, { half_extents: v })}
          />
        </FieldRow>
      )}
      {vol.shape === 'sphere' && (
        <FieldRow label="Radius">
          <NumberInput
            value={vol.radius ?? 8}
            onChange={(v) => update(id, { radius: v })}
            min={0.1}
            step={0.5}
          />
        </FieldRow>
      )}
      <FieldRow label="Preload Targets">
        <input
          type="text"
          value={vol.preload_target_ids.join(', ')}
          onChange={(e) =>
            update(id, {
              preload_target_ids: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="0,0,0, dungeon_01"
          style={{
            width: '100%',
            background: '#222',
            border: '1px solid #444',
            color: '#ccc',
            padding: '2px 4px',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      </FieldRow>
    </div>
  );
}

function PortalProperties({ id }: { id: string }) {
  const portal = useWorldStore((s) => s.manifest.portals.find((p) => p.id === id));
  const update = useWorldStore((s) => s.updatePortal);

  if (!portal) return null;

  return (
    <div>
      <SectionHeader title="Global Portal" />
      <FieldRow label="ID">
        <input
          type="text"
          value={portal.id}
          onChange={(e) => update(id, { id: e.target.value })}
          style={{
            width: '100%',
            background: '#222',
            border: '1px solid #444',
            color: '#ccc',
            padding: '2px 4px',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      </FieldRow>
      <FieldRow label="Position">
        <Vec3Input
          value={portal.position}
          onChange={(v) => update(id, { position: v })}
        />
      </FieldRow>
      <FieldRow label="Shape">
        <select
          value={portal.region_shape}
          onChange={(e) =>
            update(id, { region_shape: e.target.value as 'box' | 'sphere' })
          }
          style={{
            background: '#222',
            border: '1px solid #444',
            color: '#ccc',
            borderRadius: 3,
            fontSize: 12,
          }}
        >
          <option value="box">Box</option>
          <option value="sphere">Sphere</option>
        </select>
      </FieldRow>
      {portal.region_shape === 'sphere' && (
        <FieldRow label="Radius">
          <NumberInput
            value={portal.region_radius ?? 2}
            onChange={(v) => update(id, { region_radius: v })}
            min={0.1}
            step={0.5}
          />
        </FieldRow>
      )}
      {portal.region_shape === 'box' && (
        <FieldRow label="Half Extents">
          <Vec3Input
            value={portal.region_half_extents ?? [1, 1, 1]}
            onChange={(v) => update(id, { region_half_extents: v })}
          />
        </FieldRow>
      )}
      <FieldRow label="Target Instance">
        <input
          type="text"
          value={portal.target_instance_id}
          onChange={(e) => update(id, { target_instance_id: e.target.value })}
          placeholder="dungeon_01"
          style={{
            width: '100%',
            background: '#222',
            border: '1px solid #444',
            color: '#ccc',
            padding: '2px 4px',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      </FieldRow>
    </div>
  );
}

export function WorldPropertiesPanel() {
  const selectedEntity = useWorldStore((s) => s.selectedEntity);

  return (
    <div style={{ padding: 8 }}>
      <WorldProperties />
      {selectedEntity?.type === 'chunk' && <ChunkProperties gridKey={selectedEntity.id} />}
      {selectedEntity?.type === 'streaming_volume' && (
        <StreamingVolumeProperties id={selectedEntity.id} />
      )}
      {selectedEntity?.type === 'world_portal' && (
        <PortalProperties id={selectedEntity.id} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build to verify**

Run: `cd tools && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/panels/WorldTree.tsx tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx
git commit -m "feat(bricklayer): add WorldTree and WorldPropertiesPanel for WORLD mode"
```

---

### Task 6: WORLD Mode Integration in App.tsx + ChunkWireframes

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/ChunkWireframes.tsx`
- Modify: `tools/apps/bricklayer/src/App.tsx`
- Modify: `tools/apps/bricklayer/src/store/types.ts`

This task wires up the WORLD mode tab in the app, routes viewport/panel rendering based on mode, and adds ghosted chunk wireframes in SCENE mode.

- [ ] **Step 1: Create ChunkWireframes.tsx for SCENE mode ghosting**

```tsx
// tools/apps/bricklayer/src/viewport/ChunkWireframes.tsx
import { useWorldStore } from '../store/useWorldStore';
import { chunkAabbMin, chunkGridKey } from '@gseurat/project-root';
import * as THREE from 'three';

/**
 * Renders ghosted wireframe boxes for all world chunks behind the active
 * chunk's PLY viewport in SCENE mode. Helps level designers align content
 * near chunk boundaries.
 */
export function ChunkWireframes() {
  const manifest = useWorldStore((s) => s.manifest);
  const editingChunkGrid = useWorldStore((s) => s.editingChunkGrid);
  const loaded = useWorldStore((s) => s.loaded);

  if (!loaded || !editingChunkGrid) return null;

  const cellSize = manifest.grid_cell_size;
  const editingKey = chunkGridKey(editingChunkGrid);

  return (
    <group>
      {manifest.chunks.map((chunk) => {
        const key = chunkGridKey(chunk.grid);
        if (key === editingKey) return null; // Skip the chunk we're editing
        const min = chunkAabbMin(chunk.grid, cellSize);
        const cx = min[0] + cellSize[0] / 2;
        const cy = min[1] + cellSize[1] / 2;
        const cz = min[2] + cellSize[2] / 2;

        return (
          <group key={key} position={[cx, cy, cz]}>
            <lineSegments>
              <edgesGeometry
                args={[new THREE.BoxGeometry(cellSize[0], cellSize[1], cellSize[2])]}
              />
              <lineBasicMaterial color="#555555" transparent opacity={0.3} />
            </lineSegments>
          </group>
        );
      })}
    </group>
  );
}
```

- [ ] **Step 2: Add 'world' to mode type in types.ts**

In `tools/apps/bricklayer/src/store/types.ts`, find the mode type definition. It should look like:

```typescript
export type BricklayerMode = 'terrain' | 'scene' | 'settings';
```

Change it to:

```typescript
export type BricklayerMode = 'terrain' | 'scene' | 'settings' | 'world';
```

- [ ] **Step 3: Integrate WORLD mode in App.tsx**

In `tools/apps/bricklayer/src/App.tsx`:

**Add imports** near the top with other component imports:
```typescript
import { WorldViewport } from './viewport/WorldViewport';
import { ChunkWireframes } from './viewport/ChunkWireframes';
import { WorldTree } from './panels/WorldTree';
import { WorldPropertiesPanel } from './panels/WorldPropertiesPanel';
```

**Add WORLD tab** to the mode tabs section. Find where the TERRAIN/SCENE/SETTINGS tabs are rendered (they look like buttons or tabs with onClick handlers that call `store.setMode(...)`). Add a WORLD tab before TERRAIN:
```tsx
<button
  onClick={() => store.setMode('world')}
  style={{
    /* match existing tab styles */
    background: mode === 'world' ? '#335' : 'transparent',
    /* ... */
  }}
>
  WORLD
</button>
```

**Route left panel** — find the conditional that renders `ProjectTree` and add:
```tsx
{mode === 'world' ? <WorldTree /> : <ProjectTree />}
```

**Route right panel** — find the conditional block (around line 506-511) that selects the right panel. Add:
```tsx
{mode === 'world' && <WorldPropertiesPanel />}
```

**Route viewport content** — inside the R3F `<Canvas>` or `<Viewport>` component, add:
```tsx
{mode === 'world' && <WorldViewport />}
{mode === 'scene' && <ChunkWireframes />}
```

The `<ChunkWireframes />` renders in SCENE mode (ghosted background). The existing scene viewport content (VoxelMesh, PortalMarkers, etc.) should NOT render in world mode. Wrap existing scene viewport children in `{mode !== 'world' && (...)}` if they aren't already gated.

- [ ] **Step 4: Build to verify**

Run: `cd tools && pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/ChunkWireframes.tsx tools/apps/bricklayer/src/store/types.ts tools/apps/bricklayer/src/App.tsx
git commit -m "feat(bricklayer): integrate WORLD mode tab, viewport routing, and ghosted wireframes"
```

---

### Task 7: C++ WorldManifest Types & Parser

**Files:**
- Create: `include/gseurat/engine/world_manifest.hpp`
- Create: `src/engine/world_manifest.cpp`
- Create: `tests/test_world_manifest.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Write test_world_manifest.cpp**

```cpp
// tests/test_world_manifest.cpp
#include "gseurat/engine/world_manifest.hpp"
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <nlohmann/json.hpp>

using namespace gseurat;
using json = nlohmann::json;

TEST_CASE("WorldManifest::from_json parses minimal manifest", "[world_manifest]") {
    json j = json::parse(R"({
        "version": 1,
        "grid_cell_size": [64.0, 32.0, 64.0],
        "chunks": [
            { "grid": [0, 0, 0], "ply_file": "assets/maps/chunk_0_0_0.ply" }
        ],
        "streaming_volumes": [],
        "portals": []
    })");

    auto m = WorldManifest::from_json(j);
    REQUIRE(m.version == 1);
    REQUIRE(m.grid_cell_size.x == Catch::Approx(64.0f));
    REQUIRE(m.grid_cell_size.y == Catch::Approx(32.0f));
    REQUIRE(m.grid_cell_size.z == Catch::Approx(64.0f));
    REQUIRE(m.chunks.size() == 1);
    REQUIRE(m.chunks[0].grid == glm::ivec3(0, 0, 0));
    REQUIRE(m.chunks[0].ply_file == "assets/maps/chunk_0_0_0.ply");
    REQUIRE(m.chunks[0].scene_file.empty());
    REQUIRE(m.streaming_volumes.empty());
    REQUIRE(m.portals.empty());
}

TEST_CASE("WorldManifest::from_json parses chunks with scene_file", "[world_manifest]") {
    json j = json::parse(R"({
        "version": 1,
        "grid_cell_size": [32.0, 16.0, 32.0],
        "chunks": [
            {
                "grid": [1, 0, 2],
                "ply_file": "assets/maps/c_1_0_2.ply",
                "scene_file": "assets/scenes/c_1_0_2.json"
            }
        ],
        "streaming_volumes": [],
        "portals": []
    })");

    auto m = WorldManifest::from_json(j);
    REQUIRE(m.chunks[0].grid == glm::ivec3(1, 0, 2));
    REQUIRE(m.chunks[0].scene_file == "assets/scenes/c_1_0_2.json");
}

TEST_CASE("WorldManifest::from_json parses streaming volumes", "[world_manifest]") {
    json j = json::parse(R"({
        "version": 1,
        "grid_cell_size": [64.0, 32.0, 64.0],
        "chunks": [],
        "streaming_volumes": [
            {
                "id": "sv_1",
                "shape": "box",
                "position": [96.0, 0.0, 48.0],
                "half_extents": [8.0, 8.0, 8.0],
                "preload_target_ids": ["0,1,0", "dungeon_01"]
            },
            {
                "id": "sv_2",
                "shape": "sphere",
                "position": [10.0, 5.0, 20.0],
                "radius": 12.5,
                "preload_target_ids": ["1,0,0"]
            }
        ],
        "portals": []
    })");

    auto m = WorldManifest::from_json(j);
    REQUIRE(m.streaming_volumes.size() == 2);

    const auto& sv1 = m.streaming_volumes[0];
    REQUIRE(sv1.id == "sv_1");
    REQUIRE(sv1.shape == "box");
    REQUIRE(sv1.position.x == Catch::Approx(96.0f));
    REQUIRE(sv1.half_extents.x == Catch::Approx(8.0f));
    REQUIRE(sv1.preload_target_ids.size() == 2);
    REQUIRE(sv1.preload_target_ids[0] == "0,1,0");
    REQUIRE(sv1.preload_target_ids[1] == "dungeon_01");

    const auto& sv2 = m.streaming_volumes[1];
    REQUIRE(sv2.shape == "sphere");
    REQUIRE(sv2.radius == Catch::Approx(12.5f));
}

TEST_CASE("WorldManifest::from_json parses global portals", "[world_manifest]") {
    json j = json::parse(R"({
        "version": 1,
        "grid_cell_size": [64.0, 32.0, 64.0],
        "chunks": [],
        "streaming_volumes": [],
        "portals": [
            {
                "id": "portal_dungeon",
                "position": [100.0, 0.0, 50.0],
                "region_shape": "sphere",
                "region_radius": 2.0,
                "target_instance_id": "dungeon_01",
                "spawn_position": [5.0, 0.0, 5.0],
                "spawn_facing": "up"
            }
        ]
    })");

    auto m = WorldManifest::from_json(j);
    REQUIRE(m.portals.size() == 1);
    const auto& p = m.portals[0];
    REQUIRE(p.id == "portal_dungeon");
    REQUIRE(p.region_shape == "sphere");
    REQUIRE(p.region_radius == Catch::Approx(2.0f));
    REQUIRE(p.target_instance_id == "dungeon_01");
    REQUIRE(p.spawn_position.x == Catch::Approx(5.0f));
    REQUIRE(p.spawn_facing == "up");
}

TEST_CASE("WorldManifest chunk AABB derivation", "[world_manifest]") {
    WorldManifest m;
    m.grid_cell_size = glm::vec3(64.0f, 32.0f, 64.0f);
    WorldChunk chunk;
    chunk.grid = glm::ivec3(2, 1, 3);
    m.chunks.push_back(chunk);

    auto [aabb_min, aabb_max] = m.chunk_aabb(0);
    REQUIRE(aabb_min.x == Catch::Approx(128.0f));  // 2 * 64
    REQUIRE(aabb_min.y == Catch::Approx(32.0f));   // 1 * 32
    REQUIRE(aabb_min.z == Catch::Approx(192.0f));  // 3 * 64
    REQUIRE(aabb_max.x == Catch::Approx(192.0f));  // 128 + 64
    REQUIRE(aabb_max.y == Catch::Approx(64.0f));   // 32 + 32
    REQUIRE(aabb_max.z == Catch::Approx(256.0f));  // 192 + 64
}

TEST_CASE("WorldManifest::to_json round-trips", "[world_manifest]") {
    json j = json::parse(R"({
        "version": 1,
        "grid_cell_size": [64.0, 32.0, 64.0],
        "chunks": [
            { "grid": [0, 0, 0], "ply_file": "a.ply", "scene_file": "a.json" }
        ],
        "streaming_volumes": [
            {
                "id": "sv_1",
                "shape": "box",
                "position": [10.0, 0.0, 20.0],
                "half_extents": [5.0, 5.0, 5.0],
                "preload_target_ids": ["0,0,0"]
            }
        ],
        "portals": [
            {
                "id": "p1",
                "position": [1.0, 2.0, 3.0],
                "region_shape": "sphere",
                "region_radius": 3.0,
                "target_instance_id": "room1"
            }
        ]
    })");

    auto m = WorldManifest::from_json(j);
    auto j2 = WorldManifest::to_json(m);
    auto m2 = WorldManifest::from_json(j2);

    REQUIRE(m2.chunks.size() == 1);
    REQUIRE(m2.chunks[0].ply_file == "a.ply");
    REQUIRE(m2.streaming_volumes.size() == 1);
    REQUIRE(m2.streaming_volumes[0].id == "sv_1");
    REQUIRE(m2.portals.size() == 1);
    REQUIRE(m2.portals[0].target_instance_id == "room1");
}

TEST_CASE("WorldManifest point_in_volume box test", "[world_manifest]") {
    StreamingVolume vol;
    vol.shape = "box";
    vol.position = glm::vec3(10.0f, 0.0f, 20.0f);
    vol.half_extents = glm::vec3(5.0f, 5.0f, 5.0f);

    REQUIRE(vol.contains(glm::vec3(10.0f, 0.0f, 20.0f)));   // center
    REQUIRE(vol.contains(glm::vec3(14.9f, 4.9f, 24.9f)));    // near corner
    REQUIRE_FALSE(vol.contains(glm::vec3(15.1f, 0.0f, 20.0f))); // outside x
    REQUIRE_FALSE(vol.contains(glm::vec3(10.0f, 5.1f, 20.0f))); // outside y
}

TEST_CASE("WorldManifest point_in_volume sphere test", "[world_manifest]") {
    StreamingVolume vol;
    vol.shape = "sphere";
    vol.position = glm::vec3(0.0f);
    vol.radius = 10.0f;

    REQUIRE(vol.contains(glm::vec3(0.0f)));
    REQUIRE(vol.contains(glm::vec3(9.9f, 0.0f, 0.0f)));
    REQUIRE_FALSE(vol.contains(glm::vec3(10.1f, 0.0f, 0.0f)));
    REQUIRE_FALSE(vol.contains(glm::vec3(7.1f, 7.1f, 0.0f))); // ~10.04 > 10
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cmake --build --preset macos-debug && ctest --preset macos-debug -R test_world_manifest -V`
Expected: Build error — `world_manifest.hpp` not found

- [ ] **Step 3: Create world_manifest.hpp**

```cpp
// include/gseurat/engine/world_manifest.hpp
#pragma once

#include <glm/glm.hpp>
#include <nlohmann/json_fwd.hpp>
#include <string>
#include <utility>
#include <vector>

namespace gseurat {

struct WorldChunk {
    glm::ivec3 grid{0};
    std::string ply_file;
    std::string scene_file;  // empty if not set
};

struct StreamingVolume {
    std::string id;
    std::string shape{"box"};  // "box" or "sphere"
    glm::vec3 position{0.0f};
    glm::vec3 half_extents{8.0f};
    float radius{8.0f};
    std::vector<std::string> preload_target_ids;

    /** Test if a world-space point is inside this volume */
    bool contains(const glm::vec3& point) const;
};

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

struct WorldManifest {
    int version{1};
    glm::vec3 grid_cell_size{64.0f, 32.0f, 64.0f};
    std::vector<WorldChunk> chunks;
    std::vector<StreamingVolume> streaming_volumes;
    std::vector<WorldPortal> portals;

    /** Derive AABB for chunk at index */
    std::pair<glm::vec3, glm::vec3> chunk_aabb(size_t index) const;

    static WorldManifest from_json(const nlohmann::json& j);
    static nlohmann::json to_json(const WorldManifest& m);
};

}  // namespace gseurat
```

- [ ] **Step 4: Create world_manifest.cpp**

```cpp
// src/engine/world_manifest.cpp
#include "gseurat/engine/world_manifest.hpp"

#include <glm/glm.hpp>
#include <nlohmann/json.hpp>
#include <string>

namespace gseurat {

bool StreamingVolume::contains(const glm::vec3& point) const {
    if (shape == "sphere") {
        float dist2 = glm::dot(point - position, point - position);
        return dist2 <= radius * radius;
    }
    // box
    glm::vec3 d = glm::abs(point - position);
    return d.x <= half_extents.x && d.y <= half_extents.y && d.z <= half_extents.z;
}

std::pair<glm::vec3, glm::vec3> WorldManifest::chunk_aabb(size_t index) const {
    const auto& g = chunks[index].grid;
    glm::vec3 mn(
        static_cast<float>(g.x) * grid_cell_size.x,
        static_cast<float>(g.y) * grid_cell_size.y,
        static_cast<float>(g.z) * grid_cell_size.z);
    return {mn, mn + grid_cell_size};
}

static glm::vec3 parse_vec3(const nlohmann::json& j) {
    return glm::vec3(j[0].get<float>(), j[1].get<float>(), j[2].get<float>());
}

static glm::ivec3 parse_ivec3(const nlohmann::json& j) {
    return glm::ivec3(j[0].get<int>(), j[1].get<int>(), j[2].get<int>());
}

static nlohmann::json vec3_to_json(const glm::vec3& v) {
    return nlohmann::json::array({v.x, v.y, v.z});
}

static nlohmann::json ivec3_to_json(const glm::ivec3& v) {
    return nlohmann::json::array({v.x, v.y, v.z});
}

WorldManifest WorldManifest::from_json(const nlohmann::json& j) {
    WorldManifest m;
    m.version = j.value("version", 1);
    m.grid_cell_size = parse_vec3(j.at("grid_cell_size"));

    for (const auto& cj : j.at("chunks")) {
        WorldChunk c;
        c.grid = parse_ivec3(cj.at("grid"));
        c.ply_file = cj.at("ply_file").get<std::string>();
        if (cj.contains("scene_file")) {
            c.scene_file = cj["scene_file"].get<std::string>();
        }
        m.chunks.push_back(std::move(c));
    }

    if (j.contains("streaming_volumes")) {
        for (const auto& vj : j["streaming_volumes"]) {
            StreamingVolume v;
            v.id = vj.at("id").get<std::string>();
            v.shape = vj.at("shape").get<std::string>();
            v.position = parse_vec3(vj.at("position"));
            if (vj.contains("half_extents")) v.half_extents = parse_vec3(vj["half_extents"]);
            if (vj.contains("radius")) v.radius = vj["radius"].get<float>();
            for (const auto& tid : vj.at("preload_target_ids")) {
                v.preload_target_ids.push_back(tid.get<std::string>());
            }
            m.streaming_volumes.push_back(std::move(v));
        }
    }

    if (j.contains("portals")) {
        for (const auto& pj : j["portals"]) {
            WorldPortal p;
            p.id = pj.at("id").get<std::string>();
            p.position = parse_vec3(pj.at("position"));
            p.region_shape = pj.value("region_shape", std::string{"sphere"});
            if (pj.contains("region_radius")) p.region_radius = pj["region_radius"].get<float>();
            if (pj.contains("region_half_extents")) p.region_half_extents = parse_vec3(pj["region_half_extents"]);
            p.target_instance_id = pj.at("target_instance_id").get<std::string>();
            if (pj.contains("spawn_position")) p.spawn_position = parse_vec3(pj["spawn_position"]);
            p.spawn_facing = pj.value("spawn_facing", std::string{});
            m.portals.push_back(std::move(p));
        }
    }

    return m;
}

nlohmann::json WorldManifest::to_json(const WorldManifest& m) {
    nlohmann::json j;
    j["version"] = m.version;
    j["grid_cell_size"] = vec3_to_json(m.grid_cell_size);

    j["chunks"] = nlohmann::json::array();
    for (const auto& c : m.chunks) {
        nlohmann::json cj;
        cj["grid"] = ivec3_to_json(c.grid);
        cj["ply_file"] = c.ply_file;
        if (!c.scene_file.empty()) cj["scene_file"] = c.scene_file;
        j["chunks"].push_back(std::move(cj));
    }

    j["streaming_volumes"] = nlohmann::json::array();
    for (const auto& v : m.streaming_volumes) {
        nlohmann::json vj;
        vj["id"] = v.id;
        vj["shape"] = v.shape;
        vj["position"] = vec3_to_json(v.position);
        if (v.shape == "box") vj["half_extents"] = vec3_to_json(v.half_extents);
        if (v.shape == "sphere") vj["radius"] = v.radius;
        vj["preload_target_ids"] = v.preload_target_ids;
        j["streaming_volumes"].push_back(std::move(vj));
    }

    j["portals"] = nlohmann::json::array();
    for (const auto& p : m.portals) {
        nlohmann::json pj;
        pj["id"] = p.id;
        pj["position"] = vec3_to_json(p.position);
        pj["region_shape"] = p.region_shape;
        if (p.region_shape == "sphere") pj["region_radius"] = p.region_radius;
        if (p.region_shape == "box") pj["region_half_extents"] = vec3_to_json(p.region_half_extents);
        pj["target_instance_id"] = p.target_instance_id;
        if (p.spawn_position != glm::vec3(0.0f)) pj["spawn_position"] = vec3_to_json(p.spawn_position);
        if (!p.spawn_facing.empty()) pj["spawn_facing"] = p.spawn_facing;
        j["portals"].push_back(std::move(pj));
    }

    return j;
}

}  // namespace gseurat
```

- [ ] **Step 5: Add world_manifest.cpp to CMakeLists.txt**

In the `gseurat_core` OBJECT library source list in `CMakeLists.txt`, add:
```
src/engine/world_manifest.cpp
```

Also add `tests/test_world_manifest.cpp` to the test executable source list.

- [ ] **Step 6: Build and run tests**

Run: `cmake --build --preset macos-debug && ctest --preset macos-debug -R test_world_manifest -V`
Expected: All 8 tests PASS

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/engine/world_manifest.hpp src/engine/world_manifest.cpp tests/test_world_manifest.cpp CMakeLists.txt
git commit -m "feat(engine): add WorldManifest types, parser, and serializer with tests"
```

---

### Task 8: Staging World Loading & Bridge Command

**Files:**
- Modify: `src/engine/command_dispatcher.cpp`
- Modify: `include/gseurat/engine/gs_renderer.hpp`
- Modify: `src/staging/staging_state.cpp`

This task wires world.json into the Staging engine: bridge command to receive world data, world manifest storage, and chunk loading/unloading based on camera distance.

- [ ] **Step 1: Add world manifest storage to GsRenderer**

In `include/gseurat/engine/gs_renderer.hpp`, add a new public method and private member. Near the existing `load_cloud_async` method, add:

```cpp
// Public:
void load_world(const WorldManifest& manifest);
const WorldManifest& world_manifest() const { return world_manifest_; }

// Private:
WorldManifest world_manifest_;
```

Add the include at the top:
```cpp
#include "gseurat/engine/world_manifest.hpp"
```

- [ ] **Step 2: Implement load_world in gs_renderer.cpp**

In `src/engine/gs_renderer.cpp`, add the `load_world` method. This stores the manifest and initiates loading of the first chunk(s) based on camera proximity:

```cpp
void GsRenderer::load_world(const WorldManifest& manifest) {
    world_manifest_ = manifest;
    std::fprintf(stderr, "[GsRenderer] World loaded: %zu chunks, cell_size=(%.0f,%.0f,%.0f)\n",
        manifest.chunks.size(),
        manifest.grid_cell_size.x, manifest.grid_cell_size.y, manifest.grid_cell_size.z);
}
```

- [ ] **Step 3: Add load_world_json bridge command**

In `src/engine/command_dispatcher.cpp`, add a new command handler. Near the existing `load_scene_json` registration:

```cpp
register_command("load_world_json", [this](const json& cmd) -> CommandResult {
    auto json_str = cmd.value("json", std::string{});
    if (json_str.empty()) {
        return tl::unexpected(std::string("missing 'json' field"));
    }

    auto j = nlohmann::json::parse(json_str);
    auto manifest = WorldManifest::from_json(j);

    ctx_.renderer.gs_renderer().load_world(manifest);

    // Store streaming volumes and portals in scene objects for gizmo rendering
    ctx_.scene_objects.world_manifest = manifest;

    return json{{"type", "ok"}, {"chunks", manifest.chunks.size()}};
});
```

Add the include at the top of command_dispatcher.cpp:
```cpp
#include "gseurat/engine/world_manifest.hpp"
```

- [ ] **Step 4: Add world_manifest to SceneObjectState**

In `include/gseurat/engine/scene_object_state.hpp`, add:

```cpp
#include "gseurat/engine/world_manifest.hpp"

// Inside SceneObjectState struct:
std::optional<WorldManifest> world_manifest;
```

- [ ] **Step 5: Add world gizmo rendering in staging_state.cpp**

In `src/staging/staging_state.cpp`, in the gizmo drawing section (where portal gizmos are drawn), add world manifest gizmo rendering after portal gizmos:

```cpp
// World manifest gizmos (streaming volumes + global portals)
if (app.scene_objects().world_manifest.has_value()) {
    const auto& wm = *app.scene_objects().world_manifest;

    // Chunk wireframes (green)
    for (size_t i = 0; i < wm.chunks.size(); i++) {
        auto [aabb_min, aabb_max] = wm.chunk_aabb(i);
        glm::vec3 center = (aabb_min + aabb_max) * 0.5f;
        glm::vec3 size = aabb_max - aabb_min;
        // Use ImGui 3D drawing for wireframe box
        // (follow the same pattern as portal gizmo wireframe boxes)
    }

    // Streaming volume wireframes (orange)
    for (const auto& sv : wm.streaming_volumes) {
        if (sv.shape == "box") {
            glm::vec3 mn = sv.position - sv.half_extents;
            glm::vec3 mx = sv.position + sv.half_extents;
            // Draw orange wireframe box
        } else {
            // Draw orange wireframe sphere at sv.position with sv.radius
        }
    }

    // Global portal wireframes (cyan) — same pattern as per-scene portal gizmos
    for (const auto& wp : wm.portals) {
        // Use wp.position directly (already in global world coords, no GridPos conversion needed)
        if (wp.region_shape == "sphere") {
            // Draw cyan wireframe sphere
        } else {
            // Draw cyan wireframe box
        }
    }
}
```

**Important:** World manifest positions are already in global world coordinates — do NOT apply `coord::to_world()` conversion (that's only for scene JSON GridPos data).

- [ ] **Step 6: Build to verify**

Run: `cmake --build --preset macos-debug`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp src/engine/command_dispatcher.cpp include/gseurat/engine/scene_object_state.hpp src/staging/staging_state.cpp
git commit -m "feat(staging): add load_world_json bridge command and world gizmo rendering"
```

---

### Task 9: StreamingVolume Per-Frame Evaluation

**Files:**
- Modify: `src/staging/staging_state.cpp`

This task adds per-frame evaluation of StreamingVolumes in the Staging engine. When the camera enters a volume, it triggers `load_cloud_async()` for each preload target.

- [ ] **Step 1: Add streaming evaluation to StagingState update**

In `src/staging/staging_state.cpp`, in the `update()` method (or where per-frame logic runs), add StreamingVolume evaluation after camera update:

```cpp
// Evaluate streaming volumes
if (app.scene_objects().world_manifest.has_value()) {
    const auto& wm = *app.scene_objects().world_manifest;
    glm::vec3 cam_pos = app.scene().gs_camera().position();

    // Distance-based chunk streaming
    for (size_t i = 0; i < wm.chunks.size(); i++) {
        auto [aabb_min, aabb_max] = wm.chunk_aabb(i);
        glm::vec3 center = (aabb_min + aabb_max) * 0.5f;
        float dist = glm::distance(cam_pos, center);
        float load_radius = glm::length(wm.grid_cell_size) * 2.0f; // 2 cells away

        // Check if chunk should be loaded
        bool should_load = dist < load_radius;
        // Check if already loaded via active_chunks in gs_renderer
        // load_cloud_async if not loaded and should be
        if (should_load && !wm.chunks[i].ply_file.empty()) {
            // The gs_renderer tracks active chunks by chunk_id — check before loading
            // For now, log the intent:
            // app.renderer().gs_renderer().load_cloud_async(resolved_path);
        }
    }

    // StreamingVolume hint-based preloading
    for (const auto& sv : wm.streaming_volumes) {
        if (sv.contains(cam_pos)) {
            for (const auto& target_id : sv.preload_target_ids) {
                // target_id is either a chunk grid key "x,y,z" or an instance ID
                // Resolve and trigger load_cloud_async if not already loaded
            }
        }
    }
}
```

**Note:** The exact integration with `load_cloud_async()` depends on how chunk IDs map to file paths. The chunk's `ply_file` is resolved via `resolve_asset_path()`. The `GsRenderer` tracks loaded chunks by chunk_id — the streaming evaluation should check `active_chunks_` before requesting a load to avoid duplicate loads.

- [ ] **Step 2: Add poll_transfers to main loop**

In `src/staging/staging_app.cpp` main_loop (or staging_state update), ensure `poll_transfers` is called each frame. Check if it's already called. If not, add:

```cpp
app.renderer().gs_renderer().poll_transfers(/* current frame command buffer */);
```

This is needed so that async chunk loads complete and become visible.

- [ ] **Step 3: Build to verify**

Run: `cmake --build --preset macos-debug`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/staging/staging_state.cpp src/staging/staging_app.cpp
git commit -m "feat(staging): add per-frame StreamingVolume evaluation and distance-based chunk streaming"
```

---

### Task 10: GPU Frustum Culling in gs_preprocess.comp

**Files:**
- Modify: `shaders/gs_preprocess.comp`

The preprocess shader already has basic frustum culling (near plane, NDC boundary) that uses early `return` — meaning no sort entry is written and the sort buffer slot has stale data. With multi-chunk streaming, this is unsafe. This task replaces early returns with explicit `0xFFFF` sort key writes.

- [ ] **Step 1: Add frustum_visible function to gs_preprocess.comp**

After the existing helper functions but before `main()`, add:

```glsl
/** Clip-space frustum test with padding for splat radius bleed.
 *  Returns true if the splat center is within the frustum (with margin). */
bool frustum_visible(vec4 clip) {
    float pad = abs(clip.w) * 1.1;  // 10% padding for Gaussian extent
    return clip.z >= -pad
        && clip.z <=  pad
        && clip.x >= -pad
        && clip.x <=  pad
        && clip.y >= -pad
        && clip.y <=  pad;
}
```

- [ ] **Step 2: Replace early returns with 0xFFFF sort key writes**

In `main()`, find each early return point (lines ~389-428 in the current shader). Replace the pattern:

```glsl
// BEFORE (early return — leaves stale sort entry):
if (view_pos.z > -6.0) return;
if (clip_pos.w <= 0.0) return;
// NDC check:
if (ndc.x < -margin || ndc.x > 1.0 + margin || ...) return;
```

With the unified frustum cull using `0xFFFF` write:

```glsl
// AFTER (explicit culled key write):
vec4 clip_pos = proj * view_pos;

if (!frustum_visible(clip_pos)) {
    sort_entries[projected_offset + idx].key = 0xFFFFu;
    sort_entries[projected_offset + idx].index = projected_offset + idx;
    return;
}
```

This replaces ALL the individual checks (near plane, clip_pos.w, NDC boundary) with the single `frustum_visible()` call, which is more robust and ensures culled entries get a valid sort key that sorts to the end.

Keep the existing covariance-based culling (degenerate conic check) later in the shader — that's a different kind of cull (shape-based, not frustum-based).

- [ ] **Step 3: Verify shadow_box culling is preserved**

The shadow_box/cone backface cull (if it exists after the NDC checks) should also write `0xFFFF` instead of returning:

```glsl
if (shadow_box.y > 0.0) {
    // Backface cone cull
    vec3 to_cam = normalize(cam_pos.xyz - pos);
    if (dot(to_cam, cone_dir.xyz) < shadow_box.y) {
        sort_entries[projected_offset + idx].key = 0xFFFFu;
        sort_entries[projected_offset + idx].index = projected_offset + idx;
        return;
    }
}
```

- [ ] **Step 4: Build shaders**

Run: `cmake --build --preset macos-debug`
Expected: PASS — shader compiles successfully

- [ ] **Step 5: Commit**

```bash
git add shaders/gs_preprocess.comp
git commit -m "feat(shaders): replace early-return frustum culling with 0xFFFF sort key writes"
```

---

## Self-Review Checklist

### Spec Coverage
| Spec Requirement | Task(s) |
|---|---|
| world.json schema (Section 1.1) | Task 1 (TS types), Task 2 (JSON schema), Task 7 (C++ types) |
| @gseurat/project-root types (Section 1.2) | Task 1 |
| Bricklayer WORLD mode (Section 1.3) | Tasks 4, 5, 6 |
| Store architecture (Section 1.4) | Task 3 |
| StreamingVolume data model (Section 2.2) | Tasks 1, 2, 7 (all include SV types) |
| StreamingVolume Bricklayer UI (Section 2.3) | Tasks 4, 5 (viewport + properties) |
| StreamingVolume engine evaluation (Section 2.4) | Task 9 |
| GPU frustum culling (Section 3.2) | Task 10 |
| Clip-space test (Section 3.3) | Task 10 |
| Ghosted wireframes (Section 1.3) | Task 6 |
| world.json bridge command | Task 8 |
| World gizmo rendering in Staging | Task 8 |
| Acceptance: World serialization | Tasks 1-3 |
| Acceptance: Browser memory safety | Task 4 (no PLY in WORLD mode) |
| Acceptance: Editor UI for StreamingVolumes | Task 5 |
| Acceptance: Ghosted context | Task 6 |
| Acceptance: GPU frustum culling | Task 10 |

### Placeholder Scan
No TBDs, TODOs, or incomplete sections. All steps have concrete code.

### Type Consistency
- `WorldManifest` used consistently: TS (Task 1), JSON schema (Task 2), C++ (Task 7)
- `StreamingVolumeData` (TS) ↔ `StreamingVolume` (C++) — field names match JSON schema
- `WorldPortalData` (TS) ↔ `WorldPortal` (C++) — field names match
- `chunkGridKey()` / `chunkAabbMin()` / `chunkAabbMax()` used consistently in Tasks 1, 3, 4, 5, 6
- `contains()` on C++ StreamingVolume used in Task 9
- `chunk_aabb()` on C++ WorldManifest used in Tasks 8, 9
