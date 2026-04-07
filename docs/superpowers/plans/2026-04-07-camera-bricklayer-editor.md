# Camera Zone Bricklayer Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add interactive camera zone editing to Bricklayer — volumes, triggers, and rails with draggable gizmos, frustum visualization, and possess-camera preview mode.

**Architecture:** Follow the established Bricklayer entity pattern: TypeScript types → Zustand store (add/update/remove) → ProjectTree navigation → ScenePropertiesPanel editors → viewport gizmo markers → scene export. New files: 3 editor panels, 3 viewport components (markers, frustum, possess mode). Modified: types, store, tree, properties panel, viewport, export.

**Tech Stack:** TypeScript, React, Zustand, Three.js, React Three Fiber (R3F), drei (Html, Line, TransformControls)

**Spec:** `docs/superpowers/specs/2026-04-07-camera-bricklayer-editor-design.md`

---

### File Structure

| File | Purpose |
|------|---------|
| `tools/apps/bricklayer/src/store/types.ts` | Add CameraShape, CameraZoneParams, CameraZoneVolume, CameraZoneTrigger, CameraZoneRail types (modify) |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Add camera state + actions + save/load (modify) |
| `tools/apps/bricklayer/src/panels/ProjectTree.tsx` | Add Camera section with Volumes/Triggers/Rails (modify) |
| `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx` | Route to camera editors (modify) |
| `tools/apps/bricklayer/src/panels/CameraVolumeEditor.tsx` | Volume parameter editor + Possess button (new) |
| `tools/apps/bricklayer/src/panels/CameraTriggerEditor.tsx` | Trigger parameter editor (new) |
| `tools/apps/bricklayer/src/panels/CameraRailEditor.tsx` | Rail control point editor (new) |
| `tools/apps/bricklayer/src/viewport/CameraZoneMarkers.tsx` | Volume/trigger wireframes + TransformControls (new) |
| `tools/apps/bricklayer/src/viewport/CameraRailMarkers.tsx` | Rail spline line + control point spheres (new) |
| `tools/apps/bricklayer/src/viewport/CameraFrustumGizmo.tsx` | FOV frustum + pitch/yaw constraint fans (new) |
| `tools/apps/bricklayer/src/viewport/Viewport.tsx` | Include new marker components (modify) |
| `tools/apps/bricklayer/src/lib/sceneExport.ts` | Export camera_zones block (modify) |
| `tools/apps/bricklayer/src/App.tsx` | Possess mode state + keyboard shortcut (modify) |

---

### Task 1: Type Definitions

**Files:**
- Modify: `tools/apps/bricklayer/src/store/types.ts`

- [ ] **Step 1: Add CameraShape and CameraZoneParams interfaces**

Add after the `VfxInstanceData` interface (around line 310) in `types.ts`:

```typescript
// ── Camera Zone Types (Phase 2) ──

export interface CameraShape {
  type: 'aabb' | 'sphere';
  center: [number, number, number];
  half_extents?: [number, number, number];  // AABB only
  radius?: number;                           // Sphere only
}

export interface CameraZoneParams {
  mode: 'free_look' | 'rail_follow' | 'cinematic_rail' | 'fixed_point' | 'side_scroll';
  priority: number;
  blend_time: number;
  allow_user_orbit: boolean;
  pitch_min: number;
  pitch_max: number;
  yaw_min: number;
  yaw_max: number;
  fov: number;
  orbit_distance: number;
  offset: [number, number, number];
  fixed_position?: [number, number, number];
  rail_id?: string;
}

export const DEFAULT_CAMERA_ZONE_PARAMS: CameraZoneParams = {
  mode: 'free_look',
  priority: 0,
  blend_time: 1.0,
  allow_user_orbit: true,
  pitch_min: -60,
  pitch_max: 10,
  yaw_min: -180,
  yaw_max: 180,
  fov: 45,
  orbit_distance: 10,
  offset: [0, 5, -10],
};

export interface CameraZoneVolume {
  id: string;
  name: string;
  shape: CameraShape;
  params: CameraZoneParams;
}

export interface CameraZoneTrigger {
  id: string;
  shape: CameraShape;
  from_zone?: string;
  to_zone: string;
  blend_override: number;
}

export interface CameraZoneRail {
  id: string;
  name: string;
  control_points: [number, number, number][];
  target_points?: [number, number, number][];
}
```

- [ ] **Step 2: Add camera fields to BricklayerFile scene type**

In the `BricklayerFile` interface's `scene` block (around line 395), add after `vfxInstances`:

```typescript
    cameraVolumes?: CameraZoneVolume[];
    cameraTriggers?: CameraZoneTrigger[];
    cameraRails?: CameraZoneRail[];
    cameraDefaultParams?: Partial<CameraZoneParams>;
    cameraShowDebugVolumes?: boolean;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/store/types.ts
git commit -m "feat(bricklayer): add camera zone type definitions"
```

---

### Task 2: Store — State and Actions

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`

- [ ] **Step 1: Add camera state fields to SceneStoreState**

In the `SceneStoreState` interface, after `navZoneNames` (around line 225), add:

```typescript
  // Camera zones
  cameraVolumes: CameraZoneVolume[];
  cameraTriggers: CameraZoneTrigger[];
  cameraRails: CameraZoneRail[];
  cameraDefaultParams: Partial<CameraZoneParams>;
  cameraShowDebugVolumes: boolean;
```

Add imports at the top of the file:

```typescript
import type { CameraZoneVolume, CameraZoneTrigger, CameraZoneRail, CameraZoneParams, CameraShape } from './types.js';
import { DEFAULT_CAMERA_ZONE_PARAMS } from './types.js';
```

- [ ] **Step 2: Add action declarations**

In the actions section of `SceneStoreState` (after `removeVfxInstance`), add:

```typescript
  // Camera zones
  addCameraVolume: (position?: [number, number, number]) => void;
  updateCameraVolume: (id: string, patch: Partial<CameraZoneVolume>) => void;
  removeCameraVolume: (id: string) => void;
  addCameraTrigger: (position?: [number, number, number]) => void;
  updateCameraTrigger: (id: string, patch: Partial<CameraZoneTrigger>) => void;
  removeCameraTrigger: (id: string) => void;
  addCameraRail: () => void;
  updateCameraRail: (id: string, patch: Partial<CameraZoneRail>) => void;
  removeCameraRail: (id: string) => void;
  addRailControlPoint: (railId: string, point: [number, number, number]) => void;
  removeRailControlPoint: (railId: string, index: number) => void;
  updateRailControlPoint: (railId: string, index: number, point: [number, number, number]) => void;
  updateCameraDefaultParams: (patch: Partial<CameraZoneParams>) => void;
  setCameraShowDebugVolumes: (show: boolean) => void;
```

- [ ] **Step 3: Add initial state values**

In the `create()` initial state object, add after the `navZoneNames` initializer:

```typescript
      cameraVolumes: [],
      cameraTriggers: [],
      cameraRails: [],
      cameraDefaultParams: {},
      cameraShowDebugVolumes: false,
```

- [ ] **Step 4: Implement actions**

After the VFX actions (around line 730), add:

```typescript
      // ── Camera Zone Actions ──

      addCameraVolume: (pos) => {
        const vol: CameraZoneVolume = {
          id: genId('camvol'),
          name: `Volume ${get().cameraVolumes.length + 1}`,
          shape: { type: 'aabb', center: pos ?? [0, 2, 0], half_extents: [5, 5, 5] },
          params: { ...DEFAULT_CAMERA_ZONE_PARAMS },
        };
        set({ cameraVolumes: [...get().cameraVolumes, vol], isDirty: true });
      },
      updateCameraVolume: (id, patch) => set({
        cameraVolumes: get().cameraVolumes.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        isDirty: true,
      }),
      removeCameraVolume: (id) => set({
        cameraVolumes: get().cameraVolumes.filter((v) => v.id !== id),
        isDirty: true,
      }),

      addCameraTrigger: (pos) => {
        const trig: CameraZoneTrigger = {
          id: genId('camtrig'),
          shape: { type: 'aabb', center: pos ?? [0, 2, 0], half_extents: [1, 3, 3] },
          to_zone: '',
          blend_override: -1,
        };
        set({ cameraTriggers: [...get().cameraTriggers, trig], isDirty: true });
      },
      updateCameraTrigger: (id, patch) => set({
        cameraTriggers: get().cameraTriggers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        isDirty: true,
      }),
      removeCameraTrigger: (id) => set({
        cameraTriggers: get().cameraTriggers.filter((t) => t.id !== id),
        isDirty: true,
      }),

      addCameraRail: () => {
        const rail: CameraZoneRail = {
          id: genId('camrail'),
          name: `Rail ${get().cameraRails.length + 1}`,
          control_points: [[0, 5, 0], [5, 5, 0], [10, 5, 0]],
        };
        set({ cameraRails: [...get().cameraRails, rail], isDirty: true });
      },
      updateCameraRail: (id, patch) => set({
        cameraRails: get().cameraRails.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        isDirty: true,
      }),
      removeCameraRail: (id) => set({
        cameraRails: get().cameraRails.filter((r) => r.id !== id),
        isDirty: true,
      }),
      addRailControlPoint: (railId, point) => set({
        cameraRails: get().cameraRails.map((r) =>
          r.id === railId ? { ...r, control_points: [...r.control_points, point] } : r),
        isDirty: true,
      }),
      removeRailControlPoint: (railId, index) => set({
        cameraRails: get().cameraRails.map((r) =>
          r.id === railId ? { ...r, control_points: r.control_points.filter((_, i) => i !== index) } : r),
        isDirty: true,
      }),
      updateRailControlPoint: (railId, index, point) => set({
        cameraRails: get().cameraRails.map((r) =>
          r.id === railId ? { ...r, control_points: r.control_points.map((p, i) => i === index ? point : p) } : r),
        isDirty: true,
      }),
      updateCameraDefaultParams: (patch) => set({
        cameraDefaultParams: { ...get().cameraDefaultParams, ...patch },
        isDirty: true,
      }),
      setCameraShowDebugVolumes: (show) => set({ cameraShowDebugVolumes: show, isDirty: true }),
```

- [ ] **Step 5: Update saveProject**

In `saveProject()`, add to the `scene` object after `vfxInstances`:

```typescript
        cameraVolumes: s.cameraVolumes.length > 0 ? s.cameraVolumes : undefined,
        cameraTriggers: s.cameraTriggers.length > 0 ? s.cameraTriggers : undefined,
        cameraRails: s.cameraRails.length > 0 ? s.cameraRails : undefined,
        cameraDefaultParams: Object.keys(s.cameraDefaultParams).length > 0 ? s.cameraDefaultParams : undefined,
        cameraShowDebugVolumes: s.cameraShowDebugVolumes || undefined,
```

- [ ] **Step 6: Update loadProject**

In `loadProject()`, add to the state restoration (after `vfxInstances`):

```typescript
      cameraVolumes: data.scene.cameraVolumes ?? [],
      cameraTriggers: data.scene.cameraTriggers ?? [],
      cameraRails: data.scene.cameraRails ?? [],
      cameraDefaultParams: data.scene.cameraDefaultParams ?? {},
      cameraShowDebugVolumes: data.scene.cameraShowDebugVolumes ?? false,
```

- [ ] **Step 7: Build and verify**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "feat(bricklayer): add camera zone store state and actions"
```

---

### Task 3: Project Tree — Camera Section

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/ProjectTree.tsx`

- [ ] **Step 1: Add store selectors for camera data**

At the top of the component where other store selectors are declared, add:

```typescript
  const cameraVolumes = useSceneStore((s) => s.cameraVolumes);
  const cameraTriggers = useSceneStore((s) => s.cameraTriggers);
  const cameraRails = useSceneStore((s) => s.cameraRails);
  const addCameraVolume = useSceneStore((s) => s.addCameraVolume);
  const addCameraTrigger = useSceneStore((s) => s.addCameraTrigger);
  const addCameraRail = useSceneStore((s) => s.addCameraRail);
  const removeCameraVolume = useSceneStore((s) => s.removeCameraVolume);
  const removeCameraTrigger = useSceneStore((s) => s.removeCameraTrigger);
  const removeCameraRail = useSceneStore((s) => s.removeCameraRail);
```

Add state for section open/closed:

```typescript
  const [cameraOpen, setCameraOpen] = useState(false);
  const [camVolOpen, setCamVolOpen] = useState(true);
  const [camTrigOpen, setCamTrigOpen] = useState(true);
  const [camRailOpen, setCamRailOpen] = useState(true);
```

- [ ] **Step 2: Add Camera tree section**

After the VFX section in the JSX (after the VFX `TreeNode`), add:

```tsx
          {/* Camera Zones */}
          <TreeNode
            icon="📹" label="Camera"
            count={cameraVolumes.length + cameraTriggers.length + cameraRails.length}
            arrow={cameraOpen ? '\u25BE' : '\u25B8'}
            isActive={false}
            onClick={() => setCameraOpen(!cameraOpen)}
            isOpen={cameraOpen}
          >
            {/* Volumes */}
            <TreeNode
              icon="📦" label="Volumes" count={cameraVolumes.length}
              arrow={camVolOpen ? '\u25BE' : '\u25B8'}
              isActive={false}
              onClick={() => setCamVolOpen(!camVolOpen)}
              actions={addBtn(() => addCameraVolume())}
              isOpen={camVolOpen}
            >
              {cameraVolumes.map((v) => (
                <TreeNode
                  key={v.id}
                  icon="📦"
                  label={v.name}
                  isActive={isActive({ kind: 'scene_item', entityType: 'camera_volume', entityId: v.id })}
                  onClick={() => click({ kind: 'scene_item', entityType: 'camera_volume', entityId: v.id })}
                  actions={removeBtn(() => removeCameraVolume(v.id))}
                />
              ))}
            </TreeNode>

            {/* Triggers */}
            <TreeNode
              icon="⚡" label="Triggers" count={cameraTriggers.length}
              arrow={camTrigOpen ? '\u25BE' : '\u25B8'}
              isActive={false}
              onClick={() => setCamTrigOpen(!camTrigOpen)}
              actions={addBtn(() => addCameraTrigger())}
              isOpen={camTrigOpen}
            >
              {cameraTriggers.map((t) => (
                <TreeNode
                  key={t.id}
                  icon="⚡"
                  label={`${t.from_zone || '*'} → ${t.to_zone || '?'}`}
                  isActive={isActive({ kind: 'scene_item', entityType: 'camera_trigger', entityId: t.id })}
                  onClick={() => click({ kind: 'scene_item', entityType: 'camera_trigger', entityId: t.id })}
                  actions={removeBtn(() => removeCameraTrigger(t.id))}
                />
              ))}
            </TreeNode>

            {/* Rails */}
            <TreeNode
              icon="🛤️" label="Rails" count={cameraRails.length}
              arrow={camRailOpen ? '\u25BE' : '\u25B8'}
              isActive={false}
              onClick={() => setCamRailOpen(!camRailOpen)}
              actions={addBtn(() => addCameraRail())}
              isOpen={camRailOpen}
            >
              {cameraRails.map((r) => (
                <TreeNode
                  key={r.id}
                  icon="🛤️"
                  label={r.name}
                  isActive={isActive({ kind: 'scene_item', entityType: 'camera_rail', entityId: r.id })}
                  onClick={() => click({ kind: 'scene_item', entityType: 'camera_rail', entityId: r.id })}
                  actions={removeBtn(() => removeCameraRail(r.id))}
                />
              ))}
            </TreeNode>
          </TreeNode>
```

- [ ] **Step 3: Build and verify**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/panels/ProjectTree.tsx
git commit -m "feat(bricklayer): add Camera section to project tree"
```

---

### Task 4: Property Panel Editors

**Files:**
- Create: `tools/apps/bricklayer/src/panels/CameraVolumeEditor.tsx`
- Create: `tools/apps/bricklayer/src/panels/CameraTriggerEditor.tsx`
- Create: `tools/apps/bricklayer/src/panels/CameraRailEditor.tsx`
- Modify: `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx`

- [ ] **Step 1: Create CameraVolumeEditor.tsx**

Create `tools/apps/bricklayer/src/panels/CameraVolumeEditor.tsx`. This component edits a single `CameraZoneVolume`. Follow the `LightEditor` pattern from `LightsTab.tsx`. Include:

- Name text input
- Shape type dropdown (aabb / sphere)
- Center Vec3Input
- Half Extents Vec3Input (AABB) or Radius NumberInput (Sphere)
- Mode dropdown (5 modes)
- Priority, Blend Time, FOV, Orbit Distance as NumberInput
- Allow User Orbit checkbox
- Pitch Min/Max, Yaw Min/Max as NumberInput pairs
- Offset Vec3Input (free_look / side_scroll)
- Fixed Position Vec3Input (fixed_point)
- Rail dropdown (rail_follow / cinematic_rail)
- "Possess Camera" button (stores `possessVolumeId` in app state — wired in Task 7)

Use `useSceneStore` selectors for `updateCameraVolume` and `cameraRails` (for the rail dropdown). All field changes call `updateCameraVolume(volume.id, { ... })`.

For shape changes, update the full shape object:
```typescript
// Switch to sphere
updateCameraVolume(volume.id, {
  shape: { ...volume.shape, type: 'sphere', radius: volume.shape.radius ?? 5 }
});
```

Mode-dependent fields: show Orbit Distance and Offset only when mode is `free_look` or `side_scroll`. Show Fixed Position only when `fixed_point`. Show Rail dropdown only when `rail_follow` or `cinematic_rail`.

- [ ] **Step 2: Create CameraTriggerEditor.tsx**

Create `tools/apps/bricklayer/src/panels/CameraTriggerEditor.tsx`. Similar to CameraVolumeEditor but simpler:

- Shape type dropdown + center + half_extents/radius
- From Zone dropdown (volume IDs + "Any" option)
- To Zone dropdown (volume IDs)
- Blend Override NumberInput (-1 = default)

Use `cameraVolumes` from store to populate dropdowns.

- [ ] **Step 3: Create CameraRailEditor.tsx**

Create `tools/apps/bricklayer/src/panels/CameraRailEditor.tsx`:

- Name text input
- Control Points: ordered list of Vec3Inputs, each with index number and [x] remove button
- [+ Add Point] button (appends `[0, 5, 0]`)
- Target Points: checkbox to enable, then same ordered list pattern

Use `updateRailControlPoint`, `addRailControlPoint`, `removeRailControlPoint` from store.

- [ ] **Step 4: Wire editors into ScenePropertiesPanel.tsx**

In `ScenePropertiesPanel.tsx`, add imports:

```typescript
import { CameraVolumeEditor } from './CameraVolumeEditor.js';
import { CameraTriggerEditor } from './CameraTriggerEditor.js';
import { CameraRailEditor } from './CameraRailEditor.js';
```

Add store selectors:

```typescript
const cameraVolumes = useSceneStore((s) => s.cameraVolumes);
const cameraTriggers = useSceneStore((s) => s.cameraTriggers);
const cameraRails = useSceneStore((s) => s.cameraRails);
```

Add routing cases after the existing entity type checks (after `vfx_instance`):

```typescript
  if (selectedEntity.type === 'camera_volume') {
    const vol = cameraVolumes.find((v) => v.id === selectedEntity.id);
    if (!vol) return <div style={styles.empty}>Camera volume not found</div>;
    return <CameraVolumeEditor volume={vol} />;
  }

  if (selectedEntity.type === 'camera_trigger') {
    const trig = cameraTriggers.find((t) => t.id === selectedEntity.id);
    if (!trig) return <div style={styles.empty}>Camera trigger not found</div>;
    return <CameraTriggerEditor trigger={trig} />;
  }

  if (selectedEntity.type === 'camera_rail') {
    const rail = cameraRails.find((r) => r.id === selectedEntity.id);
    if (!rail) return <div style={styles.empty}>Camera rail not found</div>;
    return <CameraRailEditor rail={rail} />;
  }
```

- [ ] **Step 5: Build and verify**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

- [ ] **Step 6: Commit**

```bash
git add tools/apps/bricklayer/src/panels/CameraVolumeEditor.tsx \
        tools/apps/bricklayer/src/panels/CameraTriggerEditor.tsx \
        tools/apps/bricklayer/src/panels/CameraRailEditor.tsx \
        tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx
git commit -m "feat(bricklayer): add camera zone property panel editors"
```

---

### Task 5: Viewport Gizmos — Volume and Trigger Markers

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/CameraZoneMarkers.tsx`
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx`

- [ ] **Step 1: Create CameraZoneMarkers.tsx**

Create `tools/apps/bricklayer/src/viewport/CameraZoneMarkers.tsx`. Follow the `LightGizmos.tsx` pattern.

Render all volumes and triggers as wireframe shapes:

```typescript
import React, { useRef } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CameraShape, CameraZoneVolume, CameraZoneTrigger } from '../store/types.js';
```

**VolumeMarker component:** Takes a `CameraZoneVolume`, renders:
- For AABB: `<mesh>` with `BoxGeometry(2*hx, 2*hy, 2*hz)` + `EdgesGeometry` for wireframe. Semi-transparent cyan fill (`opacity: 0.08`). Edges as `<lineSegments>`.
- For Sphere: same pattern with `SphereGeometry(radius, 24, 16)`.
- Invisible hit mesh for click detection (`<mesh onPointerDown={...}>` with `visible={false}`).
- When selected: bright cyan edges, `Html` label above center.
- When selected: `TransformControls` with `mode="translate"` for center dragging. On change: `updateCameraVolume(id, { shape: { ...shape, center: [x, y, z] } })`.

**TriggerMarker component:** Same as VolumeMarker but magenta color scheme (`#cc00cc` / `#ff00ff`).

**CameraZoneMarkers export:** Renders all volumes + triggers, checks `showGizmos`.

**Raycast layer separation:** Use `meshRef.current.layers.set(1)` on invisible hit meshes and `layers.set(0)` on TransformControls to prevent gizmo drags from being absorbed by hit meshes. Set raycaster layers in the pointer event handlers.

- [ ] **Step 2: Add to Viewport.tsx**

In `Viewport.tsx`, import and add the component in `SceneContent` (after `VfxInstanceMarkers`):

```typescript
import { CameraZoneMarkers } from './CameraZoneMarkers.js';
```

```tsx
<CameraZoneMarkers />
```

- [ ] **Step 3: Build and verify**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/CameraZoneMarkers.tsx \
        tools/apps/bricklayer/src/viewport/Viewport.tsx
git commit -m "feat(bricklayer): add camera volume/trigger viewport gizmos"
```

---

### Task 6: Viewport — Rail Markers

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/CameraRailMarkers.tsx`
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx`

- [ ] **Step 1: Create CameraRailMarkers.tsx**

Render each rail as:
- drei `Line` component through `control_points` in yellow (`#cccc00`).
- Small spheres (`SphereGeometry(0.3)`) at each control point, clickable.
- When selected: bright yellow line, `Html` label with rail name.
- `TransformControls` on selected control point for dragging — updates via `updateRailControlPoint(railId, index, newPos)`.
- If `target_points` present: second `Line` in dashed orange (`#cc8800`).

**Catmull-Rom interpolation:** Use `THREE.CatmullRomCurve3` with the control points to generate smooth curve points for the Line. This ensures the displayed curve matches the C++ engine's Catmull-Rom evaluation.

```typescript
const curve = new THREE.CatmullRomCurve3(
  rail.control_points.map(p => new THREE.Vector3(p[0], p[1], p[2])),
  false, 'catmullrom'
);
const points = curve.getPoints(64);
```

- [ ] **Step 2: Add to Viewport.tsx**

```typescript
import { CameraRailMarkers } from './CameraRailMarkers.js';
```

```tsx
<CameraRailMarkers />
```

- [ ] **Step 3: Build and verify**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/CameraRailMarkers.tsx \
        tools/apps/bricklayer/src/viewport/Viewport.tsx
git commit -m "feat(bricklayer): add camera rail viewport markers with Catmull-Rom spline"
```

---

### Task 7: Frustum Visualization

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/CameraFrustumGizmo.tsx`
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx`

- [ ] **Step 1: Create CameraFrustumGizmo.tsx**

Render when a camera volume is selected. Computes:

1. **Camera origin** based on mode:
   - `free_look`: center + offset + orbit vector (azimuth=0, elevation=0, orbit_distance)
   - `fixed_point`: fixed_position (render camera icon sprite here)
   - `rail_follow`/`cinematic_rail`: first control point of referenced rail
   - `side_scroll`: center + offset

2. **Frustum edges:** 4 lines from origin outward at FOV half-angle, clipped at display distance (~10 units). Near/far plane rectangles as wireframe.

3. **Pitch/Yaw constraint fans:** Semi-transparent surfaces showing allowed rotation range.
   - Pitch fan: vertical arc from `pitch_min` to `pitch_max` using `THREE.ShapeGeometry` built from arc points.
   - Yaw fan: horizontal arc from `yaw_min` to `yaw_max`.
   - Color: `#00ffff` with `opacity: 0.12`.
   - Update in real-time when slider values change.

4. **Fixed-point camera icon:** A small group of Three.js meshes forming a camera silhouette (box body + cone lens) at `fixed_position`. Dashed line to volume center.

- [ ] **Step 2: Add to Viewport.tsx**

```typescript
import { CameraFrustumGizmo } from './CameraFrustumGizmo.js';
```

```tsx
<CameraFrustumGizmo />
```

- [ ] **Step 3: Build and verify**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/CameraFrustumGizmo.tsx \
        tools/apps/bricklayer/src/viewport/Viewport.tsx
git commit -m "feat(bricklayer): add camera frustum + pitch/yaw constraint visualization"
```

---

### Task 8: Possess Mode (Camera Preview)

**Files:**
- Modify: `tools/apps/bricklayer/src/App.tsx`
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts` (add possess state)
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx`

- [ ] **Step 1: Add possess mode state to store**

In `useSceneStore.ts`, add to state:

```typescript
  possessVolumeId: string | null;  // null = normal editing, string = preview mode
  savedEditorCamera: { position: [number,number,number]; target: [number,number,number] } | null;
```

Add actions:

```typescript
  enterPossessMode: (volumeId: string) => void;
  exitPossessMode: () => void;
```

Implement:

```typescript
      enterPossessMode: (volumeId) => set({ possessVolumeId: volumeId }),
      exitPossessMode: () => set({ possessVolumeId: null, savedEditorCamera: null }),
```

Initial state: `possessVolumeId: null, savedEditorCamera: null`.

- [ ] **Step 2: Implement possess mode in Viewport.tsx**

In the `SceneContent` component, add possess mode logic:

When `possessVolumeId` is set:
1. Find the volume in `cameraVolumes`.
2. Compute the zone's camera position (same logic as CameraFrustumGizmo).
3. Override `OrbitControls` target to the volume center.
4. Set `controls.minPolarAngle` / `maxPolarAngle` from `pitch_min`/`pitch_max` (convert degrees to radians, offset by π/2 for Three.js polar convention).
5. Set `controls.minAzimuthAngle` / `maxAzimuthAngle` from `yaw_min`/`yaw_max` (convert degrees to radians).
6. Apply rotation damping near limits: set `controls.enableDamping = true`, `controls.dampingFactor` increases as angle approaches limit (use `controls.addEventListener('change', ...)` to check proximity).

Render a "PREVIEW MODE — Escape to exit" banner:

```tsx
{possessVolumeId && (
  <Html fullscreen>
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0,
      background: 'rgba(0,0,0,0.7)', color: '#00ffff',
      textAlign: 'center', padding: '8px', fontSize: '14px', fontWeight: 'bold',
      zIndex: 1000,
    }}>
      PREVIEW MODE — Press Escape to exit
    </div>
  </Html>
)}
```

- [ ] **Step 3: Add Escape handler in App.tsx**

In the keyboard handler section of `App.tsx`, add:

```typescript
if (e.key === 'Escape' && useSceneStore.getState().possessVolumeId) {
  useSceneStore.getState().exitPossessMode();
  e.preventDefault();
  return;
}
```

- [ ] **Step 4: Wire Possess button in CameraVolumeEditor**

In `CameraVolumeEditor.tsx`, add the button that was specified in Task 4:

```tsx
<button
  style={{ ...styles.btn, background: possessVolumeId === volume.id ? '#00cccc' : undefined }}
  onClick={() => {
    if (possessVolumeId === volume.id) exitPossessMode();
    else enterPossessMode(volume.id);
  }}
>
  {possessVolumeId === volume.id ? 'Exit Preview' : 'Possess Camera'}
</button>
```

- [ ] **Step 5: Build and verify**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

- [ ] **Step 6: Commit**

```bash
git add tools/apps/bricklayer/src/App.tsx \
        tools/apps/bricklayer/src/store/useSceneStore.ts \
        tools/apps/bricklayer/src/viewport/Viewport.tsx \
        tools/apps/bricklayer/src/panels/CameraVolumeEditor.tsx
git commit -m "feat(bricklayer): add possess camera preview mode"
```

---

### Task 9: Scene Export — camera_zones Block

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/sceneExport.ts`

- [ ] **Step 1: Add camera_zones export**

In `exportSceneJson()`, after the VFX instances export block (around line 230), add:

```typescript
  // Camera zones
  if (state.cameraVolumes.length > 0 || state.cameraTriggers.length > 0 || state.cameraRails.length > 0) {
    const cameraZones: Record<string, unknown> = {};

    if (Object.keys(state.cameraDefaultParams).length > 0) {
      cameraZones.default_params = state.cameraDefaultParams;
    }
    if (state.cameraShowDebugVolumes) {
      cameraZones.show_debug_volumes = true;
    }

    if (state.cameraVolumes.length > 0) {
      cameraZones.volumes = state.cameraVolumes.map((v) => {
        const out: Record<string, unknown> = {
          id: v.id,
          shape: v.shape,
        };
        // Only include non-default params
        const p = v.params;
        const params: Record<string, unknown> = {};
        if (p.mode !== 'free_look') params.mode = p.mode;
        if (p.priority !== 0) params.priority = p.priority;
        if (p.blend_time !== 1.0) params.blend_time = p.blend_time;
        if (!p.allow_user_orbit) params.allow_user_orbit = false;
        if (p.pitch_min !== -60) params.pitch_min = p.pitch_min;
        if (p.pitch_max !== 10) params.pitch_max = p.pitch_max;
        if (p.yaw_min !== -180) params.yaw_min = p.yaw_min;
        if (p.yaw_max !== 180) params.yaw_max = p.yaw_max;
        if (p.fov !== 45) params.fov = p.fov;
        if (p.orbit_distance !== 10) params.orbit_distance = p.orbit_distance;
        if (p.offset[0] !== 0 || p.offset[1] !== 5 || p.offset[2] !== -10) params.offset = p.offset;
        if (p.fixed_position) params.fixed_position = p.fixed_position;
        if (p.rail_id) params.rail_id = p.rail_id;
        if (Object.keys(params).length > 0) out.params = params;
        return out;
      });
    }

    if (state.cameraTriggers.length > 0) {
      cameraZones.triggers = state.cameraTriggers.map((t) => {
        const out: Record<string, unknown> = {
          shape: t.shape,
          to_zone: t.to_zone,
        };
        if (t.from_zone) out.from_zone = t.from_zone;
        if (t.blend_override >= 0) out.blend_override = t.blend_override;
        return out;
      });
    }

    if (state.cameraRails.length > 0) {
      cameraZones.rails = state.cameraRails.map((r) => {
        const out: Record<string, unknown> = {
          id: r.id,
          control_points: r.control_points,
        };
        if (r.target_points && r.target_points.length > 0) {
          out.target_points = r.target_points;
        }
        return out;
      });
    }

    scene.camera_zones = cameraZones;
  }
```

- [ ] **Step 2: Build and verify**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/lib/sceneExport.ts
git commit -m "feat(bricklayer): export camera_zones block in scene JSON"
```

---

### Task 10: Integration Test — Full Workflow

**Files:** No new files — manual verification.

- [ ] **Step 1: Build Bricklayer**

Run: `cd tools && pnpm --filter bricklayer build`

Expected: Clean build, no errors.

- [ ] **Step 2: Start Bricklayer dev server**

Run: `cd tools/apps/bricklayer && pnpm dev`

Open in browser. Verify:
1. Camera section appears in Project Tree
2. Click "+ Volume" adds a volume, selects it
3. Volume appears as cyan wireframe in viewport
4. Properties panel shows volume editor with all fields
5. Changing shape type (AABB ↔ Sphere) updates the gizmo
6. TransformControls appear for dragging
7. Number inputs and gizmo stay in sync
8. Click "+ Rail" creates a rail with yellow spline
9. Click "+ Trigger" creates a trigger with magenta wireframe
10. Possess Camera button switches viewport to zone perspective

- [ ] **Step 3: Test scene export**

Create a scene with camera zones, export via File > Export Scene JSON. Verify the output contains a valid `camera_zones` block matching the Phase 1 schema.

- [ ] **Step 4: Test with engine**

Load the exported scene in the demo app:

```bash
./build/macos-debug/gseurat_demo --scene path/to/exported_scene.json
```

Verify the camera zones work at runtime.

- [ ] **Step 5: Commit any fixes**

```bash
git add -u
git commit -m "fix(bricklayer): integration test fixes"
```
