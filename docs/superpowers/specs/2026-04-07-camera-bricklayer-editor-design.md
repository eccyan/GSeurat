# Camera Zone Editor for Bricklayer — Phase 2

**Date:** 2026-04-07
**Status:** Draft
**Scope:** Phase 2 of 3 — Bricklayer editor UI for camera volumes, triggers, and rails. Builds on Phase 1 runtime engine (PR #180).

## Problem

Phase 1 delivered the C++ runtime pipeline for camera zones, but camera zone data must currently be hand-written in JSON. For 3DGS scenes, hiding splat backsides and density falloff requires millimeter-precision boundary placement — impossible without spatial feedback. Level designers need interactive tools to place, resize, and preview camera zones directly in the 3D viewport.

## Solution

Extend Bricklayer with a camera zone editing system following the established entity pattern (store + panel + gizmo). Three entity types: volumes, triggers, and rails. Interactive gizmos for translation and scaling. Frustum wireframe visualization with semi-transparent constraint surfaces. A "Possess Camera" preview mode that temporarily switches the viewport to the zone's restricted camera perspective.

## Data Model

### Shared Shape Type

```typescript
// Shared between volumes and triggers — mirrors C++ VolumeShape variant
interface CameraShape {
  type: 'aabb' | 'sphere';
  center: [number, number, number];
  half_extents?: [number, number, number];  // AABB only
  radius?: number;                           // Sphere only
}
```

Extracting this as a shared type ensures clean 1:1 mapping to the C++ `std::variant<CamAABB, CamSphere>` and leaves room to add `'capsule'` or `'convex_hull'` in the future without structural changes.

### Camera Zone Params

```typescript
interface CameraZoneParams {
  mode: 'free_look' | 'rail_follow' | 'cinematic_rail' | 'fixed_point' | 'side_scroll';
  priority: number;          // 0 = auto (smallest volume wins), >0 = manual override
  blend_time: number;        // seconds
  allow_user_orbit: boolean;
  pitch_min: number;         // degrees
  pitch_max: number;
  yaw_min: number;           // -180..180 = unrestricted
  yaw_max: number;
  fov: number;               // degrees
  orbit_distance: number;    // free_look mode
  offset: [number, number, number];
  fixed_position?: [number, number, number];  // fixed_point mode
  rail_id?: string;          // rail_follow / cinematic_rail modes
}
```

Default values match the Phase 1 C++ `CameraParams` defaults: `mode: 'free_look'`, `priority: 0`, `blend_time: 1.0`, `allow_user_orbit: true`, `pitch_min: -60`, `pitch_max: 10`, `yaw_min: -180`, `yaw_max: 180`, `fov: 45`, `orbit_distance: 10`, `offset: [0, 5, -10]`.

### Entity Types

```typescript
interface CameraZoneVolume {
  id: string;
  name: string;
  shape: CameraShape;
  params: CameraZoneParams;
}

interface CameraZoneTrigger {
  id: string;
  shape: CameraShape;
  from_zone?: string;   // volume ID, undefined = any direction
  to_zone: string;      // volume ID
  blend_override: number; // -1 = use target zone's blend_time
}

interface CameraZoneRail {
  id: string;
  name: string;
  control_points: [number, number, number][];
  target_points?: [number, number, number][];
}

// Top-level camera zone configuration
interface CameraZonesConfig {
  default_params: Partial<CameraZoneParams>;
  show_debug_volumes: boolean;  // export flag for C++ debug visualization
}
```

### Priority Resolution (Designer Reference)

When multiple volumes overlap, the runtime resolves which zone's rules apply:

1. **Manual priority** (`priority > 0`) always beats auto (`priority == 0`).
2. Among manual: highest priority wins.
3. Among auto: smallest volume wins (product of half_extents for AABB, r³ for Sphere).
4. Tie-break: lowest entity ID (deterministic, stable).

Designers can ignore priority entirely for most layouts — the "smallest volume wins" heuristic handles nested volumes intuitively. Only set manual priority when the heuristic produces wrong results.

## Store Integration

Add to `useSceneStore.ts` state:

```typescript
// Camera zone entities
cameraVolumes: CameraZoneVolume[];
cameraTriggers: CameraZoneTrigger[];
cameraRails: CameraZoneRail[];
cameraDefaultParams: Partial<CameraZoneParams>;
cameraShowDebugVolumes: boolean;
```

Actions follow the established entity pattern:

```typescript
// Volumes
addCameraVolume: (position?: [number, number, number]) => void;
updateCameraVolume: (id: string, patch: Partial<CameraZoneVolume>) => void;
removeCameraVolume: (id: string) => void;

// Triggers
addCameraTrigger: (position?: [number, number, number]) => void;
updateCameraTrigger: (id: string, patch: Partial<CameraZoneTrigger>) => void;
removeCameraTrigger: (id: string) => void;

// Rails
addCameraRail: () => void;
updateCameraRail: (id: string, patch: Partial<CameraZoneRail>) => void;
removeCameraRail: (id: string) => void;
addRailControlPoint: (railId: string, point: [number, number, number]) => void;
removeRailControlPoint: (railId: string, index: number) => void;
updateRailControlPoint: (railId: string, index: number, point: [number, number, number]) => void;

// Default params
updateCameraDefaultParams: (patch: Partial<CameraZoneParams>) => void;
setCameraShowDebugVolumes: (show: boolean) => void;
```

ID generation: `genId('camvol')`, `genId('camtrig')`, `genId('camrail')`.

Default new volume: AABB, center at viewport focus or `[0, 2, 0]`, half_extents `[5, 5, 5]`, free_look mode.

## Project Tree

Add a **Camera** section under Scene in `ProjectTree.tsx`:

```
▼ Scene
  ▼ Objects (3)
  ▼ Lights (2)
  ▼ Emitters (1)
  ▼ VFX (0)
  ▼ Camera                    ← new section
    ▼ Volumes (3)
      • courtyard
      • corridor
      • tower_top
    ▼ Triggers (1)
      • courtyard → corridor
    ▼ Rails (1)
      • corridor_cam
    [+ Volume] [+ Trigger] [+ Rail]
```

- Selecting an item sets `selectedEntity` with type `'camera_volume'`, `'camera_trigger'`, or `'camera_rail'`.
- Tree selection syncs with viewport click selection (bidirectional).
- Trigger display name: `from_zone → to_zone` (or `* → to_zone` if from_zone is undefined).
- Each item has a delete button (x icon) on hover.

## Properties Panel

Three editor components, conditionally rendered in `ScenePropertiesPanel.tsx` based on `selectedEntity.type`:

### CameraVolumeEditor

| Field | Input Type | Condition |
|-------|-----------|-----------|
| Name | text | always |
| Shape Type | dropdown: AABB / Sphere | always |
| Center | Vec3Input | always (synced with gizmo) |
| Half Extents | Vec3Input | AABB only (synced with scale gizmo) |
| Radius | NumberInput with drag | Sphere only (synced with scale gizmo) |
| Mode | dropdown (5 modes) | always |
| Priority | NumberInput | always |
| Blend Time | NumberInput (seconds) | always |
| Allow User Orbit | checkbox | always |
| Pitch Min / Max | NumberInput pair (degrees) | always |
| Yaw Min / Max | NumberInput pair (degrees) | always |
| FOV | NumberInput (degrees) | always |
| Orbit Distance | NumberInput | free_look mode |
| Offset | Vec3Input | free_look / side_scroll |
| Fixed Position | Vec3Input | fixed_point mode |
| Rail | dropdown of rail IDs | rail_follow / cinematic_rail |
| **[Possess Camera]** | button | always |

Mode-dependent fields hide/show based on mode selection. All numeric inputs use the existing `NumberInput` component with drag-to-scrub.

### CameraTriggerEditor

| Field | Input Type |
|-------|-----------|
| Shape Type | dropdown: AABB / Sphere |
| Center | Vec3Input (synced with gizmo) |
| Half Extents / Radius | Vec3Input or NumberInput |
| From Zone | dropdown: volume IDs + "Any" |
| To Zone | dropdown: volume IDs |
| Blend Override | NumberInput (-1 = use target default) |

### CameraRailEditor

| Field | Input Type |
|-------|-----------|
| Name | text |
| Control Points | ordered list of Vec3Inputs, each with [x] remove button |
| [+ Add Point] | button (appends default point) |
| Target Points | optional ordered list (toggle to enable) |

Each control point is editable via Vec3Input. Stretch goal: click-to-place in viewport.

## Viewport Gizmos

### CameraZoneMarkers.tsx

**Volumes:**
- **AABB:** Wireframe box using `EdgesGeometry` on `BoxGeometry(2*hx, 2*hy, 2*hz)`. Color: `#00cccc` (cyan) when not selected, `#00ffff` (bright cyan) when selected. Semi-transparent fill (`MeshBasicMaterial` with `opacity: 0.08`, `transparent: true`) to show the volume as a region, not just edges.
- **Sphere:** Wireframe sphere using `EdgesGeometry` on `SphereGeometry(radius, 24, 16)`. Same color scheme + semi-transparent fill.
- **Click to select:** Invisible solid mesh matching volume shape for raycasting. `onPointerDown` → `setSelectedEntity({ type: 'camera_volume', id })`.
- **Label:** drei `Html` component showing volume name when selected, positioned above the center.

**Triggers:**
- Same wireframe rendering as volumes but in **magenta** (`#cc00cc` / `#ff00ff`).
- Typically thinner volumes (small half_extents in one axis) placed at doorways.

**Rails:**
- drei `Line` component through control_points in **yellow** (`#cccc00`).
- Small spheres (`SphereGeometry(0.3)`) at each control point, clickable for selection.
- If `target_points` present: second dashed line in **orange** (`#cc8800`).

### Transform Gizmos (drei TransformControls)

When a camera volume is selected:

1. **Translation mode:** drei `TransformControls` with `mode="translate"` attached to the volume center group. On change: update `shape.center` in store via `updateCameraVolume(id, { shape: { ...shape, center: [x,y,z] } })`.

2. **Scale mode:** A second `TransformControls` with `mode="scale"` on a child group. For AABB: axes map to `half_extents` components. For Sphere: uniform scale maps to `radius`. The gizmo's scale is initialized from the current extents/radius so dragging feels 1:1.

3. **Mode toggle:** Keyboard shortcut `W` = translate, `R` = scale (matching Blender/Unity convention). Or a small toolbar overlay near the gizmo.

**Bidirectional sync:** Gizmo drag → `onObjectChange` callback → store update → React re-render → panel values update. Panel number edit → store update → React re-render → gizmo position/scale updates. Both paths go through the same `updateCameraVolume` action.

Triggers and rail control points also get translate gizmos when selected.

### Camera Frustum Gizmo

When a camera volume is selected, render a frustum visualization:

**Origin:** Computed from the zone's mode:
- `free_look`: orbit position at `orbit_distance` from center + offset, using current azimuth=0 / elevation=0 as default viewing direction.
- `fixed_point`: `fixed_position`.
- `rail_follow`: first control point of the referenced rail.
- `side_scroll`: center + offset.
- `cinematic_rail`: first control point of the referenced rail.

**Frustum geometry:**
- Four edges from the camera position outward forming the FOV pyramid, clipped at a display distance of ~10 units.
- Near plane and far plane quads as thin wireframe rectangles.

**Pitch/Yaw constraint visualization:**
- Render the allowed rotation range as **semi-transparent fan surfaces** using `THREE.ShapeGeometry` or `THREE.RingGeometry`.
- Pitch limits: vertical arc segments showing the elevation range (like a protractor viewed from the side).
- Yaw limits: horizontal arc segments showing the azimuth range (like a compass rose viewed from above).
- Surface color: `#00ffff` with `opacity: 0.15` — visible enough to show the "walls" of the constraint but not obscuring the scene.
- When pitch/yaw limits change via panel sliders, the fan surfaces open/close in real-time.

**Fixed-point camera icon:**
- In `fixed_point` mode, render a small camera sprite (`THREE.Sprite` with a camera icon texture or a simple geometric camera shape built from boxes/cones) at `fixed_position`.
- A dashed line connects the camera icon to the volume center (the look-at target direction).

## Possess Mode (Camera Preview)

### Activation

A **"Possess Camera"** button in the CameraVolumeEditor panel. Also bindable to a keyboard shortcut (e.g., `Numpad 0` or a toolbar button in the viewport).

### Behavior

1. **Enter possess mode:**
   - Store the current editor camera state: `{ position, target, azimuth, elevation, distance }`.
   - Smoothly interpolate (`THREE.Vector3.lerp` / `THREE.Quaternion.slerp`) from the editor camera to the zone's camera position/target over 0.5 seconds.
   - Apply orbit control constraints: `controls.minPolarAngle` / `maxPolarAngle` from pitch limits, `controls.minAzimuthAngle` / `maxAzimuthAngle` from yaw limits.
   - If the mode is `fixed_point`, lock position and only allow rotation.
   - Display a prominent banner: **"PREVIEW MODE — Escape to exit"** with a semi-transparent dark background at the top of the viewport.

2. **While in possess mode:**
   - Mouse orbit is restricted to the zone's pitch/yaw limits.
   - **Rotation damping near limits:** As the camera angle approaches within 5° of a limit, increase damping (multiply rotation delta by `max(0, (distance_to_limit - 1°) / 4°)`) so the camera decelerates smoothly into the wall rather than hitting a hard stop. This simulates the feel the player will experience at runtime.
   - Camera position stays inside the volume (for free_look: orbit stays within boundary; for fixed_point: position is locked).
   - Panel editing is still active — changing pitch/yaw limits updates the constraints in real-time while in preview.

3. **Exit possess mode:**
   - Press Escape or click the "Possess Camera" button again.
   - Smoothly interpolate back to the saved editor camera state over 0.5 seconds.
   - Restore default orbit control constraints (no limits).

### Non-functional: No Bridge Required

Possess mode operates entirely within Bricklayer's Three.js viewport. It does NOT require communication with the C++ engine or a second render pass. The preview shows the Three.js scene (voxel terrain, gizmos) from the zone's camera perspective — not the actual GS-rendered output. This is sufficient for verifying spatial constraints. True GS rendering verification requires running the demo app with `--scene`.

## Scene Export

### Export (`sceneExport.ts`)

Add `camera_zones` block to the exported scene JSON:

```typescript
if (store.cameraVolumes.length > 0 || store.cameraTriggers.length > 0 || store.cameraRails.length > 0) {
  scene.camera_zones = {
    default_params: store.cameraDefaultParams,
    show_debug_volumes: store.cameraShowDebugVolumes,
    volumes: store.cameraVolumes.map(v => ({
      id: v.id,
      shape: v.shape,
      params: v.params,
    })),
    triggers: store.cameraTriggers.map(t => ({
      shape: t.shape,
      ...(t.from_zone ? { from_zone: t.from_zone } : {}),
      to_zone: t.to_zone,
      blend_override: t.blend_override,
    })),
    rails: store.cameraRails.map(r => ({
      id: r.id,
      control_points: r.control_points,
      ...(r.target_points ? { target_points: r.target_points } : {}),
    })),
  };
}
```

### Import (`loadProject` in `useSceneStore.ts`)

Parse `camera_zones` from saved BricklayerFile:

```typescript
if (data.scene.camera_zones) {
  const cz = data.scene.camera_zones;
  cameraVolumes = cz.volumes ?? [];
  cameraTriggers = cz.triggers ?? [];
  cameraRails = cz.rails ?? [];
  cameraDefaultParams = cz.default_params ?? {};
  cameraShowDebugVolumes = cz.show_debug_volumes ?? false;
}
```

### Debug Volume Flag

`show_debug_volumes: boolean` is exported in the `camera_zones` block. The C++ runtime (Phase 1) ignores unknown fields, so this is forward-compatible. When the C++ side adds debug visualization support, it reads this flag to decide whether to render wireframe volumes in development builds.

## Files Changed

| File | Change | New/Modify |
|------|--------|------------|
| `tools/apps/bricklayer/src/store/types.ts` | CameraShape, CameraZoneParams, CameraZoneVolume, CameraZoneTrigger, CameraZoneRail, CameraZonesConfig types | Modify |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Camera zone state + add/update/remove actions + save/load | Modify |
| `tools/apps/bricklayer/src/panels/ProjectTree.tsx` | Camera section with Volumes/Triggers/Rails sub-trees | Modify |
| `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx` | Route to camera entity editors | Modify |
| `tools/apps/bricklayer/src/panels/CameraVolumeEditor.tsx` | Volume parameter editing + Possess button | New |
| `tools/apps/bricklayer/src/panels/CameraTriggerEditor.tsx` | Trigger parameter editing | New |
| `tools/apps/bricklayer/src/panels/CameraRailEditor.tsx` | Rail control point editing | New |
| `tools/apps/bricklayer/src/viewport/CameraZoneMarkers.tsx` | Volume/trigger wireframes + labels | New |
| `tools/apps/bricklayer/src/viewport/CameraRailMarkers.tsx` | Rail spline + control point spheres | New |
| `tools/apps/bricklayer/src/viewport/CameraFrustumGizmo.tsx` | FOV pyramid + pitch/yaw constraint fans | New |
| `tools/apps/bricklayer/src/viewport/CameraPossessMode.tsx` | Preview mode overlay + camera control override | New |
| `tools/apps/bricklayer/src/viewport/Viewport.tsx` | Include new marker/gizmo components | Modify |
| `tools/apps/bricklayer/src/lib/sceneExport.ts` | Export camera_zones block | Modify |
| `tools/apps/bricklayer/src/App.tsx` | Possess mode keyboard shortcut (Numpad 0) | Modify |

## Known Limitations

### No GS Rendering in Preview

Possess mode shows the Three.js viewport (voxel mesh, wireframes) from the zone camera's perspective — not the actual Gaussian splat rendering. Designers must run the demo app to see true GS output. This is acceptable because the primary goal of possess mode is verifying spatial constraints (angle limits, volume boundaries), not visual quality.

### No Undo for Gizmo Drags

The current undo/redo system snapshots voxel + collision data. Gizmo-driven camera zone edits are tracked via store mutations but not integrated into the undo stack. This matches the existing behavior for light/emitter gizmo edits. Adding camera zone undo is a future enhancement.

### Rail Drawing Deferred to Phase 2 Stretch / Phase 3

Rail control points are edited via Vec3Input fields in the panel. Interactive click-to-place in the viewport is a stretch goal. The data structure supports it — only the UI interaction is deferred.
