# Echidna Density Multiplier & Grid Size Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable higher-fidelity voxel characters by (1) subdividing voxels into denser Gaussian clusters at PLY export time, and (2) allowing configurable grid dimensions beyond the current 32x32 default.

**Architecture:** Both features are Echidna-only (TypeScript). No engine or C++ changes required. The density multiplier modifies `plyExport.ts`, and the grid size setting adds UI to the store and panels.

**Tech Stack:** TypeScript, Zustand, React (Echidna app at `tools/apps/echidna`)

---

## Feature 1: Density Multiplier in PLY Export

### Behavior

The Export Dialog (`ExportDialog.tsx`) gains a **Density** dropdown with options: 1x, 2x, 3x, 4x. Default is 1x (current behavior).

At export time, each surface voxel is subdivided into an N×N×N grid of smaller Gaussians:

| Density | Gaussians per voxel | warm_robot (54 surface) | Scale factor |
|---------|--------------------|-----------------------|--------------|
| 1x | 1 | 54 | 1.0 |
| 2x | 8 | 432 | 0.5 |
| 3x | 27 | 1,458 | 0.333 |
| 4x | 64 | 3,456 | 0.25 |

### Subdivision Logic

For each surface voxel at integer position `(vx, vy, vz)` with density N:

```
for sx in 0..N-1:
  for sy in 0..N-1:
    for sz in 0..N-1:
      sub_x = vx + (sx + 0.5) / N - 0.5
      sub_y = vy + (sy + 0.5) / N - 0.5
      sub_z = vz + (sz + 0.5) / N - 0.5
      sub_scale = original_scale / N
```

Each sub-Gaussian inherits the parent voxel's color, opacity, bone_index, and rotation.

### Files Modified

- `tools/apps/echidna/src/lib/plyExport.ts` — add `density` parameter to `exportPly()`, implement subdivision loop
- `tools/apps/echidna/src/panels/ExportDialog.tsx` — add density dropdown, pass to export function

### Constraints

- Surface culling runs first (before subdivision), so only exposed voxels are subdivided
- Bone index assignment is per-voxel, so all sub-Gaussians in one voxel share the same bone
- The manifest export (`manifestExport.ts`) is unchanged — bone/pose data doesn't depend on Gaussian density

---

## Feature 2: Configurable Grid Size

### Behavior

- **New Project**: When creating a new project (File > New or Cmd+N), a dialog appears with a grid size selector. Options: 32, 64, 128, 256, or custom (numeric input). Default: 32.
- **Resize**: Edit menu gains "Resize Grid..." option that opens a dialog to change grid dimensions. Voxels outside the new bounds are removed with a confirmation warning.
- **Load**: Existing `.echidna` files already store `gridWidth`/`gridDepth`, so they load at their saved size.

### Store Changes

- `useCharacterStore.ts`: `newProject()` action accepts optional `gridWidth`/`gridDepth` parameters
- `useCharacterStore.ts`: new `resizeGrid(width, depth)` action that clips voxels and updates dimensions

### UI Changes

- `NewProjectDialog.tsx` (new component): grid size selector shown on File > New
- `ResizeGridDialog.tsx` (new component): resize dialog with current/new size and voxel count warning
- `MenuBar.tsx`: add "Resize Grid..." to Edit menu, wire up New to show dialog

### Viewport

- The existing grid rendering already reads `gridWidth`/`gridDepth` from the store, so larger grids render automatically
- No viewport code changes needed beyond what the store already supports

### Constraints

- Grid is always square for simplicity (width = depth). A single "size" value controls both.
- No upper limit enforced in code, but sizes above 256 may cause performance issues in the viewport — document this but don't block it.
- Height (Y axis) remains unbounded (voxels can be placed at any Y).

---

## Out of Scope

- Engine-side density control (runtime upsampling)
- Mesh-to-PLY integration in Echidna UI (existing `scripts/mesh_to_ply.py` remains the workflow)
- Manifest format changes
- Echidna viewport performance optimization for large grids

## Testing

- **Density**: Export warm_robot at 1x/2x/3x/4x, verify vertex counts match expected (54, 432, 1458, 3456). Verify positions are within voxel bounds. Verify bone_index preserved.
- **Grid size**: Create project at 64x64, place voxels near edges, save/load, verify. Resize from 64 to 32, verify edge voxels removed.
- **Integration**: Export a 64-grid character at 3x density, load PLY in engine demo, verify rendering.
