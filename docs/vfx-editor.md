# VFX Editor — Visual Effect Composition Tool

The VFX Editor composes particle emitters, animations, and light flashes into
reusable VFX presets with timeline-based authoring.

## Quick Start

```bash
cd tools && pnpm install
cd apps/vfx-editor && pnpm dev
# Opens on http://localhost:5181
```

## VFX Production Workflow

Effects follow the three-phase structure common in professional VFX:

| Phase | Role | Example (Lightning) |
|-------|------|---------------------|
| **Anticipation** | Buildup — signals "it's coming" | Ground glow, converging particles |
| **Impact** | Peak energy — the main event | Flash, bolt, shockwave |
| **Residual** | Dissipation and aftermath | Smoke, scorch, stray sparks |

## Element Layers

Each effect is composed of parallel layers:

| Layer Type | Role | Color |
|------------|------|-------|
| **Emitter** | Particle effects (sparks, smoke, debris) | Magenta |
| **Animation** | GS effects on scene geometry (scatter, orbit, pulse) | Cyan |
| **Light** | Flash/glow illumination | Yellow |

## UI Layout

```
┌──────────┬────────────────────────────┬──────────┐
│ VFX List │     3D Preview             │ Layer    │
│          │                            │ Props    │
│          ├─Anticip─┬─Impact─┬─Resid───┤          │
│          │ [layer] │[layer] │ [layer] │          │
│          │ ▶ 0.0s ────────── 3.0s     │          │
└──────────┴────────────────────────────┴──────────┘
```

- **Left**: VFX preset list — create, select, delete
- **Center top**: 3D viewport (import PLY/Bricklayer data for preview)
- **Center bottom**: Timeline with phase markers and layer tracks
- **Right**: Properties for selected layer

## Controls

| Input | Action |
|-------|--------|
| File > New VFX | Create new preset |
| File > Open Project / Cmd+O | Open project directory |
| File > Save Project / Cmd+S | Save project to directory |
| File > Import .vfx.json | Load single VFX file |
| File > Export .vfx.json | Download selected preset |
| File > Import Scene PLY | Load PLY for 3D preview |
| + Emitter / + Anim / + Light | Add layer to timeline |
| Click layer bar | Select for editing |
| Drag layer bar | Move layer in time |
| Drag layer edges | Resize layer duration |
| Click scrubber | Seek to time |
| ▶ Play / ■ Pause | Preview playback with real particles |
| ↺ Reset | Return to start |

## File Format: `.vfx.json`

```json
{
  "name": "Lightning Strike",
  "duration": 2.5,
  "phases": { "anticipation": 0.8, "impact": 1.2 },
  "layers": [
    {
      "name": "Ground Glow",
      "type": "emitter",
      "phase": "anticipation",
      "start": 0,
      "duration": 0.8,
      "emitter": { "preset": "fireflies", "spawn_rate": 100, "emission": 2.0 }
    },
    {
      "name": "Flash",
      "type": "light",
      "phase": "impact",
      "start": 0.8,
      "duration": 0.1,
      "light": { "color": [1, 1, 0.9], "intensity": 50, "radius": 100 }
    },
    {
      "name": "Bolt Scatter",
      "type": "animation",
      "phase": "impact",
      "start": 0.8,
      "duration": 0.4,
      "animation": {
        "effect": "scatter",
        "params": { "velocity": 3, "opacity_end": 0, "opacity_easing": "out_expo" }
      }
    },
    {
      "name": "Smoke",
      "type": "emitter",
      "phase": "residual",
      "start": 1.2,
      "duration": 1.3,
      "emitter": { "preset": "smoke" }
    }
  ]
}
```

## Layer Types

### Emitter
Spawns Gaussian particles. Supports all 11 presets (dust_puff, fire, smoke, etc.)
and full custom configuration. See [Bricklayer docs](bricklayer.md#gaussian-particle-emitters).

### Animation
Applies effects to existing scene Gaussians. 9 effects available:
detach, float, orbit, dissolve, reform, pulse, vortex, wave, scatter.
Each with lifetime-centric params and 31 easing curves.
See [Bricklayer docs](bricklayer.md#gaussian-animations).

### Light
Instantaneous or brief light flash. Color, intensity, and radius.
Useful for impact moments (explosions, magic hits).

## Real-time Preview (WASM-powered)

The 3D viewport renders actual particles during playback using the
`@gseurat/simulation-wasm` module — the exact same C++ simulation code
as the engine, compiled to WebAssembly.

### What renders during playback
- **Emitter layers**: Real particles with per-particle color, opacity, and scale
- **Light layers**: Dynamic point light flash
- **Animation layers**: Region gizmos (animation preview on geometry planned)
- **Imported PLY**: Scene geometry as colored point cloud

### Particle rendering
- Custom `ShaderMaterial` with per-vertex RGBA colors (opacity fade) and per-vertex
  point sizes (scale_min/max)
- Soft circle fragment shader with smoothstep edges
- Additive blending for emissive particles (fire, sparks)
- All 11 presets work with custom overrides

### Import scene geometry
**File > Import Scene PLY** loads a `.ply` file into the viewport for context.
Particles render on top of the imported scene.

### Prerequisites
Build WASM module: `cd tools/packages/simulation-wasm && bash build.sh`

## Scene Integration

Scenes reference VFX presets via `vfx_instances`:

```json
{
  "vfx_instances": [
    {
      "vfx_file": "assets/vfx/lightning_strike.vfx.json",
      "position": [32, 5, 20],
      "trigger": "auto",
      "loop": false
    }
  ]
}
```

## Architecture

```
tools/apps/vfx-editor/
├── src/
│   ├── App.tsx                    — Layout, MenuBar, VfxTree, Timeline
│   ├── store/
│   │   ├── types.ts               — VfxPreset, VfxLayer, VfxProject
│   │   └── useVfxStore.ts         — Zustand (presets, layers, playback, project)
│   ├── panels/
│   │   └── LayerProperties.tsx    — Full type-specific editors (578 lines)
│   ├── viewport/
│   │   ├── Preview.tsx            — R3F Canvas, PLY point cloud, gizmos
│   │   └── ParticleSystem.tsx     — WASM-powered particle rendering
│   ├── components/
│   │   ├── NumberInput.tsx         — Drag-to-scrub number input
│   │   └── Vec3Input.tsx           — 3-axis vector input
│   ├── data/
│   │   └── emitterPresets.ts       — 11 particle presets
│   ├── styles/
│   │   └── panel.ts                — Shared panel styles
│   └── lib/
│       ├── vfxExport.ts            — Serialize preset to JSON
│       ├── vfxImport.ts            — Parse JSON to preset
│       ├── plyLoader.ts            — Binary PLY parser
│       └── projectIO.ts            — Project directory save/load
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

Related:
- `schemas/vfx.schema.json` — VFX preset format
- `tools/packages/simulation-wasm/` — C++ simulation compiled to WASM
- `docs/simulation-wasm.md` — WASM module documentation
