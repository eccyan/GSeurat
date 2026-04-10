# Echidna

Web-based voxel character editor for the GSeurat engine. Sculpt voxel models, rig them with bones, author keyframe animations, and export PLY + character manifests that the engine renders as 3D Gaussian splat characters with GPU skinning.

## Quick Start

```bash
pnpm --filter @gseurat/echidna dev
```

Open <http://localhost:5179>. The bridge server (port 9100/9101) and a running Staging instance are required for live preview / Auto-Sync.

## Modes

Echidna has two top-level modes accessible from the menu bar:

- **BUILD** — voxel sculpting, palette, body parts
- **ANIMATE** — bone hierarchy, poses, keyframe animations, timeline playback

The 3-panel layout (left tools / center viewport / right inspector) is shared between modes; panels are resizable (150–500px).

## Build Mode

### Tools

| Key | Tool | Purpose |
|-----|------|---------|
| `V` | Place | Add voxels (with ghost preview) |
| `B` | Paint | Recolor existing voxels |
| `E` | Erase | Remove voxels |
| `I` | Eyedropper | Sample voxel color |
| `G` | Fill | 3D flood fill by connected color |
| `X` | Extrude | Copy + offset voxel layer vertically |
| `S` | Box select | Rectangular 3D selection |
| `L` | Lasso select | Freehand 2D selection |

### Color & Brush

- Hex picker with live preview
- 12 preset swatches (skin tones, browns, grays, RGB, purple, orange)
- Brush size 1–8 (`[` / `]`)

### Build Panel (right)

- **Y-Clip** — slice view at adjustable Y for interior editing
- **Y-Level Lock** — constrain painting to a fixed height
- **Mirror X / Mirror Z** — symmetric placement (live)
- **Toggles**: Grid, Gizmos, Color by Part, X-Ray (`T`)

### Selection & Clipboard

- Box select / lasso select
- `Cmd/Ctrl+C` copy
- Paste at cursor
- `Del` / `Backspace` delete
- `Esc` clear selection

## Animate Mode

### Bones (Left Panel)

- Tree view of skeletal hierarchy
- Drag-to-reparent with circular-dependency protection
- Inline add / remove
- Root bone label

### Animations List (Left Panel)

- All animation clips in the project
- Add / remove / select active
- **Root Motion** badge (RM) on clips with translation enabled

### Bone Properties (Right Panel)

- Joint position X/Y/Z spinners
- Parent assignment dropdown
- **Auto-Center Joint** — snap joint to voxel centroid for the part
- Voxel count per bone

### Keyframe Editor (Right Panel)

- Animation duration slider (0.1s minimum)
- Keyframe list (time / pose / easing)
- Add keyframe at current playback time
- Quick "create pose + keyframe" action
- **Easing per keyframe**: linear, ease-in-out, bounce, elastic, step, custom (cubic Bezier)
- **Root position** (when root motion enabled) — drives world translation
- **Per-bone Euler XYZ rotations** for the active keyframe (degrees)

### Timeline (Bottom Panel)

- **Playback**: play / pause (`Space`), stop, current/duration display, speed slider 0.1×–3.0×
- **Scrub track**: click to seek, drag to scrub, keyframe dots, playhead
- **Modes**: Loop / Ping-Pong / Once
- **Onion skinning**: ghost frames from adjacent keyframes

## Body Parts (Build Mode, Parts Panel)

- Character name editor
- Hierarchical parts tree with depth indentation
- Add part (text input + Enter)
- Per-part editor: ID, parent dropdown, joint XYZ, voxel count, delete

## Poses (Build Mode, Pose Panel)

- Named pose list
- Create pose (text + button)
- Per-pose editor:
  - **Preview** checkbox — visualize pose on character in viewport
  - Per-bone Euler rotations XYZ (degrees, live update)

## 3D Viewport

- React Three Fiber + Three.js perspective camera (FOV 50°)
- OrbitControls — left pan, middle/scroll zoom, right rotate, screen-space panning
- **Auto-frame** on first voxel placement
- Grid (configurable, fade distance 200u)
- Ground plane at Y = −0.5 (click to place at Y = 0)
- **Mirror plane** overlay (red X / blue Z) when active
- **Ghost voxel** preview cube under the cursor (Place tool)

## Joint Gizmos

When gizmos are enabled in Animate mode:

- Draggable spheres per bone (white / yellow selected / orange dragging)
- Horizontal-plane drag constraint with live coordinate label
- Integer snapping on drop
- White lines connecting child joint to parent joint
- When pose preview is on, gizmos show FK-computed posed positions

## File Operations

### File Menu

**Unified project workspace** (Phase 0.0):

- **Set Project Root…** — pick a project directory via the File System Access API. The handle is persisted via IndexedDB and re-acquired on next launch (you only pick once per project).
- **Save to Project** — save the current `.echidna` file under `tools_data/echidna_saves/{id}.echidna` in the project root.
- **Export Character to Project** — write the engine-ready PLY + manifest under `assets/characters/{id}/{id}.ply` and `assets/characters/{id}/{id}.manifest.json`. The engine resolves these paths via the bridge's project-root mechanism.

**Legacy download/upload** (still available as a safety net):

- **New Project** — preset sizes 32–256 or custom 8–1024
- **Save** / **Save As…** — `.echidna` JSON v3 format (browser download)
- **Load** — file picker
- **Resize Grid** — expand or contract grid
- **Import** — `.ply`, `.vox`, `.obj`

### Persistent character `id`

Each character has a stable `id` slug that's set on the **first save** and never changes thereafter. Renaming the character via the editor does not relocate files. The `id` is derived from `characterName` via `slugifyCharacterId` (lowercase, whitespace → underscore, strip non-`[a-z0-9_-]`, fallback `'character'`).

### Import Formats

- **`.vox`** (MagicaVoxel) — each model becomes a separate body part, palette colors preserved
- **`.ply`** — voxelize point cloud, optional companion `.manifest.json` for bones/poses
- **`.obj`** — voxelize mesh vertices with configurable resolution (8–256)

All imports configure grid size (8–1024).

### Export

- **PLY+Manifest** — recommended for engine use
- **Posed PLY** — bake current pose into PLY (no skinning needed)
- **Density**: 1× / 2× / 3× / 4× sub-Gaussian subdivisions (1, 8, 27, 64 Gaussians per voxel)
- **Include `bone_index`** checkbox for skinning support

## Keyboard Shortcuts

### File
| Key | Action |
|-----|--------|
| `Cmd/Ctrl+N` | New project |
| `Cmd/Ctrl+S` | Save |
| `Cmd/Ctrl+Shift+S` | Save As… |
| `Cmd/Ctrl+O` | Open |

### Edit
| Key | Action |
|-----|--------|
| `Cmd/Ctrl+Z` | Undo (50-step history) |
| `Cmd/Ctrl+Shift+Z` / `Cmd/Ctrl+Y` | Redo |
| `Cmd/Ctrl+C` | Copy selection |
| `Del` / `Backspace` | Delete selection |
| `Esc` | Clear selection |

### Build Tools
`V` Place · `B` Paint · `E` Erase · `I` Eyedropper · `G` Fill · `X` Extrude · `S` Box select · `L` Lasso select · `[` / `]` brush size · `T` x-ray

### Animate
`Space` Play/Pause · `S` Box select

## Export Format

### PLY (binary little-endian)

3D Gaussian splat properties:
- `x, y, z` — position (centered at grid midpoint)
- `f_dc_0/1/2` — diffuse color (linear sRGB)
- `opacity`
- `scale_0/1/2` — log-scale Gaussian size
- `rot_0/1/2/3` — quaternion
- `bone_index` (optional uchar) — skinning index

Surface voxels only — fully-interior voxels are culled.

### Echidna save file (`.echidna`)

JSON v3 with `id` (persistent slug), `characterName`, `gridWidth`/`gridDepth`, `voxels`, `parts`, `poses`, `animations`. Legacy v1/v2 files are auto-migrated on load via `migrateEchidnaFile`.

### Character Manifest (`.manifest.json`)

```json
{
  "name": "walker",
  "ply_file": "walker.ply",
  "scale": 1.0,
  "bones": [{ "id": "spine", "parent": "root", "joint": [0, 1, 0] }],
  "poses": {
    "idle": { "bone_rotations": { ... }, "root_position": [0, 0, 0] }
  },
  "animations": {
    "walk": {
      "duration": 1.0,
      "looping": true,
      "root_motion": true,
      "keyframes": [
        { "time": 0, "pose": "idle", "easing": "linear" }
      ]
    }
  }
}
```

## Engine Integration

### Bridge REST API (`http://localhost:9101`)

- `POST /api/characters/{charId}/file/{filename}` — binary PLY upload
- `POST /api/characters/{charId}/manifest` — JSON metadata upload

### Auto-Sync to Staging

Toggle in **View → Auto-Sync Staging**. Debounced 2s after voxel/part changes — uploads PLY + manifest live for in-engine preview.

### Preview in Staging

**File → Preview in Staging** constructs a minimal scene JSON with a Gaussian splat camera + the character + animation manifest, then loads it in the running Staging app via WebSocket.

## Animation System

### Poses

Per-bone Euler rotations + optional root position offset. Snapshots that animations interpolate between.

### Clips

- Name + duration
- Time-ordered keyframe sequence
- Playback mode: loop / ping-pong / once
- Optional root motion flag

### Keyframes

- Time (seconds)
- Reference pose name
- Easing function (linear, ease-in-out, bounce, elastic, step, custom Bezier)
- Optional per-part filter (animate only specific bones)

### Playback

- SLERP per-bone rotation interpolation
- Easing applied between keyframes
- Speed multiplier 0.1×–3.0×
- Onion-skin ghost frames during scrub

### Forward Kinematics

Recursive transform accumulation through the bone hierarchy, used for both pose preview and posed PLY export.

## Build

```bash
pnpm --filter @gseurat/echidna build
```

Outputs to `tools/apps/echidna/dist/`.

## Tests

```bash
pnpm --filter @gseurat/echidna test
```

Vitest covers voxel ops, PLY export/import, OBJ/VOX import, easing functions, and manifest export.
