# Game Object System — Bricklayer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace NPC/Object UI in Bricklayer with a unified Game Objects system featuring dynamic component editing driven by schema files.

**Architecture:** GameObjectData in the store holds transform + optional PLY + a components JSON map. Schema files define available component types. The properties panel auto-generates editors from schemas. Scene export writes `game_objects[]` instead of `npcs[]`/`objects[]`.

**Tech Stack:** React 18, TypeScript, Zustand, @react-three/fiber, @react-three/drei

**Spec:** `docs/superpowers/specs/2026-03-31-game-objects-design.md`
**Depends on:** PR #110 (engine GameObjectData, merged)

---

### Task 1: Store Types — GameObjectData + Schema Types

Replace NpcData and PlacedObjectData interfaces with GameObjectData. Add ComponentSchema type for the schema catalog.

**Files:**
- Modify: `tools/apps/bricklayer/src/store/types.ts`

- [ ] **Step 1: Add GameObjectData and ComponentSchema interfaces**

Add to `types.ts` (replacing NpcData and PlacedObjectData):

```typescript
export interface ComponentFieldSchema {
  name: string;
  type: 'float' | 'int' | 'bool' | 'string' | 'vec3' | 'color' | 'enum' | 'vec3[]';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  enum_values?: string[];
  description?: string;
}

export interface ComponentSchema {
  name: string;
  description: string;
  category: string;
  fields: ComponentFieldSchema[];
}

export interface GameObjectData {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  ply_file: string;
  components: Record<string, Record<string, unknown>>;
}
```

- [ ] **Step 2: Remove NpcData and PlacedObjectData**

Delete the `NpcData` interface (includes name, position, facing, patrol_speed, waypoints, script_module, script_class, character_id, etc.).

Delete the `PlacedObjectData` interface (includes id, ply_file, position, rotation, scale, is_static, character_manifest).

- [ ] **Step 3: Update BricklayerFile scene type**

In the BricklayerFile interface, replace:
```typescript
npcs?: NpcData[];
placedObjects?: PlacedObjectData[];
```
with:
```typescript
gameObjects?: GameObjectData[];
```

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/store/types.ts
git commit -m "Replace NpcData/PlacedObjectData with GameObjectData in Bricklayer types"
```

---

### Task 2: Store Actions — CRUD for Game Objects

Replace NPC/Object store state and actions with gameObjects.

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`

- [ ] **Step 1: Replace state fields**

In the store state interface, replace:
```typescript
npcs: NpcData[];
placedObjects: PlacedObjectData[];
```
with:
```typescript
gameObjects: GameObjectData[];
componentSchemas: ComponentSchema[];
```

- [ ] **Step 2: Replace action signatures**

Replace NPC/Object action signatures:
```typescript
// Remove these:
addNpc: (position?) => void;
updateNpc: (id, patch) => void;
removeNpc: (id) => void;
addPlacedObject: (plyFile, blob?, position?) => void;
updatePlacedObject: (id, patch) => void;
removePlacedObject: (id) => void;

// Add these:
addGameObject: (position?: [number, number, number]) => void;
updateGameObject: (id: string, patch: Partial<GameObjectData>) => void;
removeGameObject: (id: string) => void;
loadComponentSchemas: (schemas: ComponentSchema[]) => void;
```

- [ ] **Step 3: Replace action implementations**

Replace the NPC and PlacedObject CRUD implementations with:

```typescript
addGameObject: (pos) => {
  const target = pos ?? [0, 0, 0];
  const obj: GameObjectData = {
    id: `go_${Date.now()}`,
    name: 'New Object',
    position: target as [number, number, number],
    rotation: [0, 0, 0],
    scale: 1,
    ply_file: '',
    components: {},
  };
  set({ gameObjects: [...get().gameObjects, obj], isDirty: true });
},
updateGameObject: (id, patch) => set({
  gameObjects: get().gameObjects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  isDirty: true,
}),
removeGameObject: (id) => set({
  gameObjects: get().gameObjects.filter((o) => o.id !== id),
  isDirty: true,
}),
loadComponentSchemas: (schemas) => set({ componentSchemas: schemas }),
```

- [ ] **Step 4: Update initial state**

In the initial state object, replace:
```typescript
npcs: [] as NpcData[],
placedObjects: [] as PlacedObjectData[],
```
with:
```typescript
gameObjects: [] as GameObjectData[],
componentSchemas: [] as ComponentSchema[],
```

- [ ] **Step 5: Update newScene()**

Replace `npcs: [], placedObjects: []` with `gameObjects: []` in the newScene action.

- [ ] **Step 6: Update loadProject()**

Replace:
```typescript
npcs: data.scene.npcs,
placedObjects: data.scene.placedObjects ?? [],
```
with:
```typescript
gameObjects: data.scene.gameObjects ?? [],
```

Add migration for old format:
```typescript
// Migration: convert old npcs/objects to gameObjects
let gameObjects: GameObjectData[] = data.scene.gameObjects ?? [];
if (gameObjects.length === 0) {
  // Migrate old placedObjects
  if (data.scene.placedObjects) {
    for (const obj of data.scene.placedObjects) {
      gameObjects.push({
        id: obj.id || `go_${Date.now()}_${Math.random()}`,
        name: obj.id || 'Object',
        position: obj.position,
        rotation: obj.rotation,
        scale: obj.scale,
        ply_file: obj.ply_file,
        components: obj.character_manifest
          ? { CharacterModel: { manifest: obj.character_manifest } }
          : {},
      });
    }
  }
  // Migrate old npcs
  if (data.scene.npcs) {
    for (const npc of data.scene.npcs) {
      const comps: Record<string, Record<string, unknown>> = {};
      if (npc.facing) comps.Facing = { direction: npc.facing };
      if (npc.waypoints?.length) {
        comps.Patrol = { speed: npc.patrol_speed, waypoints: npc.waypoints, pause: npc.waypoint_pause };
      }
      if (npc.character_id) comps.CharacterModel = { character_id: npc.character_id };
      gameObjects.push({
        id: `npc_${npc.name || Date.now()}`,
        name: npc.name || 'NPC',
        position: npc.position,
        rotation: [0, 0, 0],
        scale: 1,
        ply_file: '',
        components: comps,
      });
    }
  }
}
```

- [ ] **Step 7: Update getSceneSnapshot() for auto-sync**

In the scene snapshot function (used by auto-sync to Staging), replace npcs/placedObjects references with gameObjects.

- [ ] **Step 8: Fix all remaining TypeScript errors**

Search for all remaining references to `npcs`, `placedObjects`, `NpcData`, `PlacedObjectData`, `addNpc`, `updateNpc`, `removeNpc`, `addPlacedObject`, `updatePlacedObject`, `removePlacedObject` in the store file and fix them.

- [ ] **Step 9: Commit**

```bash
git add tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "Replace NPC/Object store actions with gameObjects CRUD"
```

---

### Task 3: Scene Export — game_objects[]

Update scene export to write game_objects[] instead of npcs[]/objects[].

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/sceneExport.ts`

- [ ] **Step 1: Replace NPC and Object export blocks**

Remove the NPC export block and the Object export block. Replace with:

```typescript
if (state.gameObjects.length > 0) {
  scene.game_objects = state.gameObjects.map((go) => {
    const out: Record<string, unknown> = {
      id: go.id,
      name: go.name,
      position: go.position,
      rotation: go.rotation,
      scale: go.scale,
    };
    if (go.ply_file) out.ply_file = go.ply_file;
    out.components = go.components;
    return out;
  });
}
```

- [ ] **Step 2: Remove any NPC-specific export helpers**

Search for and remove any remaining references to npcs or placedObjects in the export file.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/lib/sceneExport.ts
git commit -m "Export game_objects[] instead of npcs[]/objects[] in scene export"
```

---

### Task 4: Project Tree — Game Objects Category

Replace NPCs and Objects tree categories with a single Game Objects category.

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/ProjectTree.tsx`

- [ ] **Step 1: Replace NPC/Object store reads with gameObjects**

Remove:
```typescript
const npcs = useSceneStore((st) => st.npcs);
const addNpc = useSceneStore((st) => st.addNpc);
const removeNpc = useSceneStore((st) => st.removeNpc);
const placedObjects = useSceneStore((st) => st.placedObjects);
const addPlacedObject = useSceneStore((st) => st.addPlacedObject);
const removePlacedObject = useSceneStore((st) => st.removePlacedObject);
```

Add:
```typescript
const gameObjects = useSceneStore((st) => st.gameObjects);
const addGameObject = useSceneStore((st) => st.addGameObject);
const removeGameObject = useSceneStore((st) => st.removeGameObject);
```

- [ ] **Step 2: Replace tree sections**

Remove the NPCs tree section and Objects tree section. Replace with a single Game Objects section:

```tsx
<TreeSection
  icon={icons.objects}
  label={`Game Objects (${gameObjects.length})`}
  addButton={<button style={s.addBtn} onClick={() => {
    const target = getCameraTarget();
    addGameObject(target.xyz);
  }}>+</button>}
  isOpen={gameObjOpen}
>
  {gameObjects.map((go) => (
    <TreeNode
      key={go.id}
      icon="📦"
      label={go.name || go.id}
      isActive={isActive({ kind: 'scene_item', entityType: 'game_object', entityId: go.id })}
      onClick={() => click({ kind: 'scene_item', entityType: 'game_object', entityId: go.id })}
      actions={<button style={s.removeBtn} onClick={(e) => { e.stopPropagation(); removeGameObject(go.id); }}>x</button>}
    />
  ))}
</TreeSection>
```

- [ ] **Step 3: Remove NPC/Object local state and collapse toggles**

Remove `npcOpen`/`objOpen` state. Add `gameObjOpen` state.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/panels/ProjectTree.tsx
git commit -m "Replace NPCs/Objects tree categories with unified Game Objects"
```

---

### Task 5: Properties Panel — Dynamic Component Editor

Add GameObjectProperties with schema-driven component editing to ScenePropertiesPanel.

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx`

- [ ] **Step 1: Add ComponentEditor helper**

Create a function that renders fields from a ComponentSchema:

```tsx
function ComponentEditor({ schema, data, onChange }: {
  schema: ComponentSchema;
  data: Record<string, unknown>;
  onChange: (newData: Record<string, unknown>) => void;
}) {
  return (
    <>
      {schema.fields.map((field) => {
        const value = data[field.name] ?? field.default;
        if (field.type === 'float' || field.type === 'int') {
          return (
            <div key={field.name} style={styles.row}>
              <span style={styles.label}>{field.name}</span>
              <NumberInput
                value={value as number}
                onChange={(v) => onChange({ ...data, [field.name]: v })}
                min={field.min}
                max={field.max}
                step={field.step ?? (field.type === 'int' ? 1 : 0.1)}
              />
            </div>
          );
        }
        if (field.type === 'string') {
          return (
            <div key={field.name} style={styles.row}>
              <span style={styles.label}>{field.name}</span>
              <input
                type="text"
                value={(value as string) ?? ''}
                onChange={(e) => onChange({ ...data, [field.name]: e.target.value })}
                style={styles.input}
              />
            </div>
          );
        }
        if (field.type === 'bool') {
          return (
            <div key={field.name} style={styles.row}>
              <label style={{ fontSize: 12, color: '#ddd' }}>
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(e) => onChange({ ...data, [field.name]: e.target.checked })}
                />
                {' '}{field.name}
              </label>
            </div>
          );
        }
        if (field.type === 'vec3') {
          return (
            <div key={field.name} style={styles.row}>
              <span style={styles.label}>{field.name}</span>
              <Vec3Input
                value={(value as [number, number, number]) ?? [0, 0, 0]}
                onChange={(v) => onChange({ ...data, [field.name]: v })}
              />
            </div>
          );
        }
        if (field.type === 'enum' && field.enum_values) {
          return (
            <div key={field.name} style={styles.row}>
              <span style={styles.label}>{field.name}</span>
              <select
                value={(value as string) ?? field.default}
                onChange={(e) => onChange({ ...data, [field.name]: e.target.value })}
                style={styles.select}
              >
                {field.enum_values.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
```

- [ ] **Step 2: Add GameObjectProperties component**

```tsx
function GameObjectProperties({ go }: { go: GameObjectData }) {
  const update = useSceneStore((s) => s.updateGameObject);
  const remove = useSceneStore((s) => s.removeGameObject);
  const schemas = useSceneStore((s) => s.componentSchemas);

  const addComponent = (schemaName: string) => {
    const schema = schemas.find((s) => s.name === schemaName);
    if (!schema) return;
    const defaults: Record<string, unknown> = {};
    for (const field of schema.fields) {
      defaults[field.name] = field.default;
    }
    update(go.id, {
      components: { ...go.components, [schemaName]: defaults },
    });
  };

  const removeComponent = (name: string) => {
    const next = { ...go.components };
    delete next[name];
    update(go.id, { components: next });
  };

  const updateComponent = (name: string, data: Record<string, unknown>) => {
    update(go.id, { components: { ...go.components, [name]: data } });
  };

  const attached = Object.keys(go.components);
  const available = schemas.filter((s) => !attached.includes(s.name));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#ccc' }}>GAME OBJECT</span>
        <button style={styles.btnDanger} onClick={() => remove(go.id)}>Remove</button>
      </div>

      {/* Name */}
      <div style={styles.row}>
        <span style={styles.label}>Name</span>
        <input style={styles.input} value={go.name}
          onChange={(e) => update(go.id, { name: e.target.value })} />
      </div>

      {/* PLY file */}
      <div style={styles.row}>
        <span style={styles.label}>PLY</span>
        <input style={styles.input} value={go.ply_file}
          onChange={(e) => update(go.id, { ply_file: e.target.value })} />
      </div>

      {/* Transform */}
      <div style={styles.row}>
        <span style={styles.label}>Position</span>
        <Vec3Input value={go.position} onChange={(v) => update(go.id, { position: v })} />
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Rotation</span>
        <Vec3Input value={go.rotation} onChange={(v) => update(go.id, { rotation: v })} />
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Scale</span>
        <NumberInput value={go.scale} step={0.1}
          onChange={(v) => update(go.id, { scale: v })} />
      </div>

      {/* Components */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 12, color: '#999' }}>COMPONENTS</span>
          {available.length > 0 && (
            <select style={styles.select}
              value=""
              onChange={(e) => { if (e.target.value) addComponent(e.target.value); }}>
              <option value="">+ Add Component</option>
              {available.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
        </div>

        {attached.map((name) => {
          const schema = schemas.find((s) => s.name === name);
          const data = go.components[name] as Record<string, unknown>;
          return (
            <div key={name} style={{ marginBottom: 8, borderLeft: '2px solid #446', paddingLeft: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#8af' }}>{name}</span>
                <button style={{ background: 'none', border: 'none', color: '#f66', cursor: 'pointer', fontSize: 11 }}
                  onClick={() => removeComponent(name)}>x</button>
              </div>
              {schema ? (
                <ComponentEditor schema={schema} data={data} onChange={(d) => updateComponent(name, d)} />
              ) : (
                <div style={{ fontSize: 11, color: '#888' }}>Unknown component (no schema)</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the properties panel dispatcher**

In the main ScenePropertiesPanel component, add:
```typescript
const gameObjects = useSceneStore((s) => s.gameObjects);
```

And in the entity type switch:
```typescript
if (selectedEntity.type === 'game_object') {
  const go = gameObjects.find((g) => g.id === selectedEntity.id);
  if (!go) return <div style={styles.empty}>Game Object not found</div>;
  return <GameObjectProperties go={go} />;
}
```

- [ ] **Step 4: Remove NpcProperties and ObjectProperties**

Delete the NpcProperties and ObjectProperties components and their references in the dispatcher.

- [ ] **Step 5: Type check**

```bash
cd tools && pnpm -C apps/bricklayer exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx
git commit -m "Add dynamic component editor for Game Objects in properties panel"
```

---

### Task 6: Viewport Markers + Grab Support

Replace NpcMarkers and ObjectMarkers with GameObjectMarkers.

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/GameObjectMarkers.tsx`
- Delete: `tools/apps/bricklayer/src/viewport/NpcMarkers.tsx`
- Delete: `tools/apps/bricklayer/src/viewport/ObjectMarkers.tsx`
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx`

- [ ] **Step 1: Create GameObjectMarkers.tsx**

```tsx
import React from 'react';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

function GameObjectMarker({ go, isSelected, onSelect }: {
  go: { id: string; name: string; position: [number, number, number]; scale: number; components: Record<string, unknown> };
  isSelected: boolean;
  onSelect: () => void;
}) {
  const hasComponents = Object.keys(go.components).length > 0;
  const color = hasComponents ? '#4488ff' : '#888888';

  return (
    <group position={go.position}>
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <boxGeometry args={[1.2, 1.2, 1.2]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshBasicMaterial
          color={isSelected ? '#ffffff' : color}
          wireframe
          transparent
          opacity={isSelected ? 0.6 : 0.3}
        />
      </mesh>
      {isSelected && (
        <Html position={[0, 1.2, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#88aaff',
            padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
          }}>
            {go.name}
          </div>
        </Html>
      )}
    </group>
  );
}

export function GameObjectMarkers() {
  const gameObjects = useSceneStore((s) => s.gameObjects);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {gameObjects.map((go) => (
        <GameObjectMarker
          key={go.id}
          go={go}
          isSelected={selectedEntity?.type === 'game_object' && selectedEntity.id === go.id}
          onSelect={() => setSelectedEntity({ type: 'game_object', id: go.id })}
        />
      ))}
    </group>
  );
}
```

- [ ] **Step 2: Delete NpcMarkers.tsx and ObjectMarkers.tsx**

```bash
rm tools/apps/bricklayer/src/viewport/NpcMarkers.tsx
rm tools/apps/bricklayer/src/viewport/ObjectMarkers.tsx
```

- [ ] **Step 3: Update Viewport.tsx**

Replace imports:
```typescript
// Remove:
import { NpcMarkers } from './NpcMarkers.js';
import { ObjectMarkers } from './ObjectMarkers.js';
// Add:
import { GameObjectMarkers } from './GameObjectMarkers.js';
```

Replace in SceneContent render:
```tsx
// Remove:
<NpcMarkers />
<ObjectMarkers />
// Add:
<GameObjectMarkers />
```

Update `getGrabbedEntityY()` — replace `npc` and `object` cases with:
```typescript
if (sel.type === 'game_object') {
  const go = store.gameObjects.find((g) => g.id === sel.id);
  return go?.position[1] ?? 0;
}
```

Update `updateGrabbedEntity()` — replace `npc` and `object` cases with:
```typescript
} else if (sel.type === 'game_object') {
  store.updateGameObject(sel.id, { position: [x, y, z] });
```

- [ ] **Step 4: Type check**

```bash
cd tools && pnpm -C apps/bricklayer exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Replace NPC/Object viewport markers with GameObjectMarkers"
```

---

### Task 7: Schema Loading

Load component schemas from the project directory when a project is opened.

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`

- [ ] **Step 1: Add schema loading to loadProject**

After loading scene data, scan `assets/components/` directory for `*.schema.json` files:

```typescript
// Load component schemas from project
if (handle) {
  try {
    const componentsDir = await handle.getDirectoryHandle('assets')
      .then((a) => a.getDirectoryHandle('components'))
      .catch(() => null);
    if (componentsDir) {
      const schemas: ComponentSchema[] = [];
      for await (const entry of (componentsDir as any).values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.schema.json')) {
          const file = await entry.getFile();
          const text = await file.text();
          try { schemas.push(JSON.parse(text)); } catch {}
        }
      }
      set({ componentSchemas: schemas });
    }
  } catch {}
}
```

- [ ] **Step 2: Also provide built-in fallback schemas**

If no project directory is available (no File System Access API), load a hardcoded set of default schemas matching the 6 schema files from assets/components/:

```typescript
const BUILTIN_SCHEMAS: ComponentSchema[] = [
  { name: 'Health', description: 'Destructible entity', category: 'Gameplay',
    fields: [
      { name: 'max_hp', type: 'float', default: 100, min: 0 },
      { name: 'current_hp', type: 'float', default: 100, min: 0 },
    ]},
  { name: 'Interactable', description: 'Player interaction', category: 'Gameplay',
    fields: [
      { name: 'prompt', type: 'string', default: 'Interact' },
      { name: 'radius', type: 'float', default: 2.0, min: 0.1, max: 50 },
      { name: 'one_shot', type: 'bool', default: false },
    ]},
  { name: 'Facing', description: 'Direction entity faces', category: 'Core',
    fields: [
      { name: 'direction', type: 'enum', default: 'down', enum_values: ['up', 'down', 'left', 'right'] },
    ]},
  { name: 'Patrol', description: 'Patrol between waypoints', category: 'AI',
    fields: [
      { name: 'speed', type: 'float', default: 2.0, min: 0 },
      { name: 'pause', type: 'float', default: 1.0, min: 0 },
    ]},
  { name: 'Dialog', description: 'Entity speaks dialog', category: 'Narrative',
    fields: [
      { name: 'dialog_id', type: 'string', default: '' },
    ]},
  { name: 'CharacterModel', description: 'Voxel character', category: 'Visual',
    fields: [
      { name: 'character_id', type: 'string', default: '' },
      { name: 'manifest', type: 'string', default: '' },
    ]},
];
```

Load these as fallback if no schemas are found from the project directory.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "Load component schemas from project directory with built-in fallback"
```

---

### Task 8: Cleanup — Remove Dead NPC/Object Code

Remove any remaining NPC/Object-specific code from tabs, panels, and other files.

**Files:**
- Delete or gut: `tools/apps/bricklayer/src/panels/EntitiesTab.tsx` (NPC editor)
- Delete or gut: `tools/apps/bricklayer/src/panels/ObjectsTab.tsx` (Object editor)
- Modify: any remaining files that reference NpcData, PlacedObjectData, npcs, placedObjects

- [ ] **Step 1: Remove EntitiesTab NPC code**

If EntitiesTab.tsx only contains NPC editing, delete the file. If it contains other entity types, remove only the NPC parts.

- [ ] **Step 2: Remove ObjectsTab Object code**

Same — remove PlacedObject-specific code from ObjectsTab.tsx.

- [ ] **Step 3: Search and fix all remaining references**

```bash
grep -r "NpcData\|PlacedObjectData\|addNpc\|removeNpc\|updateNpc\|addPlacedObject\|removePlacedObject\|updatePlacedObject\|\.npcs\b\|placedObjects" tools/apps/bricklayer/src/ --include="*.ts" --include="*.tsx"
```

Fix every remaining reference.

- [ ] **Step 4: Type check**

```bash
cd tools && pnpm -C apps/bricklayer exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Remove remaining NPC/Object-specific code from Bricklayer"
```

---

## Verification Checklist

1. `tsc --noEmit` passes for Bricklayer
2. No references to NpcData, PlacedObjectData, addNpc, addPlacedObject remain
3. Game Objects tree category appears with + button
4. Creating a Game Object places it at camera target
5. Selecting a Game Object shows properties panel with Name, PLY, Transform, Components
6. "Add Component" dropdown shows available schemas
7. Component fields auto-generate correct editors (NumberInput, checkbox, dropdown, etc.)
8. Removing a component removes it from the panel
9. Scene export writes game_objects[] array
10. Loading old scenes with npcs[]/objects[] migrates to gameObjects
11. GameObjectMarkers render in viewport with blue wireframe cubes
12. Grab mode works for Game Objects
