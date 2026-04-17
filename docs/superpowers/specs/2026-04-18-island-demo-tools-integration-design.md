# Island Demo Tools Integration Design

**Date:** 2026-04-18
**Goal:** Create a showcase `tools_data/` environment for the island demo that demonstrates the full creative pipeline (Bricklayer + Echidna + Melies) by reverse-converting existing assets.

## Context

The island demo has rich runtime assets (65 game objects, PLY models, VFX presets, audio) but no corresponding tool project files. Users opening the creative tools see empty projects. This integration populates `tools_data/` so users see a realistic development setup.

## Output Structure

```
examples/island_demo/tools_data/
├── bricklayer/
│   └── scene.bricklayer              # Full island demo scene (BricklayerFile v2)
├── echidna_saves/
│   ├── {character}.echidna           # Characters with bone data (v5)
│   └── {prop}.echidna                # Props as geometry-only (v5)
└── melies_projects/
    └── {effect}.json                 # VFX presets (VfxProject v3)
```

### Echidna Files

- **Characters** (~5): knight, slime, snes_hero, untitled, warm_robot — all have `bone_index` in PLY, so skeleton structure is recovered. `kind: 'character'`.
- **Props** (~40): island_tree_*, island_rock_*, island_fountain, island_house, glow_mushrooms, etc. No bone data. `kind: 'object'`.
- Animation poses/keyframes are NOT recoverable from PLY — only geometry + bones.
- Companion `manifest.json` files (characters) are read to enrich part names where available.

### Melies Projects

All `.vfx.json` files under `assets/vfx/` converted via `parseVfx()`:
- torch, chimney_smoke, crystal_burst, fountain_spray, spline_dragon_flame, spline_smoke_trail, vfx1, and any others present.
- ~98% fidelity — only editor UI state and element IDs are regenerated.

### Bricklayer Project

**Faithfully reproduced from `seurat_island.json`:**
- 65 game objects with all components (ProximityTrigger, PortalTarget, VfxTrigger, AnimationTrigger, NpcWalker, BoneAnimated, LightToggle, EmitterToggle, DiscoveryZone)
- 2 static lights (IDs assigned as `light_0`, `light_1`)
- 4 particle emitters → `gsParticleEmitters` (with generated IDs and metadata)
- Collision grid data (solid, elevation arrays)
- Player spawn at [187.0, 1.9663, 197.0] facing down
- Gaussian splat config (seurat_island.ply, camera, render settings)
- Audio preload (field_theme.music.json)

**Enhanced showcase additions:**
- `weather` — light rain preset
- `dayNight` — cycle with dawn/dusk color shifts
- `backgroundLayers` — parallax sky layers from existing textures
- `cameraVolumes` — zones around fountain, dungeon portal, forest edge
- `vfxInstances` — torch at torch positions, fountain_spray at fountain, crystal_burst near crystals, chimney_smoke at house
- `torchEmitter`, `footstepEmitter`, `npcAuraEmitter` — reasonable defaults
- `asset_registry` — populated by scanning all `assets/` subdirectories

## Conversion Script

**Location:** `tools/scripts/convert-island-demo.ts`
**Invocation:** `npx tsx tools/scripts/convert-island-demo.ts`

### Phase 1: Echidna

For each PLY in `assets/characters/` and `assets/props/`:
1. Read binary PLY file (skip invalid/empty files — e.g., `test/test.ply` is not a real PLY)
2. Call `parsePlyToVoxels(buffer)` from `tools/apps/echidna/src/lib/plyImport.ts`
3. Read companion `manifest.json` if present (characters) to get bone/part names
4. Wrap in EchidnaFile v5: `{ version: 5, id, kind, characterName, gridWidth, gridDepth, voxels, parts, poses: {}, animations: {}, tags: [], color_palettes: [] }`
5. Write to `tools_data/echidna_saves/{name}.echidna`

### Phase 2: Melies

For each `.vfx.json` in `assets/vfx/`:
1. Read JSON file
2. Call `parseVfx(json)` from `tools/apps/melies/src/lib/vfxImport.ts`
3. Wrap in VfxProject v3: `{ version: 3, presets: [result] }`
4. Write to `tools_data/melies_projects/{name}.json`

### Phase 3: Bricklayer

1. Read `assets/scenes/seurat_island.json`
2. Map engine fields → Bricklayer fields:
   - `ambient_color` → `ambientColor`
   - `lights[]` → `staticLights[]` (add `id: "light_{i}"`)
   - `game_objects` → `gameObjects`
   - `collision` → `collisionGridData`
   - `particle_emitters` → `gsParticleEmitters` (add id, muted, preset metadata)
   - `torch_audio_positions` → preserve as reference for VFX instance placement
3. Scan `assets/` to build `asset_registry`:
   - `characters/`: each directory with a `.ply`
   - `maps/`: each `.ply` file
   - `objects/`: each `.ply` in `props/`
   - `vfx/`: each `.vfx.json`
   - `audio/`: each `.music.json` or `.wav`
   - `textures/`: each image file
4. Add showcase defaults (weather, dayNight, backgroundLayers, cameraVolumes, vfxInstances, emitter configs)
5. Write to `tools_data/bricklayer/scene.bricklayer`

### Dependencies

The script imports source files directly from workspace packages:
- `tools/apps/echidna/src/lib/plyImport.ts` → `parsePlyToVoxels()`
- `tools/apps/melies/src/lib/vfxImport.ts` → `parseVfx()`

Run via `npx tsx` — no build step required.

### Idempotency

Running the script twice produces identical output. Overwrites existing files in `tools_data/`.

## Field Mapping Reference

### Engine → Bricklayer (snake_case → camelCase)

| Engine (seurat_island.json) | Bricklayer (scene.bricklayer) | Transform |
|---|---|---|
| version | version | direct (2) |
| ambient_color | ambientColor | rename |
| player | player | direct |
| gaussian_splat | gaussianSplat | direct (except ground_color, sky_color dropped) |
| lights[] | staticLights[] | add id field |
| game_objects[] | gameObjects[] | direct |
| collision | collisionGridData | rename |
| particle_emitters[] | gsParticleEmitters[] | wrap with id, muted, preset |
| audio.preload_track_groups | *(asset_registry)* | moved to registry |
| torch_audio_positions | *(vfxInstances reference)* | used for VFX placement |

### Data Not Recoverable

| Data | Format | Reason |
|---|---|---|
| Animation poses | Echidna (.echidna) | PLY contains no pose/keyframe data |
| Animation clips | Echidna (.echidna) | PLY is geometry-only |
| Joint positions | Echidna (.echidna) | Recomputed as part centroids |
| Color palettes | Echidna (.echidna) | Only raw voxel RGBA survives |
| Element IDs | Melies (project) | Regenerated on import |
| ground_color, sky_color | Bricklayer | Render-only, no Bricklayer field |
