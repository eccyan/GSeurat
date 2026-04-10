# Bricklayer

Web-based 3D Gaussian Splatting map and level editor for the GSeurat engine. Edit voxel terrain, place game objects, configure lighting and cameras, and sync scenes live to the Staging app.

## Quick Start

```bash
pnpm --filter @gseurat/bricklayer dev
```

Open <http://localhost:5180>. The bridge server (port 9100/9101) and a running Staging instance are required for live sync.

## Modes

Bricklayer is organized into three top-level modes accessible from the toolbar:

- **TERRAIN** — voxel sculpting, palettes, collision grid
- **SCENE** — game objects, lights, portals, particles, cameras
- **SETTINGS** — global ambient, weather, day/night, backgrounds, GS background camera

## Terrain Mode

### Tools

| Key | Tool | Purpose |
|-----|------|---------|
| `V` | Place | Add voxels at brush size |
| `B` | Paint | Recolor existing voxels |
| `E` | Erase | Remove voxels |
| `G` | Fill | 3D flood fill |
| `X` | Extrude | Vertical extrusion |
| `I` | Eyedropper | Sample voxel color |
| `S` | Select | Selection tool |

### Brush

- Size 1–8 (`[` / `]` to adjust)
- Mirror X / Z toggles
- Y-level lock for planar editing
- Ghost preview before placement

### Palettes

- 256-color palettes per project
- Multi-palette support, switch active palette anytime
- Image-based palette extraction (load PNG → quantize)
- Quick-add current color, hex input, RGB picker

### View Aids

- Grid overlay toggle
- X-Ray mode (`T`) for interior editing
- Y-min / Y-max clipping
- Full undo/redo history

## Collision Grid

Editable per-cell collision data layered over terrain:

- **Solid layer** — walkable / blocked cells
- **Elevation layer** — per-cell ground height for stairs and ramps
- **Navigation zones** — named regions for AI / pathfinding

Tools: box fill, flood fill, individual cell toggle, elevation paint, zone paint, **auto-generate from voxel slope** with configurable slope threshold.

## Scene Mode

### Game Objects

Place PLY-based 3D models with full transform (position / rotation / scale).

**Components system** — attach gameplay components from a schema:

- `Health` — max + current HP
- `Interactable` — prompt text + radius
- `Facing` — cardinal direction
- `Patrol` — waypoints, speed, pause
- `Dialog` — dialog ID
- `CharacterModel` — voxel character reference (Echidna)
- Custom components via schema (float / int / bool / string / vec3 / color / enum fields)

**PBD physics** — per-object position-based dynamics:

- Modes: `wind_sway` / `physics`
- Wind direction, strength, frequency
- Gravity, damping, bounce, ground constraint
- Pinned / unpinned, rest-length constraints between objects
- Sway threshold

### Lighting

Three light types with full gizmos:

- **Point** — omnidirectional with radius falloff
- **Spot** — direction + cone angle (degrees)
- **Area** — width / height / normal for rectangular panels

Per-light: position, radius, color, intensity. Scene-level: ambient color, god-rays intensity.

### Portals

Position, size, target scene, spawn point + facing direction.

### Player

Start position, tint (RGBA), facing, character ID.

### Particle Emitters (GS)

20+ tunable properties for Gaussian splat particles:

- Spawn rate, lifetime min/max
- Velocity min/max, acceleration
- Color start/end, scale start/end + end factor
- Opacity start/end, emission strength
- Spawn region: box or sphere with offset
- Spline path with control points
- Burst duration
- Preset library (`dust_puff`, `spark_shower`, `magic_spiral`, `fire`, `smoke`, `rain`, `snow`, `wind`, …)

### Animation Groups (GS)

Per-volume splat animations:

- **Effect types**: `detach`, `float`, `orbit`, `dissolve`, `reform`
- **Shapes**: sphere or box
- **Parameters**: rotation, expansion, height rise, opacity end, scale end, velocity, gravity, noise, wave speed, pulse frequency
- **Easing**: 20+ functions (linear / quad / cubic / quart / quint / sine / expo / circ / back / elastic / bounce — each in/out/in_out)
- Loop, mute, reform-after-animation

### Special VFX Emitters

Torch flames, footstep particles, NPC aura — placed by coordinate arrays.

### Méliès VFX Instances

Load presets authored in Méliès. Per-instance: position, Y rotation, radius, trigger mode (auto / event), loop, mute. Supports VFX presets containing objects, emitters, animations, and lights.

### Cameras

**Camera zones** — define camera behavior per region:

- Modes: `free_look`, `rail_follow`, `cinematic_rail`, `fixed_point`, `side_scroll`
- Volume shapes: AABB or sphere
- Per-zone: priority, blend time, allow user orbit, pitch / yaw constraints, FOV, orbit distance, offset, fixed position

**Camera rails** — spline paths with control + target waypoints, visual editor.

**Camera triggers** — volume-based zone-to-zone transitions with optional blend override.

## Settings Mode

### GS Background Camera

Camera position, target, FOV, render resolution, scale multiplier. Parallax: azimuth / elevation / distance ranges + parallax strength.

### Ambient

Global ambient color (RGBA), god-rays intensity.

### Weather

- Types: `rain`, `snow`, `ash`, `leaves`
- Fog density + color
- Ambient override during weather
- Transition speed
- Custom emitter properties (spawn, lifetime, velocity, color, size)

### Day / Night Cycle

Keyframe-based time progression — each keyframe defines time (0–1), ambient color, and torch intensity. Cycle speed and initial time configurable.

### Background Layers

Texture-based parallax backgrounds — texture, Z-depth, parallax factor, quad dimensions, UV repeat, tint, wall mode + Y offset.

## Camera Controls

| Action | Binding |
|--------|---------|
| Orbit | Mouse drag |
| Lock orbit during draw | Hold `Shift` |
| Teleport to point | Double-click |
| Frame selection | `F` |
| Reset view | `H` |
| Axis-lock during grab | `X` / `Y` / `Z` |

## File Operations

### File Menu

- **New Project** — 128×96 grid default
- **Open Project** — directory or `.zip`
- **Save Project** — directory or `.zip` (auto-save every 60s when dirty)
- **Import Asset** — PLY, PNG/JPG, WAV/MP3, VFX JSON
- **Import Image** — heightmap with mode (flat / luminance / depth)
- **Export Scene** — engine-format JSON
- **Export PLY** — voxel terrain to PLY
- **Open in Staging** — push current scene over the bridge
- **Connect Bridge to Project Root…** — Phase 0.0: prompts for the project's absolute disk path and POSTs it to the bridge's `/api/project/root` endpoint, so the engine resolves relative asset paths under the same root the editors are saving to.

### Auto-Sync to Staging

Toggle in **View → Auto-Sync Staging**. Bricklayer fingerprints scene structure and sends incremental updates: lightweight property changes skip the full scene reload, while structural changes trigger a complete push.

## Project Format

`BricklayerFile` JSON v2 (Phase 0.0):

- **`asset_registry`** — top-level field indexing characters / VFX / textures / audio / maps by stable IDs (`#walker` etc.). Synthesized from legacy v1 `assets[]` on first load.
- Multi-terrain entries (voxel + collision per terrain)
- Unified scene data (objects, lights, portals, player, emitters, animations, VFX, cameras)
- Component schemas for extensibility

Asset references in entity fields use either the registry-ID form (`#walker`) or a project-relative path (`assets/characters/walker/walker.manifest.json`). Bare filenames and absolute paths are forbidden — `exportSceneJson` runs a `validateScenePaths` check and logs warnings for any violations during the migration window.

### Project layout on disk (Phase 0.0)

When saved to a directory, Bricklayer writes under the unified GSeurat project layout:

```
my_project/
├── tools_data/
│   └── bricklayer/
│       └── scene.bricklayer       # editor state
└── assets/
    ├── scenes/{slug}.json         # engine-format scene JSON
    ├── maps/{slug}.ply            # terrain Gaussian cloud
    ├── vfx/presets/{name}.vfx.json  # VFX instance presets
    ├── characters/{id}/...        # referenced via the asset_registry
    └── textures/...
```

`loadProject` reads `tools_data/bricklayer/scene.bricklayer` first and falls back to a legacy root-level `scene.bricklayer` with a warning. The ZIP fallback paths (`saveProjectAsZip`/`loadProjectFromZip`) are unchanged.

## Integration

| Tool | Role |
|------|------|
| **Staging** (C++) | Live render review via `/tmp/gseurat.sock` |
| **Méliès** (port 5181) | Authored VFX presets imported as instances |
| **Echidna** (port 5179) | Voxel character models referenced by ID |
| **Audio Composer** | Audio assets referenced from project registry |

## Keyboard Reference

### Tools
`V` Place · `B` Paint · `E` Erase · `G` Fill / Grab · `X` Extrude · `I` Eyedropper · `S` Select

### General
`[` / `]` brush size · `T` x-ray · `Ctrl/Cmd+S` save · `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y` redo · `Esc` cancel · `Shift` orbit lock · `F` frame · `H` home

### Grab Mode (Scene)
`G` enter grab · click to confirm · `Esc` cancel · `X` / `Y` / `Z` axis-lock

## Menu Reference

- **File** — New, Open, Save, Import Asset, Import Image, Export Scene, Export PLY, Open in Staging
- **Edit** — Undo, Redo
- **View** — Grid, Collision, Gizmos, X-Ray, Auto-Sync Staging

## Workspace Layout

- **Left panel** — project tree + contextual tools (resizable)
- **Center** — 3D viewport with gizmos
- **Right panel** — property editor (context-aware, changes by selection)
- **Top** — menu bar + mode tabs

## Build

```bash
pnpm --filter @gseurat/bricklayer build
```

Outputs to `tools/apps/bricklayer/dist/`.
