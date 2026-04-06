# Echidna Upgrade Design — Workflow, Animation & Import/Export

**Date:** 2026-04-06
**Status:** Draft
**Approach:** Shared UI Kit + Feature Build (Approach 2)

## Overview

A comprehensive upgrade to the Echidna voxel character editor covering three areas: workflow efficiency (drawing/selection tools ported from Bricklayer), animation improvements (interpolation functions, per-part keyframes, preview), and import/export with bone support. All built on a shared UI component library extracted to `@gseurat/ui-kit`.

## 1. Shared UI Kit Extraction (`@gseurat/ui-kit`)

### Goal

Extract reusable UI components from Bricklayer into the existing `packages/ui-kit/` package. Echidna, Bricklayer, and later Méliès all consume the same components for consistent UX.

### Components

| Component | Source | Description |
|-----------|--------|-------------|
| `NumberInput` | `bricklayer/src/components/NumberInput.tsx` | Drag-to-scrub numeric input. Label drag and input drag modes, 2px = 1 unit step, pointer capture, clamping, keyboard commit/cancel. |
| `Vec3Input` | `bricklayer/src/components/Vec3Input.tsx` | 3-axis vector editor. Two modes: compact row (with label) or axis-labeled (X/Y/Z drag labels). Each axis independently scrubbed. |
| `ColorPicker` | `bricklayer/src/panels/TerrainLeftPanel.tsx` (extract) | Color swatch preview, native `<input type="color">`, palette grid (16-column, 256 slots), "From Image" k-means extraction. |
| `ToolButton` | New component (pattern from Bricklayer tool buttons) | Icon button with active state highlight, keyboard shortcut hint, tooltip. Consistent styling across tools. |
| `PanelStyles` | `bricklayer/src/panels/panelStyles.ts` | Shared style tokens: section, label, row, input, btn, item. Dark theme consistent across all apps. |
| `ResizeHandle` | `bricklayer/src/App.tsx` (extract) | 5px draggable panel divider. Color change on hover, pointer capture, min/max width clamping. |
| `TreeView` | New component (pattern from ProjectTree + Echidna bone tree) | Hierarchical node tree with expand/collapse, icons, click selection, drag-and-drop reparenting. |

### API Design

- All components are self-contained React components with inline styles using shared style tokens
- No CSS framework dependency
- Props follow existing Bricklayer conventions (value/onChange, min/max/step)
- `NumberInput` props: `value`, `onChange`, `min?`, `max?`, `step?`, `label?`, `style?`
- `Vec3Input` props: `value: [number, number, number]`, `onChange`, `label?`, `min?`, `max?`, `step?`
- `ToolButton` props: `icon`, `label`, `shortcut?`, `active`, `onClick`
- `TreeView` props: `nodes`, `selectedId`, `onSelect`, `onReparent?`, `renderNode?`

### Migration

After extraction, Bricklayer's local copies are replaced with imports from `@gseurat/ui-kit`. Both apps must work identically after migration — no visual or behavioral changes.

## 2. Workflow Efficiency — Drawing & Selection Tools

### New Drawing Tools

| Tool | Key | Behavior |
|------|-----|----------|
| Fill | G | Flood fill connected same-color voxels with active color. 3D flood fill using 6-neighbor connectivity (±X, ±Y, ±Z). Respects Y-clip bounds. |
| Extrude | X | Duplicate top/bottom layer of selected region. Left-click = extrude up, right-click = extrude down. Works on current Y-level or selection. |

### Enhanced Selection

| Tool | Key | Behavior |
|------|-----|----------|
| Box Select | S | Drag rectangle in viewport to select voxels (exists). Enhanced with action menu on selection. |
| Lasso Select | L | Freeform selection — draw boundary in viewport, all voxels within boundary in current view depth are selected. |

### Selection Actions

Once voxels are selected, a floating action bar appears:

- **Copy** (Cmd+C) — copy selected voxels to clipboard (positions + colors relative to selection center)
- **Paste** (Cmd+V) — place clipboard voxels at cursor position, ghost preview before confirming
- **Move** (G) — grab mode: move selected voxels with mouse, axis lock with X/Y/Z keys (Bricklayer's grab pattern)
- **Delete** (Backspace/Delete) — erase selected voxels
- **Recolor** — apply active color to all selected voxels
- **Assign to Part** — assign selected voxels to the active body part (existing assign_part tool, now works on selections)

### New Viewport Features

- **Y-level lock**: Constrain all edits to a specific Y layer. Toggle via panel checkbox + Y value input. Visual indicator: highlighted horizontal plane at locked Y.
- **X-ray mode** (T key): All voxels rendered semi-transparent (opacity 0.3) to see internal structure and occluded parts. Toggle on/off.

### Input Upgrades

All numeric inputs in Echidna panels switch to `NumberInput` from ui-kit:
- Joint position X/Y/Z → `Vec3Input`
- Pose rotation X/Y/Z → `Vec3Input` (degrees, step=1, min=-180, max=180)
- Brush size → `NumberInput` (step=1, min=1, max=8)
- Y-clip slider values → `NumberInput`
- Grid size inputs → `NumberInput`
- Animation speed → `NumberInput` (step=0.25, min=0.25, max=2.0)
- Keyframe time → `NumberInput` (step=0.01, min=0)

### Tool Panel Layout

Adopt Bricklayer's tool panel pattern:
- Draw tools section: icon buttons in a row (Place, Paint, Erase, Fill, Extrude)
- Utility tools section: Eyedropper, Box Select, Lasso Select
- Each button shows Unicode icon + keyboard shortcut hint
- Active tool highlighted with light blue border

## 3. Animation System Improvements

### Interpolation Functions

Each keyframe stores an `easing` property — the interpolation function used to transition *from* that keyframe to the next.

| Function | ID | Use Case | Implementation |
|----------|----|----------|----------------|
| Linear | `linear` | Constant speed | `t` |
| Ease In/Out | `ease-in-out` | General smooth motion | Cubic: `t * t * (3 - 2 * t)` (smoothstep) |
| Bounce | `bounce` | Jump landings, impacts | Piecewise quadratic (standard bounce curve) |
| Elastic | `elastic` | Overshoot and spring (hair, tails) | `sin(-13 * PI/2 * (t+1)) * pow(2, -10*t) + 1` |
| Step | `step` | Snappy, frame-by-frame | `t < 1 ? 0 : 1` (current default behavior) |
| Custom | `custom` | Fine-tuned easing | Cubic Bézier with 2 control points |

Default easing for new keyframes: `ease-in-out`.

### Per-Part Keyframes

Currently all parts rotate together at each keyframe (pose-level). Enhancement:

- Each keyframe can optionally specify `parts: string[]` — only those body parts transition at this keyframe
- Parts not listed hold their previous pose until their next keyframe
- Timeline UI shows per-part lanes when expanded (one row per body part)
- Collapsed view shows the combined timeline (current behavior)

This enables: legs cycling a walk loop while arms hold a carrying pose, head turning independently, etc.

### Keyframe Data Format

```typescript
interface Keyframe {
  time: number;             // seconds
  poseName: string;         // reference to a named pose
  easing: EasingType;       // interpolation to next keyframe
  curve?: [number, number, number, number];  // bézier control points (custom only)
  parts?: string[];         // if set, only these parts use this keyframe
}

type EasingType = 'linear' | 'ease-in-out' | 'bounce' | 'elastic' | 'step' | 'custom';
```

Backward compatible: existing keyframes without `easing` default to `step` (preserving current behavior). Keyframes without `parts` apply to all parts.

### Echidna Viewport Preview

Play animations directly in the 3D viewport:

- **Playback controls**: Play/Pause (Space), scrub via timeline drag, speed control (0.25x–2x)
- **Playback modes**: Loop, Ping-pong (reverse at end), Once (stop at last keyframe)
- **Onion skinning**: Toggle to show ghost silhouettes at previous and next keyframe positions. Ghosts rendered at 20% opacity with tinted color (blue = past, red = future). Configurable: show 1-3 ghosts in each direction.
- **Interpolation preview**: Viewport smoothly interpolates between poses using the selected easing function. Per-part keyframes respected — parts animate independently.

### Engine Preview via Staging

- "Preview in Staging" button in the animation panel (extends existing Staging preview)
- Exports current character PLY + manifest (with animation clips) to bridge
- Staging loads the character and plays the selected clip using `BoneAnimationPlayer`
- **Auto-sync**: When enabled (toggle), edits to keyframes/poses auto-push to Staging after 2s debounce (same pattern as Bricklayer's scene auto-sync)
- Round-trip: edit keyframe in Echidna → see result in engine within ~2 seconds

### Bézier Curve Editor

For `custom` easing, a small inline curve editor in the keyframe properties:

- 200×150px canvas showing the easing curve
- Two draggable control points defining the cubic Bézier
- Real-time curve preview as points are dragged
- Preset buttons: copy from any built-in easing as starting point

## 4. Import/Export with Bone Support

### File Strategy

- `.echidna` remains a single self-contained JSON file (voxels + bones + poses + animations all embedded)
- Imported PLY/OBJ/VOX data is converted and embedded into `.echidna` on import — no external references
- Export writes to a user-chosen destination directory

### Import Rigged PLY

Parse binary PLY files containing `bone_index` property (GSeurat format):

1. **Parse PLY**: Read positions, colors, scales, `bone_index` (uchar) per Gaussian
2. **Voxelize**: Quantize Gaussian positions to nearest grid cell. When multiple Gaussians map to the same cell, average their colors.
3. **Reconstruct skeleton**: Group voxels by `bone_index` → create one body part per unique index
4. **Infer joints**: Joint position = centroid of each part's voxels
5. **Load manifest** (optional): If a `.json` manifest file exists alongside the PLY (same name, e.g., `character.ply` + `character.json`), load parent/child hierarchy, part names, and poses from it
6. **Fallback**: Without manifest, create flat hierarchy (all parts are children of root). User reparents manually using the bone tree.

Grid size auto-detected from the bounding box of the imported Gaussians, rounded up to nearest power of 2.

### Import Unrigged PLY

Same as rigged import, but:
- No `bone_index` property → all voxels assigned to a single "root" part
- User rigs manually using assign-part tool and box/lasso selection

### Import OBJ (Mesh Voxelization)

1. **Parse OBJ**: Read vertices, faces, vertex colors (or material colors)
2. **Voxelize**: Ray-cast triangle mesh onto the grid — cast rays along each axis, mark intersected cells as filled. Each filled cell gets the color of the nearest face. Interior cells filled via 3-axis parity (odd crossing count = inside).
3. **Result**: Unrigged voxel model — user rigs in Echidna

Supports basic OBJ features: vertices, faces, vertex colors, MTL material colors. No textures (voxels are solid colors).

### Enhanced .vox Import

Current import already maps MagicaVoxel models to body parts. Enhancement:
- Read LAYR chunks to preserve model/layer names as part names
- If no LAYR data, fall back to current behavior (auto-generated part names)

### Export Enhancements

**"Export Character" (single action)**:
- Bundles PLY (with `bone_index`, density multiplier) + manifest JSON (bones, poses, animation clips)
- User picks destination directory via file dialog
- Writes: `{name}.ply` + `{name}.json`

**"Preview in Staging"** (existing, enhanced):
- Now includes animation clips in the manifest sent to bridge
- Staging can play back animations, not just display the static character

### Import Dialog

Unified import dialog triggered from File menu → Import:
- File picker accepting `.ply`, `.vox`, `.obj`
- Format auto-detected from extension
- Options panel:
  - Grid size override (auto-detected default, user can adjust)
  - For PLY: "Look for companion manifest" checkbox (default on)
  - For OBJ: voxelization resolution (cells per unit)
- Preview: voxel count estimate before committing
- "Import" button → converts and loads into current project (or new project if current is empty)

## 5. Keyboard Shortcuts Summary

### New Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| G | Build mode | Fill tool |
| X | Build mode | Extrude tool |
| L | Build mode | Lasso select |
| T | Any | Toggle X-ray mode |
| Cmd+C | With selection | Copy selected voxels |
| Cmd+V | With clipboard | Paste (enter placement mode) |
| G | With selection | Grab/move selected voxels |
| X/Y/Z | During grab | Axis lock toggle |
| Backspace | With selection | Delete selected voxels |

### Existing Shortcuts (unchanged)

| Key | Action |
|-----|--------|
| V | Place tool |
| B | Paint tool |
| E | Erase tool |
| I | Eyedropper |
| S | Box select |
| A | Assign part (animate mode) |
| `[` / `]` | Brush size -/+ |
| Space | Play/pause animation |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Cmd+N/S/O | New/Save/Load |

## 6. Data Format Changes

### `.echidna` Format v2

```typescript
{
  version: 2,  // bumped from 1
  characterName: string,
  gridWidth: number,
  gridDepth: number,
  voxels: { x, y, z, r, g, b, a }[],
  parts: {
    id: string,
    name: string,           // NEW: human-readable name
    parent: string | null,
    joint: [x, y, z],
    voxelKeys: string[]
  }[],
  poses: {
    [poseName]: {
      rotations: { [partId]: [rx, ry, rz] }
    }
  },
  animations: {
    [clipName]: {
      name: string,
      keyframes: {
        time: number,
        poseName: string,
        easing: EasingType,           // NEW: interpolation function
        curve?: [number, number, number, number],  // NEW: bézier points
        parts?: string[]              // NEW: per-part scope
      }[],
      duration: number,
      playbackMode: 'loop' | 'ping-pong' | 'once'  // NEW
    }
  },
  clipboard?: {             // NEW: internal, not saved to file
    voxels: { dx, dy, dz, r, g, b, a }[],
    parts?: string[]
  }
}
```

Migration: v1 files load with `easing: 'step'` for all keyframes and `playbackMode: 'loop'` for all clips. `name` defaults to `id` for parts.

## 7. Non-Goals

- Texture mapping or UV unwrapping (voxels are solid colors)
- Inverse kinematics (FK only — consistent with current rigid body-part approach)
- Multi-character scenes in Echidna (one character per project)
- Automatic mesh-to-skeleton rigging (user rigs manually)
- Animation blending/state machines in Echidna (that's the engine's job via `BoneAnimationStateMachine`)
