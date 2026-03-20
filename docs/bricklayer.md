# Bricklayer — 3D Voxel Scene Editor

Bricklayer is a browser-based 3D voxel editor that replaces the old Map Painter.
It converts 2D images into voxel scenes and provides a full scene editor for the
engine's `SceneData` format.

## Quick Start

```bash
cd tools && pnpm install
cd apps/bricklayer && pnpm dev
# Opens on http://localhost:5180
```

## Controls

| Input                    | Action         |
|--------------------------|----------------|
| Left click + drag        | Orbit camera   |
| Middle click / two-finger drag | Pan (X,Y translation) |
| Scroll                   | Zoom           |
| V / B / E / G / X / I / S | Tool shortcuts (Place/Paint/Erase/Fill/Extrude/Eyedropper/Select) |
| `[` / `]`               | Decrease / increase brush size |
| Cmd+Z / Cmd+Shift+Z     | Undo / Redo    |

## Image Import

**File > Import Image** opens a dialog with three modes:

| Mode       | Description |
|------------|-------------|
| **Flat**       | One voxel per pixel at Z=0 (image on X,Y plane) |
| **Luminance**  | Column depth from brightness (`0.299R + 0.587G + 0.114B`) extending along +Z |
| **Depth AI**   | Uses Depth Anything V2 (in-browser via `@huggingface/transformers`) to estimate per-pixel depth. Close objects get deeper columns. Model (~50 MB) downloads on first use and is cached in IndexedDB. |

**Max Width** slider (default 256px) downscales the image before voxelization.
Lower values = fewer voxels, faster rendering.

**Max Height** slider (luminance/depth modes) controls the maximum column depth.

### Coordinate Mapping

Images are mapped to the X,Y plane facing the camera:

- **X** = image horizontal (left to right)
- **Y** = image vertical (top of image = high Y)
- **Z** = depth columns extend into +Z

### Performance

- **Surface culling**: Only voxels with at least one exposed face are rendered.
  Interior voxels (enclosed by 6 neighbors) are skipped. A solid column of
  height 16 renders ~5 instances instead of 16.
- **InstancedMesh**: All visible voxels rendered in a single draw call via
  Three.js `InstancedMesh` with pre-computed Float32Array buffers.

## Voxel Tools

| Tool       | Key | Description |
|------------|-----|-------------|
| Place      | V   | Click a face to place a voxel adjacent to it. Click ground plane for y=0. |
| Paint      | B   | Recolor an existing voxel with the active color. |
| Erase      | E   | Remove a voxel. |
| Fill       | G   | 3D flood fill from clicked voxel. |
| Extrude    | X   | Duplicate voxels one layer up (left click) or down (right click). |
| Eyedropper | I   | Pick color from an existing voxel. |
| Select     | S   | Select entities in the viewport. |

Brush size (1-8) affects Place, Paint, Erase, and Extrude.

## Inspector Panels

The right sidebar has seven tabs:

| Tab         | Contents |
|-------------|----------|
| **Scene**       | Grid info, ambient color, day/night cycle, auto-generate collision |
| **Lights**      | Static lights list with position, radius, height, color, intensity |
| **Weather**     | Weather type (rain/snow/ash/leaves), fog, ambient override, emitter config |
| **VFX**         | Torch/footstep/aura particle emitters, torch position list |
| **Entities**    | Player spawn, NPC list, portal list |
| **BG**          | Background layers with texture, parallax, tiling, wall mode |
| **GS**          | Gaussian splat camera, render dimensions, scale, parallax settings |

## 3D Gizmos

When "Gizmos" is checked in the View section:

- **Lights** — yellow spheres with radius rings
- **NPCs** — blue cylinders with dashed waypoint polylines
- **Portals** — purple wireframe boxes
- **Player** — green cylinder with arrow cone

Click a gizmo to select the entity and jump to its Inspector tab.

## Export

### PLY Export

**File > Export PLY** generates a binary PLY file compatible with the engine's
Gaussian Splatting renderer. The coordinate transform:

| Bricklayer | PLY   | Description |
|------------|-------|-------------|
| vx         | x     | Centered (`vx - gridWidth/2`) |
| vy         | y     | Centered (`vy - maxY/2`) |
| vz         | z     | Direct pass-through |

Each voxel becomes a Gaussian splat with:
- SH DC color coefficients (from voxel RGB)
- Pre-sigmoid opacity (from voxel alpha)
- Uniform scale (`log(0.5)` per axis)
- Identity rotation quaternion

### Scene JSON Export

**File > Export Scene** generates a complete engine scene JSON with all configured
elements: ambient color, lights, NPCs, portals, player spawn, backgrounds,
weather, day/night, VFX emitters, Gaussian splat config, and collision grid.

## Save Format

**File > Save** writes a `.bricklayer` JSON file (version 1) containing:

```json
{
  "version": 1,
  "gridWidth": 256,
  "gridDepth": 16,
  "voxels": [{ "x": 0, "y": 0, "z": 0, "r": 34, "g": 139, "b": 34, "a": 255 }],
  "collision": ["0,0", "1,0"],
  "scene": { /* all scene elements */ }
}
```

**File > Load** restores from a `.bricklayer` file.

## Architecture

```
tools/apps/bricklayer/
├── src/
│   ├── main.tsx / App.tsx          — Entry point, layout, keyboard shortcuts
│   ├── store/
│   │   ├── types.ts                — Voxel, SceneData, NPC, Light type defs
│   │   └── useSceneStore.ts        — Zustand store (voxels + scene + undo/redo)
│   ├── viewport/
│   │   ├── Viewport.tsx            — R3F Canvas + OrbitControls + lighting
│   │   ├── VoxelMesh.tsx           — InstancedMesh with surface culling
│   │   ├── GroundPlane.tsx         — Invisible XZ plane for ground placement
│   │   ├── GhostVoxel.tsx          — Semi-transparent hover preview
│   │   ├── LightGizmos.tsx         — 3D light markers + radius rings
│   │   ├── NpcMarkers.tsx          — NPC cylinders + waypoint lines
│   │   ├── PortalMarkers.tsx       — Wireframe portal rectangles
│   │   ├── PlayerMarker.tsx        — Player spawn indicator
│   │   └── CollisionOverlay.tsx    — Red XZ collision cells
│   ├── panels/
│   │   ├── MenuBar.tsx             — File operations
│   │   ├── ToolBar.tsx             — Voxel tools, color, brush, view toggles
│   │   ├── Inspector.tsx           — Tab container
│   │   ├── SceneTab.tsx            — Ambient, day/night, collision
│   │   ├── LightsTab.tsx           — Static lights editor
│   │   ├── WeatherTab.tsx          — Weather + fog editor
│   │   ├── VfxTab.tsx              — Particle emitter editors
│   │   ├── EntitiesTab.tsx         — Player, NPCs, portals
│   │   ├── BackgroundTab.tsx       — Background layers
│   │   ├── GaussianTab.tsx         — GS camera + parallax settings
│   │   └── ImportDialog.tsx        — Image import with mode/scale/depth AI
│   └── lib/
│       ├── plyExport.ts            — Voxel → binary PLY
│       ├── sceneExport.ts          — Store → engine scene JSON
│       ├── voxelUtils.ts           — Key helpers, flood fill, brush
│       └── depthEstimate.ts        — Depth Anything V2 wrapper
```

## Dependencies

- React 18 + Vite + Zustand (same stack as other tools)
- Three.js via `@react-three/fiber` + `@react-three/drei`
- `@huggingface/transformers` for in-browser depth estimation
- Port 5180 (same as old map-painter)
