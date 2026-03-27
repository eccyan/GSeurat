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
| + Emitter / + Anim / + Light | Add layer to timeline |
| Click layer bar | Select for editing |
| ▶ Play / ■ Pause | Preview playback |
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
│   ├── App.tsx              — Main layout
│   ├── store/
│   │   ├── types.ts         — VfxPreset, VfxLayer types
│   │   └── useVfxStore.ts   — Zustand state management
│   ├── panels/              — (future) Extracted panel components
│   ├── timeline/            — (future) Timeline sub-components
│   ├── viewport/            — (future) 3D preview
│   └── lib/                 — (future) Export, PLY loader
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

Schema: `schemas/vfx.schema.json`
