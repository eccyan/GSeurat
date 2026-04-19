# Phase 1: Schema Evolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `WorldManifest` with `instances[]` and `portals[]`, move instance ownership from `BricklayerFile` to `world.json`, and update all related stores and I/O.

**Architecture:** The `WorldManifest` in `@gseurat/project-root` is the shared schema package. It gains two new interfaces (`WorldInstance`, `WorldPortal`) and two new arrays on the manifest. The Bricklayer `useWorldStore` gains CRUD actions for both. The `BricklayerFile` drops its `instances` field, and `sceneExport.ts` stops writing instances to the engine scene JSON (they now live in world.json).

**Tech Stack:** TypeScript, Zustand, pnpm monorepo

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `tools/packages/project-root/src/world.ts` | Modify | Add `WorldInstance`, `WorldPortal` interfaces; extend `WorldManifest`; update `createEmptyManifest()` |
| `tools/apps/bricklayer/src/store/types.ts` | Modify | Remove `InstanceData` interface; remove `instances?` from `BricklayerFile.scene`; update `NavigationNode` to add instance/portal world items |
| `tools/apps/bricklayer/src/store/useWorldStore.ts` | Modify | Add CRUD actions for instances and portals; update `WorldSelection` type; update `loadManifest` ID counters |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Modify | Remove `instances` state field, `addInstance`, `updateInstance`, `removeInstance` actions; remove from `saveProject`/`loadProject` |
| `tools/apps/bricklayer/src/lib/sceneExport.ts` | Modify | Remove instance export block and instance validation |
| `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx` | Modify | Remove `InstanceProperties` component and instance handling from the panel router |
| `tools/apps/bricklayer/src/panels/ProjectTree.tsx` | Modify | Remove Instances section from scene tree (instances will move to WorldTree in Phase 2) |
| `tools/apps/bricklayer/src/panels/EntitiesTab.tsx` | Modify | Remove `InstanceItem` component and instances list |
| `tools/tests/src/bricklayer-world-schema.test.ts` | Create | Test new WorldManifest schema, CRUD operations, round-trip serialization |

---

### Task 1: Extend WorldManifest Schema

**Files:**
- Modify: `tools/packages/project-root/src/world.ts`

- [ ] **Step 1: Add WorldInstance and WorldPortal interfaces**

Add after the `StreamingVolumeData` interface (line 16):

```typescript
export interface WorldInstance {
  id: string;
  display_name: string;
  scene_file: string;
}

export interface WorldPortal {
  id: string;
  display_name: string;
  position: [number, number, number];
  half_extents: [number, number, number];
  source_chunk: string;        // grid key "x,y,z" of the chunk this portal sits in
  target_instance: string;     // instance ID to teleport into
  target_spawn: [number, number, number]; // spawn point inside the target instance
}
```

- [ ] **Step 2: Add instances and portals to WorldManifest**

Update the `WorldManifest` interface to include the new arrays:

```typescript
export interface WorldManifest {
  version: 1;
  grid_cell_size: [number, number, number];
  chunks: WorldChunk[];
  instances: WorldInstance[];
  streaming_volumes: StreamingVolumeData[];
  portals: WorldPortal[];
}
```

- [ ] **Step 3: Update createEmptyManifest()**

```typescript
export function createEmptyManifest(): WorldManifest {
  return {
    version: 1,
    grid_cell_size: [64, 32, 64],
    chunks: [],
    instances: [],
    streaming_volumes: [],
    portals: [],
  };
}
```

- [ ] **Step 4: Verify package compiles**

Run: `cd tools && pnpm --filter @gseurat/project-root exec tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add tools/packages/project-root/src/world.ts
git commit -m "feat(world): add WorldInstance and WorldPortal to WorldManifest schema"
```

---

### Task 2: Update useWorldStore with Instance and Portal CRUD

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useWorldStore.ts`

- [ ] **Step 1: Update imports and WorldSelection type**

Add `WorldInstance` and `WorldPortal` to the import from `@gseurat/project-root`:

```typescript
import type {
  WorldManifest,
  WorldChunk,
  StreamingVolumeData,
  WorldInstance,
  WorldPortal,
} from '@gseurat/project-root';
```

Extend `WorldSelection` to include the new entity types:

```typescript
interface WorldSelection {
  type: 'chunk' | 'streaming_volume' | 'instance' | 'portal';
  id: string;
}
```

- [ ] **Step 2: Add instance and portal actions to WorldStoreState**

Add to the `WorldStoreState` interface:

```typescript
  addInstance: (displayName: string, sceneFile: string) => void;
  updateInstance: (id: string, patch: Partial<WorldInstance>) => void;
  removeInstance: (id: string) => void;

  addPortal: () => void;
  updatePortal: (id: string, patch: Partial<WorldPortal>) => void;
  removePortal: (id: string) => void;
```

- [ ] **Step 3: Add ID counter for instances and portals**

Add module-level counters alongside existing `nextSvId`:

```typescript
let nextSvId = 1;
let nextInstId = 1;
let nextPortalId = 1;
```

- [ ] **Step 4: Implement instance actions**

Add to the store implementation:

```typescript
  addInstance: (displayName, sceneFile) =>
    set((s) => {
      const id = `inst_${nextInstId++}`;
      const inst: WorldInstance = { id, display_name: displayName, scene_file: sceneFile };
      return {
        manifest: {
          ...s.manifest,
          instances: [...s.manifest.instances, inst],
        },
        selectedEntity: { type: 'instance', id },
        dirty: true,
      };
    }),

  updateInstance: (id, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        instances: s.manifest.instances.map((i) =>
          i.id === id ? { ...i, ...patch } : i,
        ),
      },
      dirty: true,
    })),

  removeInstance: (id) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        instances: s.manifest.instances.filter((i) => i.id !== id),
      },
      selectedEntity:
        s.selectedEntity?.type === 'instance' && s.selectedEntity.id === id
          ? null
          : s.selectedEntity,
      dirty: true,
    })),
```

- [ ] **Step 5: Implement portal actions**

Add to the store implementation:

```typescript
  addPortal: () =>
    set((s) => {
      const id = `portal_${nextPortalId++}`;
      const portal: WorldPortal = {
        id,
        display_name: 'New Portal',
        position: [0, 0, 0],
        half_extents: [1, 2, 0.5],
        source_chunk: '0,0,0',
        target_instance: '',
        target_spawn: [0, 0, 0],
      };
      return {
        manifest: {
          ...s.manifest,
          portals: [...s.manifest.portals, portal],
        },
        selectedEntity: { type: 'portal', id },
        dirty: true,
      };
    }),

  updatePortal: (id, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        portals: s.manifest.portals.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
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
        s.selectedEntity?.type === 'portal' && s.selectedEntity.id === id
          ? null
          : s.selectedEntity,
      dirty: true,
    })),
```

- [ ] **Step 6: Update loadManifest to restore ID counters**

Update the `loadManifest` action to also compute max IDs for instances and portals:

```typescript
  loadManifest: (data) => {
    const maxSv = data.streaming_volumes.reduce((max: number, v: StreamingVolumeData) => {
      const n = parseInt(v.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextSvId = maxSv + 1;

    const maxInst = data.instances.reduce((max: number, i: WorldInstance) => {
      const n = parseInt(i.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextInstId = maxInst + 1;

    const maxPortal = data.portals.reduce((max: number, p: WorldPortal) => {
      const n = parseInt(p.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextPortalId = maxPortal + 1;

    set({ manifest: data, loaded: true, dirty: false, selectedEntity: null, editingChunkGrid: null });
  },
```

- [ ] **Step 7: Update newWorld to reset counters**

```typescript
  newWorld: () => {
    nextSvId = 1;
    nextInstId = 1;
    nextPortalId = 1;
    set({
      manifest: createEmptyManifest(),
      loaded: true,
      dirty: false,
      selectedEntity: null,
      editingChunkGrid: null,
    });
  },
```

- [ ] **Step 8: Commit**

```bash
git add tools/apps/bricklayer/src/store/useWorldStore.ts
git commit -m "feat(world-store): add instance and portal CRUD actions"
```

---

### Task 3: Remove InstanceData from BricklayerFile and SceneStore

**Files:**
- Modify: `tools/apps/bricklayer/src/store/types.ts`
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`

- [ ] **Step 1: Remove InstanceData from types.ts**

Delete the `InstanceData` interface (lines 75-79):

```typescript
// DELETE THIS:
export interface InstanceData {
  id: string;
  display_name: string;
  scene_file: string;
}
```

Remove `instances?: InstanceData[];` from the `BricklayerFile.scene` block (line 492).

- [ ] **Step 2: Update NavigationNode to support world instances and portals**

In `types.ts`, update the `NavigationNode` type. Change the `world_category` and `world_item` variants:

```typescript
export type NavigationNode =
  | { kind: 'terrain'; terrainId: string }
  | { kind: 'collision'; terrainId: string }
  | { kind: 'scene' }
  | { kind: 'scene_category'; category: 'objects' | 'lights' | 'npcs' }
  | { kind: 'scene_item'; entityType: string; entityId: string }
  | { kind: 'player' }
  | { kind: 'settings' }
  | { kind: 'settings_category'; category: SettingsCategory }
  | { kind: 'world' }
  | { kind: 'world_category'; category: 'chunks' | 'streaming_volumes' | 'instances' | 'portals' }
  | { kind: 'world_item'; entityType: 'chunk' | 'streaming_volume' | 'instance' | 'portal'; entityId: string };
```

- [ ] **Step 3: Remove instances state and actions from useSceneStore**

In `useSceneStore.ts`:

1. Remove `InstanceData` from imports (line 9)
2. Remove `instances: InstanceData[];` from the state type (line 310)
3. Remove `addInstance`, `updateInstance`, `removeInstance` from the state type (around lines 382-385)
4. Remove `instances: [],` from the initial state (line 588)
5. Remove the `addInstance` implementation (around line 807-812)
6. Remove the `updateInstance` implementation (around line 814-816)
7. Remove the `removeInstance` implementation (around line 817-819)
8. In `saveProject()`: remove the block that saves `instances` (around line 1432: `instances: s.instances.length > 0 ? s.instances : undefined,`)
9. In `loadProject()`: remove `instances: data.scene.instances ?? [],` (around line 1525)

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/store/types.ts tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "refactor: move InstanceData ownership from BricklayerFile to WorldManifest"
```

---

### Task 4: Remove Instance References from UI and Scene Export

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/sceneExport.ts`
- Modify: `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx`
- Modify: `tools/apps/bricklayer/src/panels/ProjectTree.tsx`
- Modify: `tools/apps/bricklayer/src/panels/EntitiesTab.tsx`

- [ ] **Step 1: Remove instance export from sceneExport.ts**

Remove the instance export block (lines 212-218):

```typescript
// DELETE THIS BLOCK:
  if (state.instances.length > 0) {
    scene.instances = state.instances.map((i) => ({
      id: i.id,
      display_name: i.display_name,
      scene_file: i.scene_file,
    }));
  }
```

Remove the instance validation block (lines 143-154):

```typescript
// DELETE THIS BLOCK:
  if (Array.isArray(scene?.instances)) {
    for (let i = 0; i < scene.instances.length; i++) {
      const inst = scene.instances[i];
      // ... validation code
    }
  }
```

- [ ] **Step 2: Remove InstanceProperties from ScenePropertiesPanel.tsx**

Remove the `InstanceProperties` component (the function starting at line 639) and remove `InstanceData` from the import. Remove any case in the panel router that renders `InstanceProperties` for instance entities.

- [ ] **Step 3: Remove Instances section from ProjectTree.tsx**

Remove the Instances tree section (around lines 339-351) which renders instance nodes under the scene tree. Remove `instances` from the `useSceneStore` selector (line 174).

- [ ] **Step 4: Remove InstanceItem from EntitiesTab.tsx**

Remove the `InstanceItem` component (line 11), the `InstanceData` import (line 4), and the instances list rendering (lines 62-66). Remove `instances` from the store selector (line 29).

- [ ] **Step 5: Verify full build**

Run: `cd tools && pnpm build`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add tools/apps/bricklayer/src/lib/sceneExport.ts \
       tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx \
       tools/apps/bricklayer/src/panels/ProjectTree.tsx \
       tools/apps/bricklayer/src/panels/EntitiesTab.tsx
git commit -m "refactor: remove instance UI from Bricklayer scene panels (moved to world)"
```

---

### Task 5: Write Tests for WorldManifest Schema Evolution

**Files:**
- Create: `tools/tests/src/bricklayer-world-schema.test.ts`
- Modify: `tools/tests/package.json`

- [ ] **Step 1: Add test script to package.json**

Add to `tools/tests/package.json` scripts:

```json
"test:world-schema": "node --import tsx/esm --conditions source src/bricklayer-world-schema.test.ts"
```

- [ ] **Step 2: Write test file**

```typescript
// tools/tests/src/bricklayer-world-schema.test.ts
import assert from 'node:assert/strict';
import {
  createEmptyManifest,
  chunkGridKey,
  type WorldManifest,
  type WorldInstance,
  type WorldPortal,
} from '@gseurat/project-root';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('WorldManifest Schema Tests');
console.log('─'.repeat(40));

// --- createEmptyManifest ---

test('createEmptyManifest includes instances and portals arrays', () => {
  const m = createEmptyManifest();
  assert.ok(Array.isArray(m.instances), 'instances should be an array');
  assert.ok(Array.isArray(m.portals), 'portals should be an array');
  assert.equal(m.instances.length, 0);
  assert.equal(m.portals.length, 0);
});

test('createEmptyManifest preserves existing fields', () => {
  const m = createEmptyManifest();
  assert.equal(m.version, 1);
  assert.deepEqual(m.grid_cell_size, [64, 32, 64]);
  assert.ok(Array.isArray(m.chunks));
  assert.ok(Array.isArray(m.streaming_volumes));
});

// --- Type shape validation ---

test('WorldInstance has required fields', () => {
  const inst: WorldInstance = {
    id: 'dungeon_01',
    display_name: 'Test Dungeon',
    scene_file: 'assets/scenes/dungeon.json',
  };
  assert.equal(inst.id, 'dungeon_01');
  assert.equal(inst.display_name, 'Test Dungeon');
  assert.equal(inst.scene_file, 'assets/scenes/dungeon.json');
});

test('WorldPortal has required fields', () => {
  const portal: WorldPortal = {
    id: 'portal_1',
    display_name: 'Dungeon Entrance',
    position: [50, 0, 30],
    half_extents: [1, 2, 0.5],
    source_chunk: '0,0,0',
    target_instance: 'dungeon_01',
    target_spawn: [0, 0, 0],
  };
  assert.equal(portal.id, 'portal_1');
  assert.equal(portal.source_chunk, '0,0,0');
  assert.equal(portal.target_instance, 'dungeon_01');
  assert.deepEqual(portal.position, [50, 0, 30]);
  assert.deepEqual(portal.half_extents, [1, 2, 0.5]);
  assert.deepEqual(portal.target_spawn, [0, 0, 0]);
});

// --- Round-trip serialization ---

test('WorldManifest with instances and portals round-trips through JSON', () => {
  const manifest: WorldManifest = {
    version: 1,
    grid_cell_size: [192, 64, 192],
    chunks: [{ grid: [0, 0, 0], ply_file: 'assets/maps/island.ply', scene_file: 'assets/scenes/island.json' }],
    instances: [
      { id: 'dungeon_01', display_name: 'Tavern Interior', scene_file: 'assets/scenes/tavern.json' },
      { id: 'cave_02', display_name: 'Crystal Cave', scene_file: 'assets/scenes/cave.json' },
    ],
    streaming_volumes: [
      { id: 'sv_1', shape: 'sphere', position: [100, 0, 100], radius: 50, preload_target_ids: ['0,0,-1'] },
    ],
    portals: [
      {
        id: 'portal_1',
        display_name: 'Tavern Door',
        position: [50, 0, 30],
        half_extents: [1, 2, 0.5],
        source_chunk: '0,0,0',
        target_instance: 'dungeon_01',
        target_spawn: [5, 0, 5],
      },
    ],
  };

  const json = JSON.stringify(manifest);
  const parsed = JSON.parse(json) as WorldManifest;

  assert.equal(parsed.instances.length, 2);
  assert.equal(parsed.instances[0].id, 'dungeon_01');
  assert.equal(parsed.instances[1].display_name, 'Crystal Cave');
  assert.equal(parsed.portals.length, 1);
  assert.equal(parsed.portals[0].target_instance, 'dungeon_01');
  assert.deepEqual(parsed.portals[0].target_spawn, [5, 0, 5]);
});

test('Empty manifest round-trips correctly', () => {
  const m = createEmptyManifest();
  const json = JSON.stringify(m);
  const parsed = JSON.parse(json) as WorldManifest;
  assert.deepEqual(parsed, m);
});

// --- source_chunk uses chunkGridKey format ---

test('source_chunk matches chunkGridKey format', () => {
  const key = chunkGridKey([1, 0, -2]);
  const portal: WorldPortal = {
    id: 'p1',
    display_name: 'Test',
    position: [0, 0, 0],
    half_extents: [1, 1, 1],
    source_chunk: key,
    target_instance: 'inst_1',
    target_spawn: [0, 0, 0],
  };
  assert.equal(portal.source_chunk, '1,0,-2');
});

// --- Summary ---

console.log('─'.repeat(40));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 3: Run tests**

Run: `cd tools && pnpm --filter @gseurat/tests run test:world-schema`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add tools/tests/src/bricklayer-world-schema.test.ts tools/tests/package.json
git commit -m "test: add WorldManifest schema evolution tests"
```

---

### Task 6: Update island_demo world.json for Back-Compat

**Files:**
- Modify: `examples/island_demo/world.json`

- [ ] **Step 1: Add empty instances and portals arrays**

Read the existing `examples/island_demo/world.json` and add the new required fields:

```json
{
  "version": 1,
  "grid_cell_size": [192.0, 64.0, 192.0],
  "chunks": [
    {
      "grid": [0, 0, 0],
      "ply_file": "assets/maps/seurat_island.ply",
      "scene_file": "assets/scenes/seurat_island.json"
    },
    {
      "grid": [0, 0, -1],
      "ply_file": "assets/maps/northern_forest.ply",
      "scene_file": "assets/scenes/northern_forest.json"
    }
  ],
  "instances": [],
  "streaming_volumes": [
    ...existing streaming volumes unchanged...
  ],
  "portals": []
}
```

Keep all existing `streaming_volumes` entries exactly as they are. Only add the new `instances` and `portals` arrays (empty for now).

- [ ] **Step 2: Final full build verification**

Run: `cd tools && pnpm build`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add examples/island_demo/world.json
git commit -m "chore: add empty instances/portals arrays to island_demo world.json"
```
