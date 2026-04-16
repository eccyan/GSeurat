# Echidna Lasso Selection Implementation

## Goal

Implement functional lasso selection in Echidna's Animate mode. Currently the lasso tool is wired up in the UI and store but has no implementation — clicking with lasso active does nothing.

## Architecture

### Overlay approach

A new `LassoOverlay` React component renders an SVG layer absolutely positioned on top of the R3F `<Canvas>`. It only responds to pointer events when `activeTool === 'lasso_select'`; otherwise it has `pointerEvents: 'none'` and is invisible.

```
AssetViewport
├── <Canvas>
│     └── VoxelMesh, JointGizmos, GhostVoxel, ...
│   </Canvas>
└── <LassoOverlay />  <- NEW (absolute positioned SVG)
```

### Interaction flow

1. User activates lasso tool (button or `L` key).
2. `AssetViewport` disables `OrbitControls` while lasso tool is active (prevents camera spin during drag).
3. `pointerdown` on overlay → record first point, start polyline.
4. `pointermove` → append screen-space points to polyline (throttled to ~5px min distance).
5. During drag, run selection logic continuously and update `lassoSelection` → live visual preview.
6. `pointerup` → polyline closed (implicit closing edge from last point to first), final selection committed, polyline cleared from overlay.

### Selection logic (option B — all voxels, no occlusion check)

For each voxel in `asset.voxels`:
1. Get world-space center (voxel coordinate + 0.5).
2. Project to screen space using the active R3F camera via `Vector3.project(camera)` → returns NDC, then converted to pixel coordinates.
3. Run point-in-polygon ray-casting test against the lasso polyline.
4. If inside → add voxel key to selection set.

Selected keys written via the existing `setLassoSelection(keys)` store action.

### Live visual feedback

`VoxelMesh` already applies a green tint to voxels in `boxSelectionSet`. Extend the same logic to also tint voxels in `lassoSelection`. As the user drags, the selection updates in real time — solves the "can't tell if hidden voxels are included" concern.

### Camera access

The overlay needs to project voxel positions using the R3F camera. Two options:
- Use `useThree()` inside a component rendered inside `<Canvas>` to grab the camera, then pass a ref up
- Or expose the camera via a store field

Decision: **ref-based**. A small invisible `CameraExposer` component inside `<Canvas>` calls `useThree()` and writes the camera to a `useRef` passed in from `AssetViewport`. `LassoOverlay` reads the camera from this ref when projecting. Same pattern as existing `InitialInvalidator`.

## Files changed

| File | Change |
|------|--------|
| `tools/apps/echidna/src/lib/pointInPolygon.ts` | New — ray-casting polygon hit test |
| `tools/apps/echidna/src/__tests__/pointInPolygon.test.ts` | New — unit tests |
| `tools/apps/echidna/src/viewport/LassoOverlay.tsx` | New — SVG overlay + selection logic |
| `tools/apps/echidna/src/viewport/AssetViewport.tsx` | Modify — add CameraExposer, mount LassoOverlay, disable OrbitControls when lasso active |
| `tools/apps/echidna/src/viewport/VoxelMesh.tsx` | Modify — extend green tint to `lassoSelection` |

## Testing

**Unit tests** (`pointInPolygon.test.ts`):
- Point inside triangle → true
- Point outside triangle → false
- Point on vertex (edge case) → consistent result
- Concave polygon (U-shape): point in concavity → false
- Square: point at center → true

**Manual verification:**
- Draw lasso around voxels → voxels highlight green during drag
- Release → selection persists
- Switch to Assign Part → bone assignment uses the lasso selection
- Hidden voxels behind a front face are selected if their projected center is inside the polygon (option B)

## Out of scope

- Occlusion-aware selection (option A) — not requested
- Multi-step polygon (click-to-add-point instead of drag) — drag is the standard lasso UX
- Lasso for extrude operations — existing `extrudeSelection` already reads `boxSelection ?? lassoSelection`, so this works automatically once lasso writes to the store
