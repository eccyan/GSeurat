# Island Demo Tools Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a TypeScript conversion script that populates `examples/island_demo/tools_data/` with Bricklayer, Echidna, and Melies project files by reverse-converting existing runtime assets.

**Architecture:** A single `tools/scripts/convert-island-demo.ts` script with three sequential phases — Echidna (PLY→.echidna), Melies (.vfx.json→project), Bricklayer (scene JSON→.bricklayer). Reuses existing `parsePlyToVoxels()` and `parseVfx()` importers from the workspace packages.

**Tech Stack:** TypeScript, tsx (runtime), Node.js fs/path APIs, existing Echidna/Melies importer libraries.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `tools/scripts/convert-island-demo.ts` | Main conversion script — orchestrates all three phases |
| `examples/island_demo/tools_data/bricklayer/scene.bricklayer` | Output: Bricklayer project (overwrites existing empty template) |
| `examples/island_demo/tools_data/echidna_saves/*.echidna` | Output: Echidna voxel model files |
| `examples/island_demo/tools_data/melies_projects/*.json` | Output: Melies VFX project files |

---

## Task 1: Echidna PLY Conversion Phase

**Files:**
- Create: `tools/scripts/convert-island-demo.ts` (initial file with Echidna phase)
- Read: `tools/apps/echidna/src/lib/plyImport.ts` (parsePlyToVoxels)
- Read: `tools/apps/echidna/src/store/types.ts` (EchidnaFile, VoxelKey, Voxel, BodyPart)
- Output: `examples/island_demo/tools_data/echidna_saves/*.echidna`

- [ ] **Step 1: Create the script with Echidna conversion logic**

Create `tools/scripts/convert-island-demo.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * convert-island-demo.ts
 *
 * Populates examples/island_demo/tools_data/ with Bricklayer, Echidna,
 * and Melies project files by reverse-converting existing runtime assets.
 *
 * Usage: npx tsx tools/scripts/convert-island-demo.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parsePlyToVoxels } from '../apps/echidna/src/lib/plyImport.js';
import type { EchidnaFile, EchidnaAssetKind, VoxelKey, Voxel, BodyPart } from '../apps/echidna/src/store/types.js';
import { ECHIDNA_FILE_VERSION } from '../apps/echidna/src/store/types.js';

const ISLAND_DEMO = path.resolve(import.meta.dirname, '../../examples/island_demo');
const ASSETS = path.join(ISLAND_DEMO, 'assets');
const TOOLS_DATA = path.join(ISLAND_DEMO, 'tools_data');

// ── Helpers ──

function voxelMapToArray(
  voxels: Map<VoxelKey, Voxel>,
): { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[] {
  return Array.from(voxels.entries()).map(([key, voxel]) => {
    const [x, y, z] = key.split(',').map(Number);
    const [r, g, b, a] = voxel.color;
    return { x, y, z, r, g, b, a };
  });
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function isValidPly(buf: Buffer): boolean {
  // PLY files start with "ply\n" or "ply\r\n"
  const header = buf.subarray(0, 4).toString('ascii');
  return header.startsWith('ply');
}

// ── Phase 1: Echidna (PLY → .echidna) ──

interface CharacterManifest {
  name: string;
  bones?: { id: string; parent: string | null; joint: [number, number, number] }[];
  poses?: Record<string, Record<string, [number, number, number]>>;
  animations?: Record<string, unknown>;
}

function convertPlyToEchidna(
  plyPath: string,
  id: string,
  kind: EchidnaAssetKind,
  manifest?: CharacterManifest,
): EchidnaFile {
  const buf = fs.readFileSync(plyPath);
  if (!isValidPly(buf)) {
    throw new Error(`Not a valid PLY file: ${plyPath}`);
  }

  const arrayBuf = bufferToArrayBuffer(buf);
  const result = parsePlyToVoxels(arrayBuf);

  // Enrich part names from manifest if available
  let parts = result.parts;
  if (manifest?.bones && parts.length > 0) {
    parts = parts.map((part, i) => {
      const bone = manifest.bones![i];
      if (bone) {
        return {
          ...part,
          id: bone.id,
          name: bone.id,
          parent: bone.parent,
          joint: bone.joint,
        };
      }
      return part;
    });
  }

  return {
    version: ECHIDNA_FILE_VERSION,
    id,
    kind,
    characterName: id,
    gridWidth: result.gridSize,
    gridDepth: result.gridSize,
    voxels: voxelMapToArray(result.voxels),
    parts,
    poses: {},
    animations: {},
    tags: [],
    color_palettes: [],
  };
}

function runEchidnaPhase(): void {
  const outDir = path.join(TOOLS_DATA, 'echidna_saves');
  fs.mkdirSync(outDir, { recursive: true });

  let converted = 0;
  let skipped = 0;

  // Characters
  const charsDir = path.join(ASSETS, 'characters');
  if (fs.existsSync(charsDir)) {
    for (const dir of fs.readdirSync(charsDir)) {
      const charDir = path.join(charsDir, dir);
      if (!fs.statSync(charDir).isDirectory()) continue;

      // Find PLY file
      const plyFile = fs.readdirSync(charDir).find((f) => f.endsWith('.ply'));
      if (!plyFile) continue;

      const plyPath = path.join(charDir, plyFile);
      const buf = fs.readFileSync(plyPath);
      if (!isValidPly(buf)) {
        console.log(`  skip (invalid PLY): ${dir}`);
        skipped++;
        continue;
      }

      // Load manifest if present
      let manifest: CharacterManifest | undefined;
      const manifestFile = fs.readdirSync(charDir).find((f) => f.endsWith('.manifest.json'));
      if (manifestFile) {
        manifest = JSON.parse(fs.readFileSync(path.join(charDir, manifestFile), 'utf-8'));
      }

      try {
        const echidna = convertPlyToEchidna(plyPath, dir, 'character', manifest);
        const outPath = path.join(outDir, `${dir}.echidna`);
        fs.writeFileSync(outPath, JSON.stringify(echidna, null, 2));
        console.log(`  character: ${dir} (${echidna.voxels.length} voxels, ${echidna.parts.length} bones)`);
        converted++;
      } catch (e) {
        console.log(`  skip (error): ${dir} — ${(e as Error).message}`);
        skipped++;
      }
    }
  }

  // Props
  const propsDir = path.join(ASSETS, 'props');
  if (fs.existsSync(propsDir)) {
    for (const file of fs.readdirSync(propsDir)) {
      if (!file.endsWith('.ply')) continue;

      const plyPath = path.join(propsDir, file);
      const buf = fs.readFileSync(plyPath);
      if (!isValidPly(buf)) {
        console.log(`  skip (invalid PLY): ${file}`);
        skipped++;
        continue;
      }

      const id = file.replace('.ply', '');
      // Props with bone_index get 'character' kind, otherwise 'object'
      const header = buf.subarray(0, 2000).toString('ascii');
      const hasBones = header.includes('bone_index');
      const kind: EchidnaAssetKind = hasBones ? 'character' : 'object';

      try {
        const echidna = convertPlyToEchidna(plyPath, id, kind);
        const outPath = path.join(outDir, `${id}.echidna`);
        fs.writeFileSync(outPath, JSON.stringify(echidna, null, 2));
        console.log(`  prop: ${id} (${echidna.voxels.length} voxels${hasBones ? ', boned' : ''})`);
        converted++;
      } catch (e) {
        console.log(`  skip (error): ${id} — ${(e as Error).message}`);
        skipped++;
      }
    }
  }

  console.log(`  total: ${converted} converted, ${skipped} skipped`);
}

// ── Main ──

console.log('=== Island Demo Tools Integration ===\n');
console.log('Phase 1: Echidna (PLY → .echidna)');
runEchidnaPhase();
```

- [ ] **Step 2: Run the script to test Echidna phase**

Run: `cd /Users/eccyan/dev/GSeurat && npx tsx tools/scripts/convert-island-demo.ts`
Expected: Console output showing converted characters and props, `.echidna` files created in `examples/island_demo/tools_data/echidna_saves/`.

- [ ] **Step 3: Verify output**

Run: `ls examples/island_demo/tools_data/echidna_saves/ | head -10`
Expected: `.echidna` files for knight, slime, snes_hero, warm_robot, untitled, plus prop files.

Spot-check one file:
Run: `python3 -c "import json; d=json.load(open('examples/island_demo/tools_data/echidna_saves/knight.echidna')); print('version:', d['version'], 'kind:', d['kind'], 'voxels:', len(d['voxels']), 'parts:', len(d['parts']))"`
Expected: `version: 5 kind: character voxels: ~9888 parts: 6`

- [ ] **Step 4: Fix any issues found in Step 2-3**

Address any import resolution, Buffer/ArrayBuffer, or PLY parsing errors.

- [ ] **Step 5: Commit**

```bash
git add tools/scripts/convert-island-demo.ts examples/island_demo/tools_data/echidna_saves/
git commit -m "feat: add island demo conversion script — Echidna phase

Converts all PLY models (characters + props) to .echidna project files
using parsePlyToVoxels(). Character manifests enrich bone naming."
```

---

## Task 2: Melies VFX Conversion Phase

**Files:**
- Modify: `tools/scripts/convert-island-demo.ts` (add Melies phase)
- Read: `tools/apps/melies/src/lib/vfxImport.ts` (parseVfx)
- Read: `tools/apps/melies/src/store/types.ts` (VfxProject, VFX_PROJECT_VERSION)
- Output: `examples/island_demo/tools_data/melies_projects/*.json`

- [ ] **Step 1: Add Melies phase to the script**

Add these imports at the top of `convert-island-demo.ts`:

```typescript
import { parseVfx } from '../apps/melies/src/lib/vfxImport.js';
import { VFX_PROJECT_VERSION } from '../apps/melies/src/store/types.js';
import type { VfxProject } from '../apps/melies/src/store/types.js';
```

Add this function before the `// ── Main ──` section:

```typescript
// ── Phase 2: Melies (.vfx.json → project) ──

function runMeliesPhase(): void {
  const outDir = path.join(TOOLS_DATA, 'melies_projects');
  fs.mkdirSync(outDir, { recursive: true });

  const vfxDir = path.join(ASSETS, 'vfx');
  if (!fs.existsSync(vfxDir)) {
    console.log('  no vfx directory found');
    return;
  }

  let converted = 0;

  for (const file of fs.readdirSync(vfxDir)) {
    if (!file.endsWith('.vfx.json')) continue;

    const json = fs.readFileSync(path.join(vfxDir, file), 'utf-8');
    const preset = parseVfx(json);
    const slug = file.replace('.vfx.json', '');

    const project: VfxProject = {
      version: VFX_PROJECT_VERSION,
      presets: [preset],
    };

    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(project, null, 2));
    console.log(`  vfx: ${slug} (${preset.elements.length} elements)`);
    converted++;
  }

  console.log(`  total: ${converted} converted`);
}
```

Update the Main section:

```typescript
// ── Main ──

console.log('=== Island Demo Tools Integration ===\n');

console.log('Phase 1: Echidna (PLY → .echidna)');
runEchidnaPhase();

console.log('\nPhase 2: Melies (.vfx.json → project)');
runMeliesPhase();
```

- [ ] **Step 2: Run the script**

Run: `cd /Users/eccyan/dev/GSeurat && npx tsx tools/scripts/convert-island-demo.ts`
Expected: Echidna phase runs as before, then Melies phase converts ~7 VFX presets.

- [ ] **Step 3: Verify output**

Run: `ls examples/island_demo/tools_data/melies_projects/`
Expected: `torch.json`, `chimney_smoke.json`, `crystal_burst.json`, `fountain_spray.json`, `spline_dragon_flame.json`, `spline_smoke_trail.json`, `vfx1.json`

Spot-check:
Run: `python3 -c "import json; d=json.load(open('examples/island_demo/tools_data/melies_projects/torch.json')); print('version:', d['version'], 'presets:', len(d['presets']), 'elements:', len(d['presets'][0]['elements']))"`
Expected: `version: 3 presets: 1 elements: 5` (torch has object + emitter + 2 animations + light)

- [ ] **Step 4: Fix any issues found in Step 2-3**

- [ ] **Step 5: Commit**

```bash
git add tools/scripts/convert-island-demo.ts examples/island_demo/tools_data/melies_projects/
git commit -m "feat: add Melies phase to island demo conversion script

Converts all .vfx.json presets to Melies project files using parseVfx()."
```

---

## Task 3: Bricklayer Scene Conversion Phase — Core Data

**Files:**
- Modify: `tools/scripts/convert-island-demo.ts` (add Bricklayer phase)
- Read: `examples/island_demo/assets/scenes/seurat_island.json` (source scene)
- Read: `tools/apps/bricklayer/src/store/types.ts` (BricklayerFile types)
- Read: `tools/packages/project-root/src/registry.ts` (AssetRegistry types)
- Output: `examples/island_demo/tools_data/bricklayer/scene.bricklayer`

- [ ] **Step 1: Add Bricklayer phase with engine→Bricklayer field mapping**

Add this function before the `// ── Main ──` section:

```typescript
// ── Phase 3: Bricklayer (seurat_island.json → scene.bricklayer) ──

interface EngineScene {
  version: number;
  ambient_color: [number, number, number, number];
  lights: { position: [number, number, number]; color: [number, number, number]; radius: number; intensity: number; direction?: [number, number, number]; cone_angle?: number }[];
  game_objects: {
    id: string; name: string; position: [number, number, number];
    rotation?: [number, number, number] | null; scale?: number;
    ply_file?: string | null; components?: Record<string, unknown>;
    pbd?: Record<string, unknown> | null;
  }[];
  player: { position: [number, number, number]; facing: string };
  gaussian_splat: {
    ply_file: string;
    camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
    render_width: number; render_height: number; scale_multiplier: number;
    ground_color?: [number, number, number]; sky_color?: [number, number, number];
  };
  collision?: {
    width: number; height: number; cell_size: number;
    solid: boolean[]; elevation: number[]; nav_zone?: number[];
  };
  particle_emitters?: { preset: string; position: [number, number, number]; spawn_rate?: number }[];
  torch_audio_positions?: [number, number, number][];
  audio?: { preload_track_groups: string[] };
}

function buildAssetRegistry(): Record<string, unknown> {
  const registry: Record<string, unknown> = {
    version: 1,
    characters: {} as Record<string, unknown>,
    vfx: {} as Record<string, unknown>,
    textures: {} as Record<string, unknown>,
    audio: {} as Record<string, unknown>,
    maps: {} as Record<string, unknown>,
    objects: {} as Record<string, unknown>,
  };

  // Characters
  const charsDir = path.join(ASSETS, 'characters');
  if (fs.existsSync(charsDir)) {
    const chars = registry.characters as Record<string, unknown>;
    for (const dir of fs.readdirSync(charsDir)) {
      const charDir = path.join(charsDir, dir);
      if (!fs.statSync(charDir).isDirectory()) continue;
      const plyFile = fs.readdirSync(charDir).find((f) => f.endsWith('.ply'));
      const manifestFile = fs.readdirSync(charDir).find((f) => f.endsWith('.manifest.json'));
      if (plyFile) {
        chars[dir] = {
          id: dir,
          ply: `assets/characters/${dir}/${plyFile}`,
          manifest: manifestFile ? `assets/characters/${dir}/${manifestFile}` : '',
        };
      }
    }
  }

  // VFX
  const vfxDir = path.join(ASSETS, 'vfx');
  if (fs.existsSync(vfxDir)) {
    const vfx = registry.vfx as Record<string, unknown>;
    for (const file of fs.readdirSync(vfxDir)) {
      if (!file.endsWith('.vfx.json')) continue;
      const id = file.replace('.vfx.json', '');
      vfx[id] = { id, file: `assets/vfx/${file}` };
    }
  }

  // Textures
  const texDir = path.join(ASSETS, 'textures');
  if (fs.existsSync(texDir)) {
    const tex = registry.textures as Record<string, unknown>;
    for (const file of fs.readdirSync(texDir)) {
      if (!/\.(png|jpg|jpeg|webp)$/i.test(file)) continue;
      const id = file.replace(/\.[^.]+$/, '');
      tex[id] = { id, file: `assets/textures/${file}` };
    }
  }

  // Audio
  const audioDir = path.join(ASSETS, 'audio');
  if (fs.existsSync(audioDir)) {
    const audio = registry.audio as Record<string, unknown>;
    for (const file of fs.readdirSync(audioDir)) {
      if (file.endsWith('.music.json')) {
        const id = file.replace('.music.json', '');
        audio[id] = { id, file: `assets/audio/${file}` };
      }
    }
  }

  // Maps
  const mapsDir = path.join(ASSETS, 'maps');
  if (fs.existsSync(mapsDir)) {
    const maps = registry.maps as Record<string, unknown>;
    for (const file of fs.readdirSync(mapsDir)) {
      if (!file.endsWith('.ply')) continue;
      const id = file.replace('.ply', '');
      maps[id] = { id, file: `assets/maps/${file}` };
    }
  }

  // Objects (props)
  const propsDir = path.join(ASSETS, 'props');
  if (fs.existsSync(propsDir)) {
    const objects = registry.objects as Record<string, unknown>;
    for (const file of fs.readdirSync(propsDir)) {
      if (!file.endsWith('.ply')) continue;
      const id = file.replace('.ply', '');
      objects[id] = { id, file: `assets/props/${file}` };
    }
  }

  return registry;
}

function defaultEmitter() {
  return {
    spawn_rate: 10,
    particle_lifetime_min: 0.5,
    particle_lifetime_max: 1.5,
    velocity_min: [-0.5, -0.5],
    velocity_max: [0.5, 0.5],
    acceleration: [0, 0],
    size_min: 1,
    size_max: 2,
    size_end_scale: 0.5,
    color_start: [1, 1, 1, 1],
    color_end: [1, 1, 1, 0],
    tile: '',
    z: 0,
    spawn_offset_min: [0, 0],
    spawn_offset_max: [0, 0],
  };
}

function runBricklayerPhase(): void {
  const outDir = path.join(TOOLS_DATA, 'bricklayer');
  fs.mkdirSync(outDir, { recursive: true });

  // Read engine scene
  const scenePath = path.join(ASSETS, 'scenes', 'seurat_island.json');
  const engine: EngineScene = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));

  // Map lights: add IDs
  const staticLights = engine.lights.map((light, i) => ({
    id: `light_${i}`,
    type: light.direction ? 'spot' as const : 'point' as const,
    position: light.position,
    color: light.color,
    radius: light.radius,
    intensity: light.intensity,
    ...(light.direction ? { direction: light.direction } : {}),
    ...(light.cone_angle ? { cone_angle: light.cone_angle } : {}),
  }));

  // Map game objects: direct passthrough
  const gameObjects = engine.game_objects.map((go) => ({
    id: go.id,
    name: go.name,
    position: go.position,
    rotation: go.rotation ?? null,
    scale: go.scale ?? 1,
    ply_file: go.ply_file ?? null,
    components: go.components ?? {},
    pbd: go.pbd ?? null,
  }));

  // Map particle emitters: wrap with metadata
  const gsParticleEmitters = (engine.particle_emitters ?? []).map((pe, i) => ({
    id: `emitter_${i}`,
    muted: false,
    preset: pe.preset,
    position: pe.position,
    spawn_rate: pe.spawn_rate ?? 20,
    lifetime_min: 0.5,
    lifetime_max: 2.0,
    velocity_min: [-0.5, 1.0, -0.5] as [number, number, number],
    velocity_max: [0.5, 3.0, 0.5] as [number, number, number],
    acceleration: [0, 0.3, 0] as [number, number, number],
    color_start: [1.0, 0.8, 0.3, 1.0] as [number, number, number, number],
    color_end: [0.3, 0.3, 0.3, 0.0] as [number, number, number, number],
    scale_min: [0.3, 0.3, 0.3] as [number, number, number],
    scale_max: [0.8, 0.8, 0.8] as [number, number, number],
    scale_end_factor: 2,
    opacity_start: 0.5,
    opacity_end: 0,
    emission: 0,
    spawn_region: {
      shape: 'box' as const,
      center: [0, 0, 0] as [number, number, number],
      half_extents: [0.5, 0.5, 0.5] as [number, number, number],
    },
  }));

  // Map collision
  const collisionGridData = engine.collision
    ? {
        width: engine.collision.width,
        height: engine.collision.height,
        cell_size: engine.collision.cell_size,
        solid: engine.collision.solid,
        elevation: engine.collision.elevation,
        nav_zone: engine.collision.nav_zone ?? [],
      }
    : undefined;

  // Load VFX presets for vfxInstances
  const vfxDir = path.join(ASSETS, 'vfx');
  function loadVfxPreset(filename: string) {
    const vfxPath = path.join(vfxDir, filename);
    if (!fs.existsSync(vfxPath)) return null;
    return JSON.parse(fs.readFileSync(vfxPath, 'utf-8'));
  }

  // VFX instances — place at logical locations
  const vfxInstances = [
    // Torch VFX at torch positions
    ...(engine.torch_audio_positions ?? []).map((pos, i) => ({
      id: `vfx_torch_${i}`,
      muted: false,
      name: `Torch ${i + 1}`,
      vfx_file: 'assets/vfx/torch.vfx.json',
      vfx_preset: loadVfxPreset('torch.vfx.json') ?? { name: 'torch', elements: [] },
      position: pos,
      rotation_y: 0,
      radius: 5,
      trigger: 'auto' as const,
      loop: true,
    })),
    // Fountain spray at fountain position [178, 3.2, 185]
    {
      id: 'vfx_fountain',
      muted: false,
      name: 'Fountain Spray',
      vfx_file: 'assets/vfx/fountain_spray.vfx.json',
      vfx_preset: loadVfxPreset('fountain_spray.vfx.json') ?? { name: 'fountain_spray', elements: [] },
      position: [178, 3.2, 185] as [number, number, number],
      rotation_y: 0,
      radius: 8,
      trigger: 'auto' as const,
      loop: true,
    },
    // Crystal burst near crystal_4 [195, 2.0418, 120]
    {
      id: 'vfx_crystal',
      muted: false,
      name: 'Crystal Burst',
      vfx_file: 'assets/vfx/crystal_burst.vfx.json',
      vfx_preset: loadVfxPreset('crystal_burst.vfx.json') ?? { name: 'crystal_burst', elements: [] },
      position: [195, 2.0418, 120] as [number, number, number],
      rotation_y: 0,
      radius: 10,
      trigger: 'auto' as const,
      loop: true,
    },
    // Chimney smoke at house [192, 4.5658, 175]
    {
      id: 'vfx_chimney',
      muted: false,
      name: 'Chimney Smoke',
      vfx_file: 'assets/vfx/chimney_smoke.vfx.json',
      vfx_preset: loadVfxPreset('chimney_smoke.vfx.json') ?? { name: 'chimney_smoke', elements: [] },
      position: [192, 4.5658, 175] as [number, number, number],
      rotation_y: 0,
      radius: 12,
      trigger: 'auto' as const,
      loop: true,
    },
  ];

  // Camera volumes — showcase zones
  const cameraVolumes = [
    {
      id: 'cam_fountain_area',
      name: 'Fountain Plaza',
      shape: {
        type: 'aabb' as const,
        center: [178, 5, 185] as [number, number, number],
        half_extents: [20, 10, 20] as [number, number, number],
      },
      params: {
        mode: 'free_look' as const,
        priority: 1,
        blend_time: 1.5,
        allow_user_orbit: true,
        pitch_min: -45,
        pitch_max: 5,
        yaw_min: -180,
        yaw_max: 180,
        fov: 40,
        orbit_distance: 12,
        offset: [0, 6, -12] as [number, number, number],
      },
    },
    {
      id: 'cam_dungeon_entrance',
      name: 'Dungeon Entrance',
      shape: {
        type: 'sphere' as const,
        center: [203, 5, 175] as [number, number, number],
        radius: 15,
      },
      params: {
        mode: 'free_look' as const,
        priority: 2,
        blend_time: 2.0,
        allow_user_orbit: true,
        pitch_min: -30,
        pitch_max: 0,
        yaw_min: -90,
        yaw_max: 90,
        fov: 35,
        orbit_distance: 8,
        offset: [0, 4, -8] as [number, number, number],
      },
    },
    {
      id: 'cam_forest_edge',
      name: 'Forest Edge',
      shape: {
        type: 'aabb' as const,
        center: [140, 5, 200] as [number, number, number],
        half_extents: [30, 10, 30] as [number, number, number],
      },
      params: {
        mode: 'free_look' as const,
        priority: 0,
        blend_time: 2.5,
        allow_user_orbit: true,
        pitch_min: -60,
        pitch_max: 10,
        yaw_min: -180,
        yaw_max: 180,
        fov: 50,
        orbit_distance: 15,
        offset: [0, 8, -15] as [number, number, number],
      },
    },
  ];

  // Weather — light rain
  const weather = {
    enabled: true,
    type: 'rain',
    emitter: {
      ...defaultEmitter(),
      spawn_rate: 40,
      particle_lifetime_min: 0.8,
      particle_lifetime_max: 1.2,
      velocity_min: [-0.2, -8],
      velocity_max: [0.2, -6],
      size_min: 0.5,
      size_max: 1,
      color_start: [0.7, 0.75, 0.85, 0.4],
      color_end: [0.7, 0.75, 0.85, 0],
    },
    ambient_override: [0.2, 0.22, 0.3, 1] as [number, number, number, number],
    fog_density: 0.02,
    fog_color: [0.5, 0.55, 0.6] as [number, number, number],
    transition_speed: 0.5,
  };

  // Day/night cycle
  const dayNight = {
    enabled: true,
    cycle_speed: 0.5,
    initial_time: 0.3,
    keyframes: [
      { time: 0, ambient: [0.04, 0.04, 0.12, 1] as [number, number, number, number], torch_intensity: 1.0 },
      { time: 0.2, ambient: [0.6, 0.45, 0.35, 1] as [number, number, number, number], torch_intensity: 0.3 },
      { time: 0.35, ambient: [0.85, 0.8, 0.7, 1] as [number, number, number, number], torch_intensity: 0 },
      { time: 0.5, ambient: [1, 0.98, 0.92, 1] as [number, number, number, number], torch_intensity: 0 },
      { time: 0.7, ambient: [0.75, 0.5, 0.35, 1] as [number, number, number, number], torch_intensity: 0.2 },
      { time: 0.85, ambient: [0.3, 0.2, 0.25, 1] as [number, number, number, number], torch_intensity: 0.8 },
    ],
  };

  // Background layers — parallax sky
  const backgroundLayers = [
    {
      id: 'bg_sky',
      texture: 'assets/textures/bg_sky.png',
      z: -100,
      parallax_factor: 0.02,
      quad_width: 800,
      quad_height: 400,
      uv_repeat_x: 1,
      uv_repeat_y: 1,
      tint: [1, 1, 1, 1] as [number, number, number, number],
      wall: false,
      wall_y_offset: 0,
    },
    {
      id: 'bg_mountains',
      texture: 'assets/textures/bg_mountains.png',
      z: -80,
      parallax_factor: 0.05,
      quad_width: 600,
      quad_height: 300,
      uv_repeat_x: 1,
      uv_repeat_y: 1,
      tint: [0.9, 0.9, 1.0, 0.8] as [number, number, number, number],
      wall: false,
      wall_y_offset: 0,
    },
    {
      id: 'bg_trees',
      texture: 'assets/textures/bg_trees.png',
      z: -60,
      parallax_factor: 0.1,
      quad_width: 500,
      quad_height: 250,
      uv_repeat_x: 2,
      uv_repeat_y: 1,
      tint: [0.8, 0.85, 0.75, 0.9] as [number, number, number, number],
      wall: false,
      wall_y_offset: 0,
    },
  ];

  // Build the BricklayerFile
  const bricklayerFile = {
    version: 2,
    asset_registry: buildAssetRegistry(),
    gridWidth: 128,
    gridDepth: 96,
    voxels: [],
    collision: [],
    collisionGridData: collisionGridData ?? undefined,
    nav_zone_names: [],
    color_palettes: [],
    scene: {
      ambientColor: engine.ambient_color,
      godRaysIntensity: 0.3,
      staticLights,
      gameObjects,
      player: {
        position: engine.player.position,
        tint: [1, 1, 1, 1] as [number, number, number, number],
        facing: engine.player.facing,
        character_id: '',
      },
      backgroundLayers,
      torchEmitter: {
        ...defaultEmitter(),
        spawn_rate: 15,
        particle_lifetime_min: 0.3,
        particle_lifetime_max: 0.8,
        velocity_min: [-0.3, -1],
        velocity_max: [0.3, -0.2],
        size_min: 1.5,
        size_max: 3,
        size_end_scale: 0.3,
        color_start: [1, 0.8, 0.3, 0.8],
        color_end: [1, 0.3, 0.1, 0],
      },
      torchPositions: (engine.torch_audio_positions ?? []).map(
        (p) => [p[0], p[2]] as [number, number],
      ),
      footstepEmitter: {
        ...defaultEmitter(),
        spawn_rate: 5,
        particle_lifetime_min: 0.2,
        particle_lifetime_max: 0.5,
        size_min: 0.5,
        size_max: 1,
        color_start: [0.6, 0.55, 0.45, 0.5],
        color_end: [0.6, 0.55, 0.45, 0],
      },
      npcAuraEmitter: {
        ...defaultEmitter(),
        spawn_rate: 8,
        particle_lifetime_min: 1,
        particle_lifetime_max: 2,
        size_min: 0.5,
        size_max: 1.5,
        color_start: [0.5, 0.7, 1, 0.4],
        color_end: [0.5, 0.7, 1, 0],
      },
      weather,
      dayNight,
      gaussianSplat: {
        camera: engine.gaussian_splat.camera,
        render_width: engine.gaussian_splat.render_width,
        render_height: engine.gaussian_splat.render_height,
        scale_multiplier: engine.gaussian_splat.scale_multiplier,
        background_image: '',
        parallax: {
          azimuth_range: 15,
          elevation_min: -5,
          elevation_max: 5,
          distance_range: 2,
          parallax_strength: 1,
        },
        morphPairPly: '',
        morphDuration: 1.5,
        morphDefaultBlend: 0.0,
        morphEasing: 'linear',
      },
      gsParticleEmitters,
      gsAnimations: [],
      vfxInstances,
      cameraVolumes,
      cameraTriggers: [],
      cameraRails: [],
      cameraDefaultParams: {
        mode: 'free_look',
        priority: 0,
        blend_time: 1.0,
        allow_user_orbit: true,
        pitch_min: -60,
        pitch_max: 10,
        yaw_min: -180,
        yaw_max: 180,
        fov: 45,
        orbit_distance: 10,
        offset: [0, 5, -10],
      },
      cameraShowDebugVolumes: false,
      audioZones: [
        {
          id: 'audio_field_music',
          name: 'Field Music Zone',
          bounds: {
            type: 'aabb' as const,
            min: [100, -10, 80] as [number, number, number],
            max: [280, 50, 280] as [number, number, number],
          },
          track_group_name: 'field_theme',
          on_enter: { action: 'play', xfade_ms: 2000, align_to_next_marker: false },
          on_exit: { action: 'stop', fade_ms: 3000 },
        },
      ],
    },
  };

  const outPath = path.join(outDir, 'scene.bricklayer');
  fs.writeFileSync(outPath, JSON.stringify(bricklayerFile, null, 2));

  const registrySummary = Object.entries(bricklayerFile.asset_registry)
    .filter(([k]) => k !== 'version')
    .map(([k, v]) => `${k}=${Object.keys(v as object).length}`)
    .join(', ');

  console.log(`  scene: ${gameObjects.length} gameObjects, ${staticLights.length} lights, ${gsParticleEmitters.length} emitters`);
  console.log(`  showcase: ${vfxInstances.length} vfxInstances, ${cameraVolumes.length} cameraVolumes, weather=${weather.enabled}, dayNight=${dayNight.enabled}`);
  console.log(`  registry: ${registrySummary}`);
}
```

Update the Main section:

```typescript
// ── Main ──

console.log('=== Island Demo Tools Integration ===\n');

console.log('Phase 1: Echidna (PLY → .echidna)');
runEchidnaPhase();

console.log('\nPhase 2: Melies (.vfx.json → project)');
runMeliesPhase();

console.log('\nPhase 3: Bricklayer (seurat_island.json → scene.bricklayer)');
runBricklayerPhase();

console.log('\n=== Done ===');
```

- [ ] **Step 2: Run the script**

Run: `cd /Users/eccyan/dev/GSeurat && npx tsx tools/scripts/convert-island-demo.ts`
Expected: All three phases complete. Bricklayer phase reports 65 gameObjects, 2 lights, 4 emitters, VFX instances, camera volumes, and populated asset registry.

- [ ] **Step 3: Verify the .bricklayer file**

Run:
```bash
python3 -c "
import json
d=json.load(open('examples/island_demo/tools_data/bricklayer/scene.bricklayer'))
s=d['scene']
r=d['asset_registry']
print('version:', d['version'])
print('gameObjects:', len(s.get('gameObjects',[])))
print('staticLights:', len(s.get('staticLights',[])))
print('gsParticleEmitters:', len(s.get('gsParticleEmitters',[])))
print('vfxInstances:', len(s.get('vfxInstances',[])))
print('cameraVolumes:', len(s.get('cameraVolumes',[])))
print('audioZones:', len(s.get('audioZones',[])))
print('backgroundLayers:', len(s.get('backgroundLayers',[])))
print('weather enabled:', s.get('weather',{}).get('enabled'))
print('dayNight enabled:', s.get('dayNight',{}).get('enabled'))
print('characters:', len(r.get('characters',{})))
print('objects:', len(r.get('objects',{})))
print('vfx:', len(r.get('vfx',{})))
print('maps:', len(r.get('maps',{})))
print('collisionGridData:', 'present' if d.get('collisionGridData') else 'missing')
"
```
Expected:
```
version: 2
gameObjects: 65
staticLights: 2
gsParticleEmitters: 4
vfxInstances: 7
cameraVolumes: 3
audioZones: 1
backgroundLayers: 3
weather enabled: True
dayNight enabled: True
characters: ~8
objects: ~33
vfx: ~7
maps: ~7
collisionGridData: present
```

- [ ] **Step 4: Fix any issues found in Step 2-3**

- [ ] **Step 5: Commit**

```bash
git add tools/scripts/convert-island-demo.ts examples/island_demo/tools_data/bricklayer/scene.bricklayer
git commit -m "feat: add Bricklayer phase to island demo conversion script

Maps seurat_island.json to BricklayerFile v2 with all 65 game objects,
lights, particle emitters, collision data, and enhanced showcase features
(weather, day/night cycle, camera volumes, VFX instances, background layers)."
```

---

## Task 4: Final Verification & Cleanup

**Files:**
- All output files in `examples/island_demo/tools_data/`

- [ ] **Step 1: Run the script from scratch (idempotency check)**

Run: `cd /Users/eccyan/dev/GSeurat && npx tsx tools/scripts/convert-island-demo.ts`
Expected: Same output as before with no errors.

- [ ] **Step 2: Verify Echidna file count**

Run: `ls examples/island_demo/tools_data/echidna_saves/*.echidna | wc -l`
Expected: ~37 files (5 characters + ~32 props, minus any skipped invalid PLYs)

- [ ] **Step 3: Verify Melies file count**

Run: `ls examples/island_demo/tools_data/melies_projects/*.json | wc -l`
Expected: 7 files

- [ ] **Step 4: Spot-check a character with bones**

Run:
```bash
python3 -c "
import json
d=json.load(open('examples/island_demo/tools_data/echidna_saves/knight.echidna'))
print('version:', d['version'])
print('kind:', d['kind'])
print('voxels:', len(d['voxels']))
print('parts:', len(d['parts']))
for p in d['parts']:
    print(f'  bone: {p[\"id\"]} parent={p[\"parent\"]} joint={p[\"joint\"]}')
"
```
Expected: 6 bones (torso, head, left_arm, right_arm, left_leg, right_leg) with proper names from manifest.

- [ ] **Step 5: Spot-check a VFX project**

Run:
```bash
python3 -c "
import json
d=json.load(open('examples/island_demo/tools_data/melies_projects/torch.json'))
print('version:', d['version'])
p = d['presets'][0]
print('preset:', p['name'])
for el in p['elements']:
    print(f'  {el[\"type\"]}: {el[\"name\"]}')
"
```
Expected: version 3, preset "torch" with 5 elements (object, emitter, animation x2, light — count may vary based on actual torch.vfx.json).

- [ ] **Step 6: Commit all generated files**

```bash
git add examples/island_demo/tools_data/
git commit -m "feat: generate island demo tools_data from existing assets

Includes:
- Echidna saves for all characters (with bones) and props
- Melies VFX projects for all effect presets
- Bricklayer project with full scene + showcase features"
```
