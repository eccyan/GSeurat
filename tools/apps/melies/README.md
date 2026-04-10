# Méliès

Web-based VFX editor for the GSeurat engine. Author particle effects, animations, lights, and PLY-based objects as reusable presets that load into Bricklayer scenes and play back live in Staging.

## Quick Start

```bash
pnpm --filter @gseurat/melies dev
```

Open <http://localhost:5181>. The bridge server (port 9100/9101) and a running Staging instance are required for "Open in Staging" / Auto-Sync.

## Workspace Layout

- **Menu Bar** (top) — File / Edit / View
- **Left Sidebar** — VFX tree: scenes + presets with their layers
- **Center Viewport** — 3D preview with gizmos and Gaussian point cloud
- **Right Sidebar** — context-aware properties (layer or preset settings)
- **Timeline** (bottom) — playback scrubber with per-layer track bars

## VFX Element Types

Méliès composes a preset out of four element types:

### Object (PLY)

Loads a Gaussian point cloud as a static prop in the preset.

- `ply_file` — path (project-relative or absolute)
- `position`, `scale`
- Region (sphere or box) — defines the volume animation layers can target
- No timeline — always visible while the preset is active

### Emitter

Spawns particles using a WASM-powered ParticleEmitter.

**Core parameters**: spawn rate, lifetime min/max, velocity min/max, acceleration, color start/end, scale min/max + end factor, opacity start/end, emission, burst duration.

**Spawn region**: box (center + half_extents) or sphere (radius).

**Spline path** (optional):
- `emitter_path` — emitter moves along a Catmull-Rom spline (`emitter_speed` cycles/sec)
- `particle_path` — particles route along the spline (`path_spread`, `align_to_tangent`)

**Built-in presets**: `dust_puff`, `spark_shower`, `magic_spiral`, `fire`, `smoke`, `rain`, `snow`, `leaves`, `fireflies`, `steam`, `waterfall_mist`, `rain_drops`. Any preset can be overridden field-by-field.

**Timeline**: `start`, `duration`, `loop`.

### Animation

Applies WASM-powered Gaussian transformations to point clouds within a region.

**Effect types**: `detach`, `float`, `orbit`, `dissolve`, `reform`, `pulse`, `vortex`, `wave`, `scatter`.

**Parameters** (effect-dependent, all with easing): rotations, expansion, height rise, opacity end, scale end, velocity, noise, wave speed, pulse frequency, gravity.

**Easing**: 11 functions × 3 directions — `linear`, `quad`, `cubic`, `quart`, `quint`, `sine`, `expo`, `circ`, `back`, `elastic`, `bounce` (each in/out/in_out).

**Reform system**: optional second phase reforms the original shape (`reform_enabled`, `reform_lifetime`).

**Region**: sphere (radius) or box (half_extents) — only affects Gaussians inside.

**Timeline**: `start`, `duration`, `loop`.

### Light

Adds a point light to the scene for Staging rendering.

- `color`, `intensity`, `radius`, `position`
- No timeline — always on while the preset is active

## Timeline Editor

- **Playback**: play/pause, stop, time display (MM:SS.SS), duration auto-derived
- **Scrubber**: click to seek, drag to scrub, white playhead
- **Track bars** (color-coded): emitter pink, animation cyan, light yellow
- **Drag interactions**: drag bar body to move, drag edges to resize start/duration
- **Snap**: 0.05s grid

## VFX Tree (Left Sidebar)

**Scenes** — registered PLY files. Click to set active, `+` to load, `×` to remove.

**Presets** — expandable per-preset:
- `+` Emitter / `+` Animation / `+` Light buttons
- Per-layer: icon, name, mute (eye), solo (S), remove (×)

## Properties Panel

Context-aware right panel switches between **Layer Mode** and **Preset Settings Mode**.

**Common layer fields**: name, type, position, start, duration, loop.

**Type-specific editors**: PLY picker (object), spawn region + 18 emitter params + spline editor, animation effect dropdown + easing-aware param sliders, light color/intensity/radius.

**Preset settings**: name, duration override, derived duration info.

## 3D Viewport

- React Three Fiber + Three.js with OrbitControls (pan / rotate / zoom)
- Gaussian point cloud with shader-based color and scale attributes
- **Gizmos** (selectable):

  | Type | Marker | Color |
  |------|--------|-------|
  | Object | Octahedron | white / gray |
  | Emitter | Sphere + spawn region outline | pink |
  | Animation | Wireframe region | cyan |
  | Light | Sphere | yellow |
  | Spline | Curve + control handles | green / orange |

- **Toggles**: View → Show Gizmos, Show Point Cloud

## File Operations

### File Menu

- **New VFX**
- **Open Project…** — File System Access API directory or `.json` upload
- **Save Project** — directory or download
- **Import .vfx.json…**
- **Export .vfx.json**
- **Import Scene PLY…**
- **Open in Staging** — push current preset over the bridge

### Auto-Sync to Staging

Toggle in **View → Auto-Sync Staging**. Debounced 2s live sync — edits stream to Staging without manual export.

## File Format

### Project (`project.json`)

```json
{
  "version": 2,
  "presets": [...],
  "scenes": [...],
  "activeSceneId": "..."
}
```

### Preset (`.vfx.json`)

```json
{
  "name": "My Effect",
  "duration": 3.0,
  "elements": [
    {
      "name": "burst",
      "type": "emitter",
      "position": [0, 1, 0],
      "start": 0,
      "duration": 1,
      "loop": false,
      "emitter": { ... }
    }
  ]
}
```

### Project Layout

```
my_project/
├── project.json
├── effects/
│   ├── preset_1.vfx.json
│   └── preset_2.vfx.json
└── scene/
    ├── scene1.ply
    └── scene2.ply
```

## Keyboard Shortcuts

### Always Active
| Key | Action |
|-----|--------|
| `Cmd/Ctrl+S` | Save project |
| `Cmd/Ctrl+O` | Open project |
| `Cmd/Ctrl+D` | Duplicate selected layer |

### Playback (when not typing)
| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Esc` | Stop (reset to 0) |
| `Del` / `Backspace` | Remove selected layer |
| `Home` / `,` | Seek to start |
| `End` / `.` | Seek to end |
| `←` / `→` | Seek ±0.1s |
| `Shift+←` / `Shift+→` | Nudge selected layer ±0.05s |

## Layer Visibility

- **Mute** (eye) — hide layer during playback
- **Solo** (S) — isolate layer, mute all others
- WASM simulation respects per-layer visibility

## Bricklayer Integration

Méliès presets get loaded as **VFX Instances** in Bricklayer scenes:

1. Author preset in Méliès → save as `.vfx.json`
2. In Bricklayer, add a VFX Instance referencing the preset path
3. Bricklayer writes the file via the bridge before pushing the scene
4. Staging plays back the preset live

## Build

```bash
pnpm --filter @gseurat/melies build
```

Outputs to `tools/apps/melies/dist/`.

## Notes & Limitations

- Animation effects target scene point clouds or object PLY clouds — not emitter particles
- Spline gizmo is read-only in the viewport (edit via properties panel)
- No undo/redo system yet
- Schema v2 with v1 migration support (legacy `layers` → `elements`)
