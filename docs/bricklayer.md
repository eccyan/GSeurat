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
| V / B / E / X / I / S   | Tool shortcuts (Place/Paint/Erase/Extrude/Eyedropper/Select) |
| G                        | Grab mode (Scene) / Fill (Terrain) |
| Shift (hold, Terrain)    | Lock orbit for drawing |
| Shift (hold, Grab)       | Adjust Y height |
| F                        | Frame selected entity |
| H                        | Home (reset camera) |
| Double-click             | Teleport camera to point |
| `[` / `]`               | Decrease / increase brush size |
| T                        | Toggle X-ray mode |
| Cmd+Z / Cmd+Shift+Z     | Undo / Redo    |

## Image Import

**File > Import Image** opens a dialog with three modes:

| Mode       | Description |
|------------|-------------|
| **Flat**       | One voxel per pixel at Z=0 (image on X,Y plane) |
| **Luminance**  | Column depth from brightness (`0.299R + 0.587G + 0.114B`) extending along +Z |
| **Depth AI**   | Uses Depth Anything V2 (in-browser via `@huggingface/transformers`) to estimate per-pixel depth. Close objects get deeper columns. Model (~50 MB) downloads on first use and is cached in IndexedDB. |

**Max Width** slider (default 256px) downscales the image before voxelization.
This controls editor viewport performance; there is no engine-side limit on map
width or voxel count.

**Max Height** slider (luminance/depth modes) controls the maximum column depth.
There is no engine-side limit on map height.

### Coordinate Mapping

Images are mapped to the X,Y plane facing the camera:

- **X** = image horizontal (left to right)
- **Y** = image vertical (top of image = high Y)
- **Z** = depth columns extend into +Z

### Performance

- **No map size limits**: The engine imposes no restrictions on map width, height,
  or total voxel/Gaussian count. The adaptive LOD budget automatically decimates
  large scenes to maintain 30+ FPS regardless of size. A 949K Gaussian scene
  (256×256 with depth) runs at 30+ FPS via distance-based LOD that keeps near
  chunks at full density and aggressively decimates far chunks.
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
| **Lights**      | Static lights (Point/Spot/Area) with type selector, position, color, per-type controls |
| **Weather**     | Weather type (rain/snow/ash/leaves), fog, ambient override, emitter config |
| **VFX**         | Torch/footstep/aura particle emitters, torch position list |
| **Entities**    | Player spawn, NPC list, portal list |
| **BG**          | Background layers with texture, parallax, tiling, wall mode |
| **GS**          | Gaussian splat camera, render dimensions, scale, parallax settings |

## 3D Gizmos

When "Gizmos" is checked in the View section:

- **Point Lights** — sphere + radius ring
- **Spot Lights** — sphere + wireframe cone (shows angle label when selected)
- **Area Lights** — sphere + wireframe rectangle (shows size label when selected)
- **NPCs** — blue cylinders with dashed waypoint polylines
- **Portals** — purple wireframe boxes
- **Player** — green cylinder with arrow cone

Click a gizmo to select the entity. Press **G** to grab and move (Blender-style: object follows mouse, click to confirm, Esc to cancel). Hold **Shift** during grab to adjust Y height.

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

## GS Lighting

Static lights placed in Bricklayer affect the Gaussian Splatting scene at runtime.
The engine supports 3 light modes (toggle with **L** key in demo):

| Mode | Description |
|------|-------------|
| **0 — Off** | No lighting applied; raw baked GS colors |
| **1 — Directional** | Single directional light with pseudo-normal shading from depth gradients |
| **2 — Point/Spot/Area** | Up to 8 lights from scene data, with per-type attenuation |

### Light Types

| Type | Description | Bricklayer Fields |
|------|-------------|-------------------|
| **Point** | Omnidirectional (light bulb). Quadratic distance falloff. | Position, Radius, Height, Color, Intensity |
| **Spot** | Cone-shaped beam (flashlight). Smooth inner/outer edge falloff. | + Direction XYZ, Cone Angle (1-179°) |
| **Area** | Rectangular surface (window/panel). Closest-point-on-rectangle technique. | + Area Size (W/H), Face Direction (XZ) |

Bricklayer provides a **Type dropdown** (Point/Spot/Area) per light with type-specific descriptions and controls. Gizmos: radius ring (point), wireframe cone with angle label (spot), wireframe rectangle with size label (area).

### Screen-Space Contact Shadows

Each light casts approximate shadows via tile-local depth ray-marching:
1. For each pixel, project the light to screen space
2. March 4 steps within the 16×16 tile toward the light
3. If a step's depth indicates closer geometry (occlusion), reduce the light contribution

Short-range contact shadows only (tile-bounded) but adds depth perception at near-zero cost.

### Emissive Gaussians

PLY files can include an `emission` float property (default 0). Emissive Gaussians add HDR color values > 1.0 to the output, which the existing bloom extract pipeline automatically picks up for glow effects. No extra render passes needed.

Test scene: `assets/scenes/emissive_test.json` — 6 colored glowing pillars with 2 point lights.

### God Rays (Volume Light)

Screen-space volumetric light shafts in the composite shader. For each light, radial-samples the depth buffer (24 samples) from each fragment toward the light's screen position. Open sky (far depth) contributes light, creating visible beams through geometry.

Controlled via `god_rays_intensity` (0 = off, 0.5-2.0 typical). Configured in Bricklayer under Settings > Ambient & Lighting.

### How Lighting Works

The GS tile rasterizer compute shader (`gs_render.comp`):
1. Reconstructs approximate world position from pixel coordinates + first-hit depth
2. Computes pseudo-surface-normal from tile depth gradients (16×16 shared memory)
3. For each light: calculates distance attenuation, spot cone / area rectangle falloff, contact shadow, and half-Lambert NdotL
4. Tints the Gaussian's baked color by the accumulated light contribution
5. Adds emissive glow additively (bypasses lighting, feeds into bloom)

### Limitations

- **Pseudo-normals**: Surface normals are estimated from screen-space depth discontinuities,
  not from true geometry. Works well for large surfaces but can produce artifacts at edges.
- **Contact shadows are tile-local**: Limited to 16×16 pixel range (~15 pixel max shadow length).
- **Max 8 lights**: Limited by the uniform buffer size. Additional lights are ignored.
- **Light_mode=2 auto-enabled**: When a scene has `static_lights`, point light mode activates
  automatically on load.

### Scene JSON Light Format

```json
{
  "static_lights": [
    { "position": [x, z], "radius": 100, "height": 3, "color": [r,g,b], "intensity": 5 },
    { "position": [x, z], "radius": 50, "height": 5, "color": [r,g,b], "intensity": 3,
      "direction": [0, -1, 0], "cone_angle": 45 },
    { "position": [x, z], "radius": 30, "height": 3, "color": [r,g,b], "intensity": 2,
      "area_width": 5, "area_height": 3, "area_normal": [1, 0] }
  ]
}
```

## Gaussian Particle Emitters

Scene files can include a `gs_particle_emitters` array to place continuous 3D Gaussian
particle effects (dust, sparks, magic) directly in the scene. Emitters spawn new Gaussian
splats each frame — they are self-lit (bypass scene lighting) and render through the same
compute pipeline as the scene.

### Presets

Three built-in presets provide common effects. Use `"preset"` and override any fields:

| Preset | Description | Spawn Rate | Lifetime | Emission |
|--------|-------------|------------|----------|----------|
| `dust_puff` | Brown dust cloud, burst, slow fall | 120/s | 1-2.5s | 0 (scene-lit) |
| `spark_shower` | Orange sparks with gravity, self-lit | 40/s | 0.3-0.8s | 0.8 |
| `magic_spiral` | Blue-to-magenta rising particles | 50/s | 1.5-3s | 0 (scene-lit) |
| `fire` | Rising orange-red flames, self-lit | 80/s | 0.4-1.2s | 1.5 |
| `smoke` | Slow gray plume, expanding scale | 30/s | 2-4s | 0 (scene-lit) |
| `rain` | Fast downward blue-white streaks, wide area | 200/s | 0.5-1s | 0 (scene-lit) |
| `snow` | Gentle white drift with horizontal sway | 60/s | 3-6s | 0 (scene-lit) |
| `leaves` | Falling green-to-brown leaves, slow | 15/s | 3-6s | 0 (scene-lit) |
| `fireflies` | Tiny glowing yellow-green dots, random drift | 8/s | 3-7s | 1.0 |
| `steam` | White rising wisps, fast fade, expanding | 40/s | 0.5-1.5s | 0 (scene-lit) |
| `waterfall_mist` | Blue-white spray, horizontal spread | 100/s | 1-2.5s | 0 (scene-lit) |

### Parameters

All fields are optional. When `preset` is specified, its values load first, then explicit fields override.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `preset` | string | — | `"dust_puff"`, `"spark_shower"`, or `"magic_spiral"` |
| `position` | [x,y,z] | [0,0,0] | Scene/voxel coordinates (same system as lights) |
| `spawn_rate` | float | 10 | Particles spawned per second |
| `lifetime_min` | float | 0.5 | Minimum particle lifetime (seconds) |
| `lifetime_max` | float | 1.5 | Maximum particle lifetime (seconds) |
| `velocity_min` | [x,y,z] | [-1,1,-1] | Minimum initial velocity |
| `velocity_max` | [x,y,z] | [1,3,1] | Maximum initial velocity |
| `acceleration` | [x,y,z] | [0,-9.8,0] | Constant acceleration (default: gravity) |
| `color_start` | [r,g,b] | [1,0.8,0.3] | Color at birth |
| `color_end` | [r,g,b] | [1,0.2,0] | Color at death |
| `scale_min` | [x,y,z] | [0.3,0.3,0.3] | Minimum initial scale |
| `scale_max` | [x,y,z] | [0.6,0.6,0.6] | Maximum initial scale |
| `scale_end_factor` | float | 0 | Scale multiplier at death (0 = vanish) |
| `opacity_start` | float | 1.0 | Opacity at birth |
| `opacity_end` | float | 0.0 | Opacity at death |
| `emission` | float | 0 | Self-illumination (>0 bypasses lighting, triggers bloom) |
| `spawn_offset_min` | [x,y,z] | [0,0,0] | Min random offset from position |
| `spawn_offset_max` | [x,y,z] | [0,0,0] | Max random offset from position |
| `burst_duration` | float | 0 | 0 = continuous loop; >0 = auto-stop after N seconds |

### Scene JSON Format

```json
{
  "gs_particle_emitters": [
    { "preset": "spark_shower", "position": [32, 8, 32] },
    { "preset": "dust_puff", "position": [20, 2, 50], "spawn_rate": 50 },
    {
      "position": [10, 5, 10],
      "spawn_rate": 20,
      "color_start": [0.2, 0.8, 1.0],
      "color_end": [0.0, 0.2, 0.5],
      "emission": 2.0,
      "scale_min": [0.1, 0.1, 0.1],
      "velocity_min": [-0.5, 0.5, -0.5],
      "velocity_max": [0.5, 2.0, 0.5]
    }
  ]
}
```

### Coordinate System

Emitter positions use the same scene/voxel coordinate system as lights:
`[scene_x, height, scene_z]`. The engine transforms these to PLY world coordinates
at load time using the cloud AABB offset.

## Gaussian Animations

Scene files can include a `gs_animations` array to apply particle-like effects to existing
scene Gaussians within a region. Unlike particle emitters (which spawn new splats), animations
modify existing Gaussians in-place — scattering, floating, orbiting, dissolving, or reforming them.

### Effects

| Effect | Description |
|--------|-------------|
| `detach` | Scatter outward from region center with gravity, fade opacity |
| `float` | Drift upward with horizontal noise, shrink scale |
| `orbit` | Swirl around region center, increasing radius |
| `dissolve` | Shrink to zero, fade opacity, slight drift |
| `reform` | Restore to original position, scale, and color |
| `pulse` | Scale oscillates rhythmically (crystals, magic objects) |
| `vortex` | Spiral inward/upward with tightening radius (tornado) |
| `wave` | Sinusoidal ripple propagating from center (shockwave) |
| `scatter` | Explosive outward burst (impacts, shattering) |

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `effect` | string | `"detach"` | One of: detach, float, orbit, dissolve, reform |
| `region.shape` | string | `"sphere"` | `"sphere"` or `"box"` |
| `region.center` | [x,y,z] | [0,0,0] | Scene/voxel coordinates (same as lights/emitters) |
| `region.radius` | float | 5.0 | Sphere radius (when shape=sphere) |
| `region.half_extents` | [x,y,z] | [5,5,5] | Box half-extents (when shape=box) |
| `lifetime` | float | 3.0 | Duration in seconds before effect completes |
| `loop` | boolean | false | Restart automatically when finished |

### Scene JSON Format

```json
{
  "gs_animations": [
    {
      "effect": "orbit",
      "region": { "shape": "sphere", "center": [32, 8, 32], "radius": 5 },
      "lifetime": 4.0,
      "loop": true
    },
    {
      "effect": "dissolve",
      "region": { "shape": "box", "center": [10, 3, 20], "half_extents": [2, 2, 2] },
      "lifetime": 3.0
    }
  ]
}
```

### Bricklayer Integration

In Bricklayer, animations appear in the project tree under "Animations" with cyan wireframe
sphere/box gizmos showing the animation region. Click to select, G to grab, Shift for height.

### Demo Visualization

In the GS demo, press **N** to toggle the scene layer overlay. Particle emitters appear
as magenta markers labeled **P0**, **P1**, etc. The HUD shows the total emitter count.
Press **J** to spawn a spark shower at the camera target (runtime, not saved to scene).
```
