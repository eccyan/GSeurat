# Spline VFX Authoring in Bricklayer

**Date:** 2026-04-19
**Issue:** #312
**Goal:** Let level designers draw spline paths for VFX instances directly in the Bricklayer viewport, using per-instance control point overrides.

## Design Decisions

- **Per-instance override**: VFX presets define a default spline; each scene instance can override `control_points` only. Mode/speed/spread stay with the preset.
- **Click-to-place interaction**: Enter edit mode from the properties panel, click in viewport to place points sequentially, drag to reposition, right-click to remove. Escape/Done exits.
- **Instance-relative coordinates**: Spline points are offsets from the VFX instance position, matching the preset's coordinate space.
- **Shared display, separate editing**: Extract read-only spline rendering into a shared component; interactive editing is Bricklayer-only.

## Data Model

### VfxInstanceData (Bricklayer store)

Add one optional field:

```typescript
splinePoints?: [number, number, number][]  // instance-relative control points
```

### Engine JSON (scene file)

```json
{
  "vfx_file": "assets/vfx/spline_dragon_flame.vfx.json",
  "position": [165, 2, 120],
  "spline_points": [[0,0,0], [5,3,10], [10,8,20], [15,5,30]],
  "rotation_y": 0,
  "radius": 5,
  "trigger": "auto",
  "loop": true
}
```

Field is `spline_points` (snake_case) in engine JSON, `splinePoints` (camelCase) in `.bricklayer`.

### C++ Engine

When loading a VFX instance from scene JSON:
1. Check for `spline_points` array
2. If present and non-empty, construct `SplinePath` from these points instead of the preset's `spline.control_points`
3. All other spline params (`mode`, `emitter_speed`, `path_spread`, `align_to_tangent`) come from the preset unchanged

## Components

### SplineCurveDisplay (shared — `@gseurat/vfx-utils`)

Read-only React Three Fiber component. Renders a Catmull-Rom curve and control point spheres.

```typescript
interface SplineCurveDisplayProps {
  points: [number, number, number][];
  color?: string;
  lineWidth?: number;
  opacity?: number;
  pointRadius?: number;
  samples?: number;  // default 64
}
```

- Uses `sampleCatmullRom()` (already in `@gseurat/vfx-utils`) for interpolation
- Renders `<Line>` for the curve, `<mesh><sphereGeometry>` for each control point
- Replaces the duplicated rendering in Melies `SplineGizmo` and Bricklayer `EmitterSplineGizmo`

### SplineEditor (Bricklayer — `src/viewport/SplineEditor.tsx`)

Interactive overlay inside `<Canvas>`. Active when `editingSpline` is set.

**Renders:**
- `<SplineCurveDisplay>` for the current points (yellow/orange)
- Larger interactive spheres at control points for drag interaction
- A transparent raycast plane for click-to-place

**Interaction:**
- **Click on ground**: Raycasts against scene, appends new point at intersection
- **Pointer down on control point sphere**: Enters drag mode, updates point position on pointer move
- **Right-click on control point**: Removes it from the array
- **Escape**: Exits spline edit mode

**Store integration:**
- Reads `editingSpline` (VFX instance ID) from store
- Calls `updateVfxInstance(id, { splinePoints: [...] })` on changes
- Sets `orbitLocked: true` while editing (same pattern as grab mode)

### Properties Panel Changes (ScenePropertiesPanel)

In the VFX instance inspector section:
- Detect if the preset has a `spline` config (check loaded `.vfx.json` or the VfxElementData)
- If yes, show **"Edit Spline"** / **"Done Editing"** toggle button
- Show point count label: "4 control points"
- Show **"Reset to Preset"** button to clear the override

### sceneExport.ts Changes

Include `spline_points` in VFX instance export when present:

```typescript
if (vfx.splinePoints && vfx.splinePoints.length > 0) {
  out.spline_points = vfx.splinePoints;
}
```

### importEngineScene (projectIO.ts) Changes

Read `spline_points` from engine JSON when importing:

```typescript
splinePoints: vfx.spline_points ?? undefined,
```

## Store Changes (useSceneStore)

```typescript
editingSpline: string | null;           // VFX instance ID being edited, or null
setEditingSpline: (id: string | null) => void;
```

When `setEditingSpline(id)` is called:
- Set `orbitLocked: true`
- If the VFX instance has no `splinePoints` yet, initialize from the preset's default control points

When `setEditingSpline(null)` is called:
- Set `orbitLocked: false`

## Demo Scene Placement

After the feature is built, place the two existing presets:

- **spline_dragon_flame** on seurat_island: Arc sweeping over the cliff overlook area. ~4 control points: `[[0,0,0], [10,5,15], [20,10,10], [30,5,25]]` relative to instance position near `[230, 4, 145]`.
- **spline_smoke_trail** on seurat_island: Gentle vertical drift near the house chimney. ~3 control points: `[[0,0,0], [0,3,1], [1,8,0]]` relative to instance position near `[192, 6, 175]`.

Both added to engine JSON and synced to `.bricklayer`.

## Schema Changes

Update `schemas/scene.schema.json` to include `spline_points` as an optional array of vec3 in the VFX instance definition.

## Testing

- Bricklayer store test: `updateVfxInstance` with `splinePoints` field
- Export test: verify `spline_points` appears in engine JSON output
- Import test: verify `spline_points` round-trips through import/export
- Visual: open in Bricklayer, edit spline, verify points render
- Engine: verify spline_points override is used instead of preset default
