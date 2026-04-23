# Viewport Collider Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wireframe collider overlays to Bricklayer's 3D viewport so level designers can see and click collision shapes directly in the editor.

**Architecture:** A new `ColliderMarkers.tsx` component renders Three.js `EdgesGeometry` wireframes for Box/Sphere/Capsule colliders, with invisible hit meshes for click-to-select. Visibility follows a two-tier model: all colliders faint when `showCollision` is ON, selected collider always bright. A "Colliders" toggle in the View menu wires the existing `showCollision` store flag.

**Tech Stack:** React Three Fiber, Three.js (EdgesGeometry, BoxGeometry, SphereGeometry, CapsuleGeometry), Zustand (useSceneStore)

---

### Task 1: Create ColliderMarkers component

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/ColliderMarkers.tsx`

- [ ] **Step 1: Create ColliderMarkers.tsx**

```tsx
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';

const DEG2RAD = THREE.MathUtils.degToRad;

interface ColliderShape {
  type: string;
  half_extents?: [number, number, number];
  radius?: number;
  half_height?: number;
}

function ColliderWireframe({ shape, color, opacity }: {
  shape: ColliderShape;
  color: string;
  opacity: number;
}) {
  const edgesGeo = useMemo(() => {
    if (shape.type === 'box') {
      const [hx, hy, hz] = shape.half_extents ?? [0.5, 0.5, 0.5];
      return new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz));
    } else if (shape.type === 'sphere') {
      const r = shape.radius ?? 0.5;
      return new THREE.EdgesGeometry(new THREE.SphereGeometry(r, 24, 16));
    } else {
      // capsule
      const r = shape.radius ?? 0.3;
      const hh = shape.half_height ?? 0.5;
      return new THREE.EdgesGeometry(new THREE.CapsuleGeometry(r, 2 * hh, 12, 8));
    }
  }, [shape.type, shape.half_extents, shape.radius, shape.half_height]);

  return (
    <lineSegments geometry={edgesGeo}>
      <lineBasicMaterial color={color} transparent opacity={opacity} />
    </lineSegments>
  );
}

function ColliderFill({ shape, color, opacity }: {
  shape: ColliderShape;
  color: string;
  opacity: number;
}) {
  if (shape.type === 'box') {
    const [hx, hy, hz] = shape.half_extents ?? [0.5, 0.5, 0.5];
    return (
      <mesh>
        <boxGeometry args={[2 * hx, 2 * hy, 2 * hz]} />
        <meshBasicMaterial color={color} opacity={opacity} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  } else if (shape.type === 'sphere') {
    const r = shape.radius ?? 0.5;
    return (
      <mesh>
        <sphereGeometry args={[r, 24, 16]} />
        <meshBasicMaterial color={color} opacity={opacity} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  } else {
    const r = shape.radius ?? 0.3;
    const hh = shape.half_height ?? 0.5;
    return (
      <mesh>
        <capsuleGeometry args={[r, 2 * hh, 12, 8]} />
        <meshBasicMaterial color={color} opacity={opacity} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  }
}

function ColliderHitMesh({ shape, onSelect }: {
  shape: ColliderShape;
  onSelect: () => void;
}) {
  if (shape.type === 'box') {
    const [hx, hy, hz] = shape.half_extents ?? [0.5, 0.5, 0.5];
    return (
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <boxGeometry args={[2 * hx, 2 * hy, 2 * hz]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    );
  } else if (shape.type === 'sphere') {
    const r = shape.radius ?? 0.5;
    return (
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[r, 24, 16]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    );
  } else {
    const r = shape.radius ?? 0.3;
    const hh = shape.half_height ?? 0.5;
    return (
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <capsuleGeometry args={[r, 2 * hh, 12, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    );
  }
}

function SingleColliderMarker({ objId, objPosition, objRotation, collider, isSelected, showCollision, onSelect }: {
  objId: string;
  objPosition: [number, number, number];
  objRotation: [number, number, number];
  collider: Record<string, unknown>;
  isSelected: boolean;
  showCollision: boolean;
  onSelect: () => void;
}) {
  const shape = collider.shape as ColliderShape | undefined;
  if (!shape || !shape.type) return null;

  const offset = (collider.offset as [number, number, number]) ?? [0, 0, 0];
  const isTrigger = (collider.is_trigger as boolean) ?? false;
  const localRotation = (collider.local_rotation as [number, number, number, number]) ?? [0, 0, 0, 1];

  // Visibility: selected always visible; unselected only when showCollision is ON
  const visible = isSelected || showCollision;
  if (!visible) return null;

  // Colors: green for solid, orange for trigger
  const wireColor = isTrigger
    ? (isSelected ? '#ff8800' : '#885500')
    : (isSelected ? '#00ff44' : '#228833');
  const wireOpacity = isSelected ? 1.0 : 0.3;
  const fillOpacity = isSelected ? 0.08 : 0.04;

  return (
    <group
      position={objPosition}
      rotation={[DEG2RAD(objRotation[0]), DEG2RAD(objRotation[1]), DEG2RAD(objRotation[2])]}
    >
      <group quaternion={localRotation}>
        <group position={offset}>
          <ColliderWireframe shape={shape} color={wireColor} opacity={wireOpacity} />
          <ColliderFill shape={shape} color={wireColor} opacity={fillOpacity} />
          <ColliderHitMesh shape={shape} onSelect={onSelect} />
        </group>
      </group>
    </group>
  );
}

export function ColliderMarkers() {
  const gameObjects = useSceneStore((s) => s.gameObjects);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const showCollision = useSceneStore((s) => s.showCollision);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {gameObjects.map((obj) => {
        const collider = obj.components['ColliderComponent'] as Record<string, unknown> | undefined;
        if (!collider) return null;
        const isSelected = selectedEntity?.type === 'game_object' && selectedEntity.id === obj.id;
        return (
          <SingleColliderMarker
            key={obj.id}
            objId={obj.id}
            objPosition={obj.position}
            objRotation={obj.rotation}
            collider={collider}
            isSelected={isSelected}
            showCollision={showCollision}
            onSelect={() => setSelectedEntity({ type: 'game_object', id: obj.id })}
          />
        );
      })}
    </group>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd tools && pnpm --filter bricklayer exec tsc --noEmit 2>&1 | grep -v simulation-wasm | grep -v ERR_PNPM | grep -v undefined | grep -v '^$'`

Expected: Only the pre-existing simulation-wasm error (no new errors).

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/ColliderMarkers.tsx
git commit -m "feat(bricklayer): add ColliderMarkers component with wireframe shapes"
```

---

### Task 2: Wire ColliderMarkers into Viewport

**Files:**
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx:8,311`

- [ ] **Step 1: Add import**

At line 8 of `Viewport.tsx`, after the `GameObjectMarkers` import, add:

```typescript
import { ColliderMarkers } from './ColliderMarkers.js';
```

- [ ] **Step 2: Add component to SceneContent**

At line 312 (after `<GameObjectMarkers />`), add:

```tsx
      <ColliderMarkers />
```

So the block reads:

```tsx
      <GameObjectMarkers />
      <ColliderMarkers />
      <GsEmitterMarkers />
```

- [ ] **Step 3: Verify the file compiles**

Run: `cd tools && pnpm --filter bricklayer exec tsc --noEmit 2>&1 | grep -v simulation-wasm | grep -v ERR_PNPM | grep -v undefined | grep -v '^$'`

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/Viewport.tsx
git commit -m "feat(bricklayer): wire ColliderMarkers into Viewport SceneContent"
```

---

### Task 3: Add Colliders toggle to View menu

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/MenuBar.tsx:566`

- [ ] **Step 1: Add Colliders menu item**

After the "Object PLY" entry (line 566, after its closing `},`), add:

```typescript
    {
      label: `${useSceneStore.getState().showCollision ? '\u2713 ' : ''}Colliders`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowCollision(!s.showCollision);
      },
    },
```

So the viewItems array reads:

```typescript
    {
      label: `${useSceneStore.getState().showObjectPly ? '\u2713 ' : ''}Object PLY`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowObjectPly(!s.showObjectPly);
      },
    },
    {
      label: `${useSceneStore.getState().showCollision ? '\u2713 ' : ''}Colliders`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowCollision(!s.showCollision);
      },
    },
    {
      label: `${useSceneStore.getState().stagingAutoSync ? '\u2713 ' : ''}Auto-Sync Staging`,
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd tools && pnpm --filter bricklayer exec tsc --noEmit 2>&1 | grep -v simulation-wasm | grep -v ERR_PNPM | grep -v undefined | grep -v '^$'`

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/panels/MenuBar.tsx
git commit -m "feat(bricklayer): add Colliders toggle to View menu"
```

---

### Task 4: Verify end-to-end

- [ ] **Step 1: Final type-check**

Run: `cd tools && pnpm --filter bricklayer exec tsc --noEmit 2>&1 | grep -v simulation-wasm | grep -v ERR_PNPM | grep -v undefined | grep -v '^$'`

Expected: No new errors.

- [ ] **Step 2: Verify showCollision store flag exists**

```bash
cd tools && grep -n 'showCollision' apps/bricklayer/src/store/useSceneStore.ts | head -5
```

Expected: Lines showing `showCollision: boolean` (type), `showCollision: false` (default), `setShowCollision: (v) => set({ showCollision: v })` (setter).

- [ ] **Step 3: Verify ColliderMarkers renders for KCC objects**

Check that the scene JSON has game objects with `ColliderComponent`:

```bash
grep -c 'ColliderComponent' examples/island_demo/assets/scenes/seurat_island.json
```

Expected: `8` (the 8 KCC courtyard objects).

- [ ] **Step 4: No commit needed — verification only**

No files changed. If all checks pass, the feature is complete.
