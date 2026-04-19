# Spline VFX Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let level designers draw spline paths for VFX instances in the Bricklayer 3D viewport, with per-instance control point overrides stored in scene JSON.

**Architecture:** Add optional `splinePoints` field to VfxInstanceData. A new SplineEditor viewport component handles click-to-place and drag interaction. The C++ engine reads `spline_points` from scene JSON and overrides the preset's default control points. Shared spline math stays in `@gseurat/vfx-utils`; display components are per-app (~25 lines each).

**Tech Stack:** TypeScript/React (Bricklayer), React Three Fiber, Three.js, Zustand, C++23/nlohmann::json (engine)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `tools/apps/bricklayer/src/store/types.ts:277-288` | Add `splinePoints` to VfxInstanceData |
| Modify | `tools/apps/bricklayer/src/store/useSceneStore.ts:253,302-305` | Add `editingSpline` state + setter |
| Create | `tools/apps/bricklayer/src/viewport/SplineEditor.tsx` | Interactive spline editing overlay |
| Modify | `tools/apps/bricklayer/src/viewport/VfxInstanceMarkers.tsx:15-33` | Use shared display, show override points |
| Modify | `tools/apps/bricklayer/src/viewport/Viewport.tsx:307` | Add `<SplineEditor />` to SceneContent |
| Modify | `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx:1383-1450` | Add Edit Spline button + point count |
| Modify | `tools/apps/bricklayer/src/lib/sceneExport.ts:366-379` | Export `spline_points` field |
| Modify | `tools/apps/bricklayer/src/lib/projectIO.ts:518-658` | Import `spline_points` field |
| Modify | `schemas/scene.schema.json:147-179` | Add `spline_points` to VFX instance schema |
| Modify | `include/gseurat/engine/scene_loader.hpp:166-173` | Add `spline_points` to VfxInstanceRef |
| Modify | `src/engine/scene_loader.cpp:541-550` | Parse `spline_points` from JSON |
| Modify | `src/engine/gs_scene_loader.cpp:410-418` | Override preset spline with instance points |

---

### Task 1: Add splinePoints to VfxInstanceData type

**Files:**
- Modify: `tools/apps/bricklayer/src/store/types.ts:277-288`

- [ ] **Step 1: Add the optional field to VfxInstanceData**

In `tools/apps/bricklayer/src/store/types.ts`, find the `VfxInstanceData` interface and add:

```typescript
export interface VfxInstanceData {
  id: string;
  muted?: boolean;
  name: string;
  vfx_file: string;
  vfx_preset: VfxPresetData;
  position: [number, number, number];
  rotation_y: number;
  radius: number;
  trigger: 'auto' | 'event';
  loop: boolean;
  splinePoints?: [number, number, number][];  // per-instance spline override (instance-relative)
}
```

- [ ] **Step 2: Verify build**

Run: `cd tools && pnpm --filter bricklayer build`
Expected: Build succeeds (optional field is backward compatible)

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/store/types.ts
git commit -m "feat(bricklayer): add splinePoints field to VfxInstanceData"
```

---

### Task 2: Add editingSpline state to store

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`

- [ ] **Step 1: Add state and action type declarations**

Find the state interface section (around line 253) and add:

```typescript
editingSpline: string | null;
```

Find the actions section (around line 302-305) and add:

```typescript
setEditingSpline: (id: string | null) => void;
```

- [ ] **Step 2: Add initial state and implementation**

In the store creation (the `create` call), add initial state:

```typescript
editingSpline: null,
```

Add the action implementation:

```typescript
setEditingSpline: (id) => {
  if (id) {
    // Lock orbit while editing spline
    set({ editingSpline: id, orbitLocked: true });
  } else {
    set({ editingSpline: null, orbitLocked: false });
  }
},
```

- [ ] **Step 3: Verify build**

Run: `cd tools && pnpm --filter bricklayer build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "feat(bricklayer): add editingSpline state and setter"
```

---

### Task 3: Export and import spline_points

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/sceneExport.ts:366-379`
- Modify: `tools/apps/bricklayer/src/lib/projectIO.ts:518-658`

- [ ] **Step 1: Add spline_points to scene export**

In `tools/apps/bricklayer/src/lib/sceneExport.ts`, find the VFX instance export (around line 366). After the `if (!v.loop) out.loop = false;` line, add:

```typescript
    if (v.splinePoints && v.splinePoints.length > 0) {
      out.spline_points = v.splinePoints;
    }
```

- [ ] **Step 2: Add spline_points to engine scene import**

In `tools/apps/bricklayer/src/lib/projectIO.ts`, find the `importEngineScene` function. In the section where VFX instances are converted (around line 644, inside the BricklayerFile construction), ensure `vfxInstances` mapping includes:

```typescript
vfxInstances: engine.vfx_instances?.map((v: any) => ({
  ...v,
  splinePoints: v.spline_points ?? undefined,
})) ?? undefined,
```

If VFX instances are passed through directly (`engine.vfx_instances`), change to map and add the camelCase conversion.

- [ ] **Step 3: Verify build**

Run: `cd tools && pnpm --filter bricklayer build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/lib/sceneExport.ts tools/apps/bricklayer/src/lib/projectIO.ts
git commit -m "feat(bricklayer): export/import spline_points for VFX instances"
```

---

### Task 4: Update scene schema

**Files:**
- Modify: `schemas/scene.schema.json`

- [ ] **Step 1: Add spline_points to VFX instance schema**

In `schemas/scene.schema.json`, find the VFX instance items definition (around line 147-179). Add `spline_points` as an optional property:

```json
"spline_points": {
  "type": "array",
  "description": "Per-instance spline control points (instance-relative). Overrides preset spline.",
  "items": {
    "type": "array",
    "items": { "type": "number" },
    "minItems": 3,
    "maxItems": 3
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add schemas/scene.schema.json
git commit -m "feat(schema): add spline_points to VFX instance definition"
```

---

### Task 5: C++ engine — parse and apply spline_points override

**Files:**
- Modify: `include/gseurat/engine/scene_loader.hpp:166-173`
- Modify: `src/engine/scene_loader.cpp:541-550`
- Modify: `src/engine/gs_scene_loader.cpp:410-418`

- [ ] **Step 1: Add spline_points field to VfxInstanceRef**

In `include/gseurat/engine/scene_loader.hpp`, find `VfxInstanceRef` (line 166) and add:

```cpp
struct VfxInstanceRef {
    std::string vfx_file;
    coord::GridPos position;
    float rotation_y = 0.0f;
    float radius = 5.0f;
    std::string trigger = "auto";
    bool loop = true;
    std::vector<glm::vec3> spline_points;  // per-instance override (empty = use preset)
};
```

- [ ] **Step 2: Parse spline_points from scene JSON**

In `src/engine/scene_loader.cpp`, find the VFX instance parsing loop (line 541). After `inst.loop = ...;`, add:

```cpp
            if (vi.contains("spline_points")) {
                for (const auto& pt : vi["spline_points"]) {
                    inst.spline_points.emplace_back(
                        pt[0].get<float>(), pt[1].get<float>(), pt[2].get<float>());
                }
            }
```

- [ ] **Step 3: Override preset spline control points when loading VFX**

In `src/engine/gs_scene_loader.cpp`, find the VFX instance init loop (line 410). Change:

```cpp
        for (const auto& vi : scene_data.vfx_instances) {
            if (vi.trigger != "auto") continue;
            auto preset = load_vfx_preset(vi.vfx_file);
            if (preset.elements.empty()) continue;

            // Override preset spline control points with per-instance points
            if (!vi.spline_points.empty()) {
                for (auto& el : preset.elements) {
                    if (el.spline_config.mode != SplineMode::None) {
                        el.spline_config.path.control_points = vi.spline_points;
                    }
                }
            }

            VfxInstance inst;
            auto world_pos = coord::to_world(vi.position, ctx.terrain.terrain_aabb);
            inst.init(preset, world_pos.vec(), vi.loop, vi.rotation_y);
            ctx.renderer.add_vfx_instance(std::move(inst));
        }
```

- [ ] **Step 4: Verify C++ build**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/scene_loader.hpp src/engine/scene_loader.cpp src/engine/gs_scene_loader.cpp
git commit -m "feat(engine): parse and apply per-instance spline_points override"
```

---

### Task 6: SplineEditor viewport component

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/SplineEditor.tsx`
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx`

- [ ] **Step 1: Create SplineEditor component**

Create `tools/apps/bricklayer/src/viewport/SplineEditor.tsx`:

```typescript
import React, { useCallback, useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import { useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleCatmullRom } from '@gseurat/vfx-utils';
import { useSceneStore } from '../store/useSceneStore.js';

const POINT_COLOR = '#f59e0b';
const CURVE_COLOR = '#fbbf24';
const HANDLE_RADIUS = 0.6;

export function SplineEditor() {
  const editingSpline = useSceneStore((s) => s.editingSpline);
  const vfxInstances = useSceneStore((s) => s.vfxInstances);
  const updateVfxInstance = useSceneStore((s) => s.updateVfxInstance);
  const setEditingSpline = useSceneStore((s) => s.setEditingSpline);
  const { camera } = useThree();

  const dragging = useRef<number | null>(null);
  const planeRef = useRef<THREE.Mesh>(null);

  const instance = useMemo(
    () => vfxInstances.find((v) => v.id === editingSpline),
    [vfxInstances, editingSpline],
  );

  const points = instance?.splinePoints ?? [];
  const instancePos = instance?.position ?? [0, 0, 0];

  const curvePoints = useMemo(
    () => (points.length >= 2 ? sampleCatmullRom(points, 64) : []),
    [points],
  );

  // Escape to exit
  React.useEffect(() => {
    if (!editingSpline) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditingSpline(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingSpline, setEditingSpline]);

  const updatePoints = useCallback(
    (newPoints: [number, number, number][]) => {
      if (!editingSpline) return;
      updateVfxInstance(editingSpline, { splinePoints: newPoints });
    },
    [editingSpline, updateVfxInstance],
  );

  // Click on ground plane → add point
  const handlePlaneClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (dragging.current !== null) return;
      if (e.button !== 0) return;  // left click only
      e.stopPropagation();

      // Convert hit to instance-relative coordinates
      const hit = e.point;
      const rel: [number, number, number] = [
        Math.round((hit.x - instancePos[0]) * 10) / 10,
        Math.round((hit.y - instancePos[1]) * 10) / 10,
        Math.round((hit.z - instancePos[2]) * 10) / 10,
      ];
      updatePoints([...points, rel]);
    },
    [points, instancePos, updatePoints],
  );

  // Right-click on control point → remove
  const handlePointRightClick = useCallback(
    (idx: number, e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      e.nativeEvent.preventDefault();
      const newPts = points.filter((_, i) => i !== idx);
      updatePoints(newPts);
    },
    [points, updatePoints],
  );

  // Drag control point
  const handlePointPointerDown = useCallback(
    (idx: number, e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
      dragging.current = idx;
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (dragging.current === null || !planeRef.current) return;
      e.stopPropagation();

      // Raycast against drag plane
      const raycaster = new THREE.Raycaster();
      const rect = (e.nativeEvent.target as HTMLElement)?.getBoundingClientRect?.();
      if (!rect) return;
      const pointer = new THREE.Vector2(
        ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -instancePos[1]);
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersection)) {
        const rel: [number, number, number] = [
          Math.round((intersection.x - instancePos[0]) * 10) / 10,
          Math.round((intersection.y - instancePos[1]) * 10) / 10,
          Math.round((intersection.z - instancePos[2]) * 10) / 10,
        ];
        const newPts = [...points];
        newPts[dragging.current] = rel;
        updatePoints(newPts);
      }
    },
    [points, instancePos, camera, updatePoints],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  if (!editingSpline || !instance) return null;

  return (
    <group position={instancePos}>
      {/* Interpolated curve */}
      {curvePoints.length >= 2 && (
        <Line points={curvePoints} color={CURVE_COLOR} lineWidth={3} />
      )}

      {/* Control point handles */}
      {points.map((pt, i) => (
        <mesh
          key={i}
          position={pt}
          onPointerDown={(e) => handlePointPointerDown(i, e)}
          onContextMenu={(e) => handlePointRightClick(i, e)}
        >
          <sphereGeometry args={[HANDLE_RADIUS, 12, 12]} />
          <meshBasicMaterial color={POINT_COLOR} />
        </mesh>
      ))}

      {/* Invisible ground plane for click-to-place and drag */}
      <mesh
        ref={planeRef}
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={handlePlaneClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        visible={false}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 2: Add SplineEditor to Viewport**

In `tools/apps/bricklayer/src/viewport/Viewport.tsx`, add the import at the top:

```typescript
import { SplineEditor } from './SplineEditor.js';
```

In the `SceneContent` component, add `<SplineEditor />` after `<GrabPlane />` (around line 321):

```typescript
      <GrabPlane />
      <SplineEditor />
```

- [ ] **Step 3: Verify build**

Run: `cd tools && pnpm --filter bricklayer build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/SplineEditor.tsx tools/apps/bricklayer/src/viewport/Viewport.tsx
git commit -m "feat(bricklayer): add SplineEditor viewport component"
```

---

### Task 7: Update VfxInstanceMarkers to show override spline

**Files:**
- Modify: `tools/apps/bricklayer/src/viewport/VfxInstanceMarkers.tsx:15-33`

- [ ] **Step 1: Show instance spline override when present**

In `tools/apps/bricklayer/src/viewport/VfxInstanceMarkers.tsx`, find where `EmitterSplineGizmo` is rendered (around line 68-69). Change the logic to prefer instance `splinePoints` over preset spline:

```typescript
            {(() => {
              // Prefer per-instance spline override, fall back to preset spline
              const overridePoints = (inst as any).splinePoints as [number, number, number][] | undefined;
              if (overridePoints && overridePoints.length >= 2) {
                return <EmitterSplineGizmo points={overridePoints} mode={spline?.mode ?? 'emitter_path'} />;
              }
              if (spline?.control_points && spline.control_points.length >= 2) {
                return <EmitterSplineGizmo points={spline.control_points} mode={spline.mode ?? 'emitter_path'} />;
              }
              return null;
            })()}
```

- [ ] **Step 2: Verify build**

Run: `cd tools && pnpm --filter bricklayer build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/VfxInstanceMarkers.tsx
git commit -m "feat(bricklayer): show per-instance spline override in VFX markers"
```

---

### Task 8: Add Edit Spline button to properties panel

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx:1383-1450`

- [ ] **Step 1: Add Edit Spline UI to VfxInstanceProperties**

In `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx`, find the `VfxInstanceProperties` component (around line 1383). Add the spline editing controls after the existing fields (loop checkbox area):

```typescript
      {/* Spline editing — show if preset has spline elements */}
      {(() => {
        const hasSpline = vfx.vfx_preset?.elements?.some(
          (el: any) => el.emitter?.spline?.mode && el.emitter.spline.mode !== 'none'
        );
        if (!hasSpline) return null;

        const isEditing = useSceneStore.getState().editingSpline === vfx.id;
        const pointCount = vfx.splinePoints?.length ?? 0;

        return (
          <div style={{ marginTop: 8, borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>Spline Path</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button
                style={{
                  padding: '4px 8px', fontSize: 11,
                  background: isEditing ? '#f59e0b' : '#334',
                  color: isEditing ? '#000' : '#ccc',
                  border: 'none', borderRadius: 3, cursor: 'pointer',
                }}
                onClick={() => {
                  const store = useSceneStore.getState();
                  if (isEditing) {
                    store.setEditingSpline(null);
                  } else {
                    // Initialize from preset if no override yet
                    if (!vfx.splinePoints || vfx.splinePoints.length === 0) {
                      const presetPoints = vfx.vfx_preset?.elements
                        ?.find((el: any) => el.emitter?.spline?.control_points)
                        ?.emitter?.spline?.control_points;
                      if (presetPoints) {
                        store.updateVfxInstance(vfx.id, { splinePoints: [...presetPoints] });
                      }
                    }
                    store.setEditingSpline(vfx.id);
                  }
                }}
              >
                {isEditing ? 'Done Editing' : 'Edit Spline'}
              </button>
              {pointCount > 0 && (
                <>
                  <span style={{ fontSize: 10, color: '#888' }}>{pointCount} pts</span>
                  <button
                    style={{
                      padding: '2px 6px', fontSize: 10,
                      background: '#433', color: '#c88',
                      border: 'none', borderRadius: 3, cursor: 'pointer',
                    }}
                    onClick={() => {
                      useSceneStore.getState().updateVfxInstance(vfx.id, { splinePoints: undefined });
                      useSceneStore.getState().setEditingSpline(null);
                    }}
                  >
                    Reset
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 2: Verify build**

Run: `cd tools && pnpm --filter bricklayer build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx
git commit -m "feat(bricklayer): add Edit Spline button to VFX instance properties"
```

---

### Task 9: Place spline VFX in demo scene

**Files:**
- Modify: `examples/island_demo/assets/scenes/seurat_island.json`
- Modify: `examples/island_demo/tools_data/bricklayer/seurat_island.bricklayer`

- [ ] **Step 1: Add spline_dragon_flame VFX instance to seurat_island**

Using Python, add the two spline VFX instances:

```python
import json

si_path = "examples/island_demo/assets/scenes/seurat_island.json"
si = json.load(open(si_path))

# Dragon flame arc over cliff overlook
si["vfx_instances"].append({
    "vfx_file": "assets/vfx/spline_dragon_flame.vfx.json",
    "position": [230, 4, 145],
    "spline_points": [[0,0,0], [10,5,15], [20,10,10], [30,5,25]],
    "rotation_y": 0,
    "radius": 10,
    "trigger": "auto",
    "loop": True
})

# Smoke trail near house chimney
si["vfx_instances"].append({
    "vfx_file": "assets/vfx/spline_smoke_trail.vfx.json",
    "position": [192, 6, 175],
    "spline_points": [[0,0,0], [0,3,1], [1,8,0]],
    "rotation_y": 0,
    "radius": 8,
    "trigger": "auto",
    "loop": True
})

with open(si_path, 'w') as f:
    json.dump(si, f, indent=2)
```

- [ ] **Step 2: Re-sync .bricklayer file**

Run the bricklayer sync script (or manually ensure the .bricklayer file matches):

```bash
python3 scripts/validate_bricklayer_sync.py
```

If out of sync, run the sync process to regenerate the `.bricklayer` file from engine JSON.

- [ ] **Step 3: Commit**

```bash
git add examples/island_demo/assets/scenes/seurat_island.json examples/island_demo/tools_data/bricklayer/seurat_island.bricklayer
git commit -m "feat(demo): place spline_dragon_flame and spline_smoke_trail in seurat_island"
```

---

### Task 10: Verify end-to-end and final cleanup

- [ ] **Step 1: Run full TS build**

Run: `cd tools && pnpm --filter bricklayer build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run C++ build**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds

- [ ] **Step 3: Run bricklayer sync validation**

Run: `python3 scripts/validate_bricklayer_sync.py`
Expected: All scenes in sync

- [ ] **Step 4: Visual verification in Bricklayer**

1. Start Bricklayer: `cd tools && pnpm --filter bricklayer dev`
2. Open the island_demo project
3. Expand seurat_island chunk
4. Select the spline_dragon_flame VFX instance
5. Verify the spline curve renders in the viewport
6. Click "Edit Spline" — verify click-to-place works
7. Drag a control point — verify it moves
8. Right-click a point — verify it's removed
9. Press Escape — verify edit mode exits

- [ ] **Step 5: Final commit and PR**

```bash
git push -u origin feature/spline-vfx-authoring
gh pr create --title "feat: spline VFX authoring in Bricklayer" \
  --body "Closes #312. Per-instance spline point overrides for VFX instances."
```
