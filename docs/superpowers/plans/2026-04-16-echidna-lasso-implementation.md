# Echidna Lasso Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement functional lasso selection in Echidna — drag to draw a polygon, all voxels whose projected center falls inside are selected with live preview.

**Architecture:** New SVG overlay component (`LassoOverlay`) layered on top of the R3F Canvas, active only when lasso tool is selected. Ray-casting point-in-polygon test applied to projected voxel centers. Live selection updates as user drags via existing `setLassoSelection`.

**Tech Stack:** TypeScript, React, React Three Fiber, Zustand, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tools/apps/echidna/src/lib/pointInPolygon.ts` | Create | Ray-casting polygon hit test |
| `tools/apps/echidna/src/__tests__/pointInPolygon.test.ts` | Create | Unit tests |
| `tools/apps/echidna/src/viewport/LassoOverlay.tsx` | Create | SVG overlay + selection logic |
| `tools/apps/echidna/src/viewport/AssetViewport.tsx` | Modify | Mount overlay, expose camera, disable OrbitControls when lasso active |
| `tools/apps/echidna/src/viewport/VoxelMesh.tsx` | Modify | Tint `lassoSelection` voxels green (same as boxSelection) |
| `tools/apps/echidna/src/expected-components.json` | Modify | Register `LassoOverlay` |

---

### Task 1: Point-in-polygon utility (TDD)

**Files:**
- Create: `tools/apps/echidna/src/lib/pointInPolygon.ts`
- Create: `tools/apps/echidna/src/__tests__/pointInPolygon.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/apps/echidna/src/__tests__/pointInPolygon.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pointInPolygon } from '../lib/pointInPolygon.js';

describe('pointInPolygon', () => {
  const triangle: [number, number][] = [[0, 0], [10, 0], [5, 10]];
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  // U-shape concave polygon
  const concave: [number, number][] = [
    [0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10],
  ];

  it('point inside triangle returns true', () => {
    expect(pointInPolygon(5, 3, triangle)).toBe(true);
  });

  it('point outside triangle returns false', () => {
    expect(pointInPolygon(15, 5, triangle)).toBe(false);
    expect(pointInPolygon(-1, 5, triangle)).toBe(false);
    expect(pointInPolygon(5, 15, triangle)).toBe(false);
  });

  it('point at center of square returns true', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it('point in concave region returns false', () => {
    // Inside the "U" notch
    expect(pointInPolygon(5, 8, concave)).toBe(false);
  });

  it('point in solid part of concave shape returns true', () => {
    expect(pointInPolygon(5, 1, concave)).toBe(true);
  });

  it('empty or degenerate polygon returns false', () => {
    expect(pointInPolygon(5, 5, [])).toBe(false);
    expect(pointInPolygon(5, 5, [[0, 0]])).toBe(false);
    expect(pointInPolygon(5, 5, [[0, 0], [10, 10]])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eccyan/dev/GSeurat/tools/apps/echidna && npx vitest run src/__tests__/pointInPolygon.test.ts 2>&1 || true
```

Expected: FAIL — `pointInPolygon` not found.

- [ ] **Step 3: Implement `pointInPolygon`**

Create `tools/apps/echidna/src/lib/pointInPolygon.ts`:

```ts
/**
 * Ray-casting point-in-polygon test.
 * Returns true if point (x, y) is inside the polygon defined by vertices.
 *
 * Uses the crossing number algorithm: cast a horizontal ray from the point
 * to +infinity and count how many polygon edges it crosses. Odd = inside.
 */
export function pointInPolygon(
  x: number,
  y: number,
  polygon: [number, number][],
): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/eccyan/dev/GSeurat/tools/apps/echidna && npx vitest run src/__tests__/pointInPolygon.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/lib/pointInPolygon.ts \
  tools/apps/echidna/src/__tests__/pointInPolygon.test.ts
git commit -m "feat(echidna): add pointInPolygon utility with tests"
```

---

### Task 2: Extend `VoxelMesh` green tint to `lassoSelection`

**Files:**
- Modify: `tools/apps/echidna/src/viewport/VoxelMesh.tsx`

- [ ] **Step 1: Add `lassoSelection` subscription and Set**

In `tools/apps/echidna/src/viewport/VoxelMesh.tsx`, find the existing `boxSelectionSet` usage. Near where `boxSelection` is read from the store, add `lassoSelection`:

Find:

```ts
  const boxSelection = useCharacterStore((s) => s.boxSelection);
```

Add after it:

```ts
  const lassoSelection = useCharacterStore((s) => s.lassoSelection);
```

Find where `boxSelectionSet` is computed (likely `useMemo`):

```ts
  const boxSelectionSet = useMemo(() => {
    if (!boxSelection) return null;
    return new Set(boxSelection);
  }, [boxSelection]);
```

Add after it (or merge):

```ts
  const lassoSelectionSet = useMemo(() => {
    if (!lassoSelection) return null;
    return new Set(lassoSelection);
  }, [lassoSelection]);
```

- [ ] **Step 2: Update tint logic to include lasso**

Find the block (around line 462):

```ts
      // Box selection highlight (green tint)
      if (boxSelectionSet?.has(key)) {
        g = Math.min(1, g + 0.2);
      }
```

Change to:

```ts
      // Box/lasso selection highlight (green tint)
      if (boxSelectionSet?.has(key) || lassoSelectionSet?.has(key)) {
        g = Math.min(1, g + 0.2);
      }
```

- [ ] **Step 3: Add `lassoSelectionSet` to the memo dependency array**

Find the `useMemo` dependency array that ends with `boxSelectionSet]);` (around line 472):

```ts
  }, [surfaceEntries, count, characterParts, selectedPart, selectedKeys, otherPartKeys, fkTransforms, voxelToPartId, colorByPart, partColors, boxSelectionSet]);
```

Change to:

```ts
  }, [surfaceEntries, count, characterParts, selectedPart, selectedKeys, otherPartKeys, fkTransforms, voxelToPartId, colorByPart, partColors, boxSelectionSet, lassoSelectionSet]);
```

- [ ] **Step 4: Build to verify**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/viewport/VoxelMesh.tsx
git commit -m "feat(echidna): tint lassoSelection voxels green"
```

---

### Task 3: Create `LassoOverlay` component

**Files:**
- Create: `tools/apps/echidna/src/viewport/LassoOverlay.tsx`

- [ ] **Step 1: Create the component**

Create `tools/apps/echidna/src/viewport/LassoOverlay.tsx`:

```tsx
import React, { useRef, useState, useCallback } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import * as THREE from 'three';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { parseKey } from '../lib/voxelUtils.js';
import { pointInPolygon } from '../lib/pointInPolygon.js';
import type { VoxelKey } from '../store/types.js';

const MIN_POINT_DISTANCE_PX = 5;

interface Props {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function LassoOverlay({ cameraRef, containerRef }: Props) {
  useComponentRegistry('LassoOverlay');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const voxels = useCharacterStore((s) => s.asset?.voxels ?? new Map());
  const setLassoSelection = useCharacterStore((s) => s.setLassoSelection);

  const [points, setPoints] = useState<[number, number][]>([]);
  const isDrawing = useRef(false);

  const isActive = activeTool === 'lasso_select';

  const projectVoxels = useCallback(
    (polygon: [number, number][]): VoxelKey[] => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return [];

      const rect = container.getBoundingClientRect();
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;
      const ndc = new THREE.Vector3();
      const selected: VoxelKey[] = [];

      for (const key of voxels.keys()) {
        const [vx, vy, vz] = parseKey(key);
        ndc.set(vx + 0.5, vy + 0.5, vz + 0.5);
        ndc.project(camera);
        // NDC (-1..1) to pixel (0..width, 0..height) — Y flipped
        const px = (ndc.x + 1) * halfW;
        const py = (1 - ndc.y) * halfH;
        if (pointInPolygon(px, py, polygon)) {
          selected.push(key);
        }
      }

      return selected;
    },
    [voxels, cameraRef, containerRef],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isActive) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setPoints([[x, y]]);
      isDrawing.current = true;
    },
    [isActive],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setPoints((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return [[x, y]];
        const dx = x - last[0];
        const dy = y - last[1];
        if (dx * dx + dy * dy < MIN_POINT_DISTANCE_PX * MIN_POINT_DISTANCE_PX) {
          return prev;
        }
        const next: [number, number][] = [...prev, [x, y]];
        // Live preview: update lasso selection as we drag
        if (next.length >= 3) {
          const selected = projectVoxels(next);
          setLassoSelection(selected.length > 0 ? selected : null);
        }
        return next;
      });
    },
    [projectVoxels, setLassoSelection],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);

      if (points.length >= 3) {
        const selected = projectVoxels(points);
        setLassoSelection(selected.length > 0 ? selected : null);
      }
      setPoints([]);
    },
    [points, projectVoxels, setLassoSelection],
  );

  if (!isActive) return null;

  const pathD = points.length > 0
    ? `M ${points[0][0]} ${points[0][1]} ` +
      points.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ') +
      (points.length > 2 ? ' Z' : '')
    : '';

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        cursor: 'crosshair',
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {pathD && (
        <path
          d={pathD}
          fill="rgba(119, 119, 255, 0.15)"
          stroke="#77f"
          strokeWidth={2}
          strokeDasharray="4 4"
        />
      )}
    </svg>
  );
}
```

- [ ] **Step 2: Build to verify**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/viewport/LassoOverlay.tsx
git commit -m "feat(echidna): add LassoOverlay component"
```

---

### Task 4: Mount LassoOverlay in AssetViewport

**Files:**
- Modify: `tools/apps/echidna/src/viewport/AssetViewport.tsx`

- [ ] **Step 1: Add imports**

At the top of `tools/apps/echidna/src/viewport/AssetViewport.tsx`, the existing imports include:

```ts
import React, { useRef, useEffect } from 'react';
```

Add to that import:

```ts
import React, { useRef, useEffect } from 'react';
```

(already correct). Then add the lasso + store imports after existing ones:

```ts
import { LassoOverlay } from './LassoOverlay.js';
import { useCharacterStore } from '../store/useCharacterStore.js';
```

(Note: `useCharacterStore` may already be imported — only add if missing.)

- [ ] **Step 2: Add CameraExposer component**

Inside `AssetViewport.tsx`, after the existing `InitialInvalidator` function (around line 22), add a new component:

```tsx
/** Exposes the R3F camera to a ref so overlay components can use it. */
function CameraExposer({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const { camera } = useThree();
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera, cameraRef]);
  return null;
}
```

- [ ] **Step 3: Use refs and mount LassoOverlay**

Change the `AssetViewport` function (currently line 67):

```tsx
export function AssetViewport() {
  useComponentRegistry('AssetViewport');
  const gridWidth = useCharacterStore((s) => s.asset?.gridWidth ?? 32);
  const gridDepth = useCharacterStore((s) => s.asset?.gridDepth ?? 32);
  const showGrid = useCharacterStore((s) => s.showGrid);

  return (
    <Canvas
      ...
    </Canvas>
  );
}
```

To:

```tsx
export function AssetViewport() {
  useComponentRegistry('AssetViewport');
  const gridWidth = useCharacterStore((s) => s.asset?.gridWidth ?? 32);
  const gridDepth = useCharacterStore((s) => s.asset?.gridDepth ?? 32);
  const showGrid = useCharacterStore((s) => s.showGrid);
  const activeTool = useCharacterStore((s) => s.activeTool);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const lassoActive = activeTool === 'lasso_select';

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        frameloop="always"
        camera={{ position: [gridWidth / 2, 20, gridDepth + 15], fov: 50 }}
        style={{ background: '#16162a' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[20, 40, 30]} intensity={0.8} />
        <directionalLight position={[-10, 20, -20]} intensity={0.3} />

        {showGrid && (
          <Grid
            args={[gridWidth, gridDepth]}
            position={[gridWidth / 2 - 0.5, -0.5, gridDepth / 2 - 0.5]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#334"
            sectionSize={8}
            sectionThickness={1}
            sectionColor="#446"
            fadeDistance={200}
            infiniteGrid={false}
          />
        )}

        <VoxelMesh />
        <GroundPlane />
        <GhostVoxel />
        <JointGizmos />
        <MirrorPlane />
        <CameraFitter />
        <InitialInvalidator />
        <CameraExposer cameraRef={cameraRef} />

        <OrbitControls
          enabled={!lassoActive}
          target={[gridWidth / 2, 0, gridDepth / 2]}
          makeDefault
          screenSpacePanning
          mouseButtons={{
            LEFT: 0,
            MIDDLE: 1,
            RIGHT: 2,
          }}
          touches={{
            ONE: 0,
            TWO: 1,
          }}
        />
      </Canvas>
      <LassoOverlay cameraRef={cameraRef} containerRef={containerRef} />
    </div>
  );
}
```

Key changes:
- Wrap `<Canvas>` in a `<div ref={containerRef}>` with `position: 'relative'` so the SVG can absolute-position on top
- Add `CameraExposer` inside the Canvas
- Add `enabled={!lassoActive}` on OrbitControls to disable camera control during lasso drag
- Render `<LassoOverlay>` outside the Canvas, inside the div

- [ ] **Step 4: Build to verify**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/viewport/AssetViewport.tsx
git commit -m "feat(echidna): mount LassoOverlay, disable OrbitControls during lasso"
```

---

### Task 5: Register LassoOverlay in expected-components

**Files:**
- Modify: `tools/apps/echidna/src/expected-components.json`

- [ ] **Step 1: Add LassoOverlay to the JSON**

Read `tools/apps/echidna/src/expected-components.json`. Find where other viewport components like `VoxelMesh`, `GhostVoxel`, or `JointGizmos` are registered. Add `"LassoOverlay"` to the same section (likely `always` or a viewport-related array).

If unsure, place it in `conditional` since LassoOverlay only renders when lasso tool is active.

- [ ] **Step 2: Build to verify**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/expected-components.json
git commit -m "chore(echidna): register LassoOverlay in expected-components"
```
