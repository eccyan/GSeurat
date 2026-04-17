/**
 * convert-island-demo.ts — Batch-convert island demo assets into tool formats.
 *
 * Phase 1: Echidna PLY → .echidna project files
 * Phase 2: Melies VFX → .json project files
 * (Phase 3: Bricklayer scene — added later)
 *
 * Usage:
 *   npx tsx tools/scripts/convert-island-demo.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePlyToVoxels } from '../apps/echidna/src/lib/plyImport.js';
import { ECHIDNA_FILE_VERSION, slugifyAssetId } from '../apps/echidna/src/store/types.js';
import type { EchidnaFile, BodyPart, PoseData, AnimationClip, EasingType, PlaybackMode } from '../apps/echidna/src/store/types.js';
import { parseKey } from '../apps/echidna/src/lib/voxelUtils.js';
import { parseVfx } from '../apps/melies/src/lib/vfxImport.js';
import { VFX_PROJECT_VERSION } from '../apps/melies/src/store/types.js';
import type { VfxProject } from '../apps/melies/src/store/types.js';

// ── Paths ──────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../examples/island_demo');
const ASSETS = path.join(ROOT, 'assets');
const TOOLS_DATA = path.join(ROOT, 'tools_data');
const ECHIDNA_OUT = path.join(TOOLS_DATA, 'echidna_saves');
const MELIES_OUT = path.join(TOOLS_DATA, 'melies_projects');

// ── Manifest types ─────────────────────────────────────────────────────────────

interface ManifestBone {
  id: string;
  parent: string | null;
  joint: [number, number, number];
}

interface ManifestPose {
  [partId: string]: [number, number, number];
}

interface ManifestAnimation {
  duration: number;
  looping: boolean;
  keyframes: {
    time: number;
    pose: string;
    easing: string;
  }[];
  root_motion?: boolean;
}

interface Manifest {
  name: string;
  ply_file?: string;
  scale?: number;
  bones?: ManifestBone[];
  poses?: Record<string, ManifestPose & { root_position?: [number, number, number] }>;
  animations?: Record<string, ManifestAnimation>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readPlyFile(filePath: string): { buffer: ArrayBuffer; hasBones: boolean } | null {
  const buf = fs.readFileSync(filePath);
  const header = buf.subarray(0, 3).toString('ascii');
  if (header !== 'ply') return null;
  const headerEnd = buf.indexOf('end_header\n');
  const headerText = headerEnd !== -1 ? buf.subarray(0, headerEnd).toString('ascii') : '';
  return {
    buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    hasBones: headerText.includes('bone_index'),
  };
}

/** Convert manifest poses to EchidnaFile PoseData format. */
function convertPoses(
  manifestPoses: Record<string, ManifestPose & { root_position?: [number, number, number] }>,
): Record<string, PoseData> {
  const result: Record<string, PoseData> = {};
  for (const [poseName, poseData] of Object.entries(manifestPoses)) {
    const rotations: Record<string, [number, number, number]> = {};
    let rootPosition: [number, number, number] | undefined;
    for (const [key, value] of Object.entries(poseData)) {
      if (key === 'root_position') {
        rootPosition = value as [number, number, number];
      } else {
        rotations[key] = value as [number, number, number];
      }
    }
    result[poseName] = { rotations, ...(rootPosition ? { rootPosition } : {}) };
  }
  return result;
}

/** Convert manifest animations to EchidnaFile AnimationClip format. */
function convertAnimations(
  manifestAnims: Record<string, ManifestAnimation>,
): Record<string, AnimationClip> {
  const result: Record<string, AnimationClip> = {};
  for (const [animName, animData] of Object.entries(manifestAnims)) {
    result[animName] = {
      name: animName,
      keyframes: animData.keyframes.map((kf) => ({
        time: kf.time,
        poseName: kf.pose,
        easing: kf.easing as EasingType,
      })),
      duration: animData.duration,
      playbackMode: (animData.looping ? 'loop' : 'once') as PlaybackMode,
      ...(animData.root_motion ? { rootMotion: true } : {}),
    };
  }
  return result;
}

// ── Phase 1: Echidna PLY conversion ────────────────────────────────────────────

function runEchidnaPhase(): void {
  console.log('\n=== Phase 1: Echidna PLY Conversion ===\n');

  fs.mkdirSync(ECHIDNA_OUT, { recursive: true });

  let converted = 0;
  let skipped = 0;

  // ── Characters ───────────────────────────────────────────────────────────

  const charsDir = path.join(ASSETS, 'characters');
  if (fs.existsSync(charsDir)) {
    for (const charName of fs.readdirSync(charsDir)) {
      const charDir = path.join(charsDir, charName);
      if (!fs.statSync(charDir).isDirectory()) continue;

      // Find PLY file
      const plyFile = fs.readdirSync(charDir).find((f) => f.endsWith('.ply'));
      if (!plyFile) {
        console.log(`  SKIP ${charName}/ — no PLY file`);
        skipped++;
        continue;
      }

      const plyPath = path.join(charDir, plyFile);

      try {
        const plyData = readPlyFile(plyPath);
        if (!plyData) {
          console.log(`  SKIP ${charName}/${plyFile} — invalid PLY header`);
          skipped++;
          continue;
        }

        console.log(`  Converting character: ${charName}/${plyFile}`);

        const result = parsePlyToVoxels(plyData.buffer);

        // Convert voxels Map to array format
        const voxelArray = Array.from(result.voxels.entries()).map(([key, voxel]) => {
          const [x, y, z] = parseKey(key);
          return { x, y, z, r: voxel.color[0], g: voxel.color[1], b: voxel.color[2], a: voxel.color[3] };
        });

        // Look for companion manifest
        const manifestPath = path.join(charDir, `${charName}.manifest.json`);
        let manifest: Manifest | null = null;
        if (fs.existsSync(manifestPath)) {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        }

        // Enrich parts with manifest bone data
        let parts = result.parts;
        if (manifest?.bones) {
          parts = parts.map((part, i) => {
            const bone = manifest!.bones![i];
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

        // Convert poses and animations from manifest
        const poses = manifest?.poses ? convertPoses(manifest.poses) : {};
        const animations = manifest?.animations ? convertAnimations(manifest.animations) : {};

        const id = slugifyAssetId(charName);
        const echidnaFile: EchidnaFile = {
          version: ECHIDNA_FILE_VERSION,
          id,
          kind: 'character',
          characterName: charName,
          gridWidth: result.gridSize,
          gridDepth: result.gridSize,
          voxels: voxelArray,
          parts,
          poses,
          animations,
          tags: [],
          color_palettes: [],
        };

        const outPath = path.join(ECHIDNA_OUT, `${id}.echidna`);
        fs.writeFileSync(outPath, JSON.stringify(echidnaFile, null, 2));
        console.log(`    -> ${path.relative(ROOT, outPath)} (${voxelArray.length} voxels, ${parts.length} parts)`);
        converted++;
      } catch (err) {
        console.log(`  ERROR ${charName}/${plyFile} — ${err instanceof Error ? err.message : err}`);
        skipped++;
      }
    }
  }

  // ── Props ────────────────────────────────────────────────────────────────

  const propsDir = path.join(ASSETS, 'props');
  if (fs.existsSync(propsDir)) {
    for (const file of fs.readdirSync(propsDir)) {
      if (!file.endsWith('.ply')) continue;

      const plyPath = path.join(propsDir, file);

      try {
        const plyData = readPlyFile(plyPath);
        if (!plyData) {
          console.log(`  SKIP props/${file} — invalid PLY header`);
          skipped++;
          continue;
        }

        console.log(`  Converting prop: ${file}`);

        const result = parsePlyToVoxels(plyData.buffer);

        const voxelArray = Array.from(result.voxels.entries()).map(([key, voxel]) => {
          const [x, y, z] = parseKey(key);
          return { x, y, z, r: voxel.color[0], g: voxel.color[1], b: voxel.color[2], a: voxel.color[3] };
        });

        // Determine kind: if PLY has bone_index, treat as character
        const kind = plyData.hasBones ? 'character' as const : 'object' as const;

        const baseName = file.replace('.ply', '');
        const id = slugifyAssetId(baseName);

        const echidnaFile: EchidnaFile = {
          version: ECHIDNA_FILE_VERSION,
          id,
          kind,
          characterName: baseName,
          gridWidth: result.gridSize,
          gridDepth: result.gridSize,
          voxels: voxelArray,
          parts: result.parts,
          poses: {},
          animations: {},
          tags: [],
          color_palettes: [],
        };

        const outPath = path.join(ECHIDNA_OUT, `${id}.echidna`);
        fs.writeFileSync(outPath, JSON.stringify(echidnaFile, null, 2));
        console.log(`    -> ${path.relative(ROOT, outPath)} (${voxelArray.length} voxels, kind=${kind})`);
        converted++;
      } catch (err) {
        console.log(`  ERROR props/${file} — ${err instanceof Error ? err.message : err}`);
        skipped++;
      }
    }
  }

  console.log(`\nPhase 1 complete: ${converted} converted, ${skipped} skipped`);
}

// ── Phase 2: Melies VFX conversion ────────────────────────────────────────────

function runMeliesPhase(): void {
  console.log('\n=== Phase 2: Melies VFX Conversion ===\n');

  fs.mkdirSync(MELIES_OUT, { recursive: true });

  const vfxDir = path.join(ASSETS, 'vfx');
  if (!fs.existsSync(vfxDir)) {
    console.log('  No vfx/ directory found — skipping');
    return;
  }

  let converted = 0;

  for (const file of fs.readdirSync(vfxDir)) {
    if (!file.endsWith('.vfx.json')) continue;

    const filePath = path.join(vfxDir, file);
    const slug = file.replace('.vfx.json', '');

    try {
      const jsonString = fs.readFileSync(filePath, 'utf-8');
      const preset = parseVfx(jsonString);

      const project: VfxProject = {
        version: VFX_PROJECT_VERSION,
        presets: [preset],
      };

      const outPath = path.join(MELIES_OUT, `${slug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(project, null, 2));
      console.log(`  ${file} -> ${path.relative(ROOT, outPath)} (${preset.elements.length} elements)`);
      converted++;
    } catch (err) {
      console.log(`  ERROR ${file} — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nPhase 2 complete: ${converted} VFX presets converted`);
}

// ── Phase 3: Bricklayer scene conversion ─────────────────────────────────────

const BRICKLAYER_OUT = path.join(TOOLS_DATA, 'bricklayer');

interface EmitterParams {
  spawn_rate: number;
  particle_lifetime_min: number;
  particle_lifetime_max: number;
  velocity_min: [number, number];
  velocity_max: [number, number];
  acceleration: [number, number];
  size_min: number;
  size_max: number;
  size_end_scale: number;
  color_start: [number, number, number, number];
  color_end: [number, number, number, number];
  tile: string;
  z: number;
  spawn_offset_min: [number, number];
  spawn_offset_max: [number, number];
}

function defaultEmitter(): EmitterParams {
  return {
    spawn_rate: 10, particle_lifetime_min: 0.5, particle_lifetime_max: 1.5,
    velocity_min: [-0.5, -0.5], velocity_max: [0.5, 0.5], acceleration: [0, 0],
    size_min: 1, size_max: 2, size_end_scale: 0.5,
    color_start: [1, 1, 1, 1], color_end: [1, 1, 1, 0],
    tile: '', z: 0, spawn_offset_min: [0, 0], spawn_offset_max: [0, 0],
  };
}

function buildAssetRegistry(): Record<string, Record<string, unknown>> {
  const registry: Record<string, Record<string, unknown>> = {
    characters: {}, vfx: {}, textures: {}, audio: {}, maps: {}, objects: {},
  };

  // Characters: dirs with .ply files
  const charsDir = path.join(ASSETS, 'characters');
  if (fs.existsSync(charsDir)) {
    for (const name of fs.readdirSync(charsDir)) {
      const dir = path.join(charsDir, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const plyFile = fs.readdirSync(dir).find((f) => f.endsWith('.ply'));
      if (!plyFile) continue;
      const manifestFile = fs.readdirSync(dir).find((f) => f.endsWith('.manifest.json'));
      registry.characters[name] = {
        id: name, ply: `assets/characters/${name}/${plyFile}`,
        ...(manifestFile ? { manifest: `assets/characters/${name}/${manifestFile}` } : {}),
      };
    }
  }

  // VFX: each .vfx.json
  const vfxDir = path.join(ASSETS, 'vfx');
  if (fs.existsSync(vfxDir)) {
    for (const file of fs.readdirSync(vfxDir)) {
      if (!file.endsWith('.vfx.json')) continue;
      const id = file.replace('.vfx.json', '');
      registry.vfx[id] = { id, file: `assets/vfx/${file}` };
    }
  }

  // Textures: each .png/.jpg
  const texDir = path.join(ASSETS, 'textures');
  if (fs.existsSync(texDir)) {
    for (const file of fs.readdirSync(texDir)) {
      if (!file.endsWith('.png') && !file.endsWith('.jpg')) continue;
      const id = file.replace(/\.(png|jpg)$/, '');
      registry.textures[id] = { id, file: `assets/textures/${file}` };
    }
  }

  // Audio: each .music.json
  const audioDir = path.join(ASSETS, 'audio');
  if (fs.existsSync(audioDir)) {
    for (const file of fs.readdirSync(audioDir)) {
      if (!file.endsWith('.music.json')) continue;
      const id = file.replace('.music.json', '');
      registry.audio[id] = { id, file: `assets/audio/${file}` };
    }
  }

  // Maps: each .ply in maps/
  const mapsDir = path.join(ASSETS, 'maps');
  if (fs.existsSync(mapsDir)) {
    for (const file of fs.readdirSync(mapsDir)) {
      if (!file.endsWith('.ply')) continue;
      const id = file.replace('.ply', '');
      registry.maps[id] = { id, file: `assets/maps/${file}` };
    }
  }

  // Objects: each .ply in props/
  const propsDir = path.join(ASSETS, 'props');
  if (fs.existsSync(propsDir)) {
    for (const file of fs.readdirSync(propsDir)) {
      if (!file.endsWith('.ply')) continue;
      const id = file.replace('.ply', '');
      registry.objects[id] = { id, file: `assets/props/${file}` };
    }
  }

  return registry;
}

function runBricklayerPhase(): void {
  console.log('\n=== Phase 3: Bricklayer Scene Conversion ===\n');

  fs.mkdirSync(BRICKLAYER_OUT, { recursive: true });

  // Read engine scene
  const scenePath = path.join(ASSETS, 'scenes', 'seurat_island.json');
  if (!fs.existsSync(scenePath)) {
    console.log('  ERROR: seurat_island.json not found — skipping');
    return;
  }
  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));

  // ── Map engine fields to Bricklayer format ─────────────────────────────

  const ambientColor = scene.ambient_color ?? [0.12, 0.12, 0.18, 1.0];

  // Lights
  const staticLights = (scene.lights ?? []).map((l: Record<string, unknown>, i: number) => ({
    id: `light_${i}`,
    type: (l as { radius?: number }).radius && (l as { radius?: number }).radius! > 300 ? 'point' : 'spot',
    position: l.position,
    color: l.color,
    radius: l.radius,
    intensity: l.intensity,
  }));

  // Game objects (direct passthrough with defaults)
  const gameObjects = (scene.game_objects ?? []).map((go: Record<string, unknown>) => ({
    id: go.id ?? 'unnamed',
    name: go.name ?? go.id ?? 'unnamed',
    position: go.position ?? [0, 0, 0],
    rotation: go.rotation ?? [0, 0, 0],
    scale: go.scale ?? 1.0,
    ply_file: go.ply_file ?? null,
    components: go.components ?? {},
    pbd: go.pbd ?? null,
  }));

  // Collision -> collisionGridData
  const collisionGridData = scene.collision ? {
    width: scene.collision.width,
    height: scene.collision.height,
    cell_size: scene.collision.cell_size,
    solid: scene.collision.solid,
    elevation: scene.collision.elevation,
    nav_zone: scene.collision.nav_zone ?? [],
  } : undefined;

  // Particle emitters -> gsParticleEmitters
  const gsParticleEmitters = (scene.particle_emitters ?? []).map(
    (pe: Record<string, unknown>, i: number) => ({
      id: `emitter_${i}`,
      muted: (pe.spawn_rate as number | undefined) === 0,
      preset: pe.preset,
      position: pe.position,
      spawn_rate: pe.spawn_rate ?? undefined,
      emitter: defaultEmitter(),
    }),
  );

  // Player
  const player = {
    position: scene.player?.position ?? [187.0, 1.9663, 197.0],
    facing: scene.player?.facing ?? 'down',
    tint: [1, 1, 1, 1],
    character_id: 'protagonist',
  };

  // Gaussian splat (drop ground_color/sky_color, add defaults)
  const gs = scene.gaussian_splat ?? {};
  const gaussianSplat = {
    ply_file: gs.ply_file,
    camera: gs.camera,
    render_width: gs.render_width,
    render_height: gs.render_height,
    scale_multiplier: gs.scale_multiplier,
    parallax: 1.0,
    morph_targets: [],
  };

  // ── Asset registry ─────────────────────────────────────────────────────

  const asset_registry = {
    version: 1,
    ...buildAssetRegistry(),
  };

  // ── Showcase features ──────────────────────────────────────────────────

  // Weather (light rain)
  const weather = {
    enabled: true, type: 'rain',
    emitter: {
      ...defaultEmitter(),
      spawn_rate: 40, particle_lifetime_min: 0.8, particle_lifetime_max: 1.2,
      velocity_min: [-0.2, -8] as [number, number],
      velocity_max: [0.2, -6] as [number, number],
      size_min: 0.5, size_max: 1,
      color_start: [0.7, 0.75, 0.85, 0.4] as [number, number, number, number],
      color_end: [0.7, 0.75, 0.85, 0] as [number, number, number, number],
    },
    ambient_override: [0.2, 0.22, 0.3, 1],
    fog_density: 0.02,
    fog_color: [0.5, 0.55, 0.6],
    transition_speed: 0.5,
  };

  // Day/Night cycle
  const dayNight = {
    enabled: true, cycle_speed: 0.5, initial_time: 0.3,
    keyframes: [
      { time: 0, ambient: [0.04, 0.04, 0.12, 1], torch_intensity: 1.0 },
      { time: 0.2, ambient: [0.6, 0.45, 0.35, 1], torch_intensity: 0.3 },
      { time: 0.35, ambient: [0.85, 0.8, 0.7, 1], torch_intensity: 0 },
      { time: 0.5, ambient: [1, 0.98, 0.92, 1], torch_intensity: 0 },
      { time: 0.7, ambient: [0.75, 0.5, 0.35, 1], torch_intensity: 0.2 },
      { time: 0.85, ambient: [0.3, 0.2, 0.25, 1], torch_intensity: 0.8 },
    ],
  };

  // Background layers
  const backgroundLayers = [
    { texture: 'assets/textures/bg_sky.png', z: -100, parallax: 0.02 },
    { texture: 'assets/textures/bg_mountains.png', z: -80, parallax: 0.05 },
    { texture: 'assets/textures/bg_trees.png', z: -60, parallax: 0.1 },
  ];

  // VFX instances
  const torchAudioPositions: [number, number, number][] = scene.torch_audio_positions ?? [];

  // Load VFX presets from files
  function loadVfxPreset(vfxFile: string): unknown {
    const fullPath = path.join(ROOT, vfxFile);
    if (fs.existsSync(fullPath)) {
      return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    }
    return null;
  }

  const vfxInstances: Record<string, unknown>[] = [];

  // Torch VFX at torch_audio_positions (4 instances)
  torchAudioPositions.forEach((pos, i) => {
    vfxInstances.push({
      id: `torch_vfx_${i}`, muted: false, name: `Torch ${i + 1}`,
      vfx_file: 'assets/vfx/torch.vfx.json',
      vfx_preset: loadVfxPreset('assets/vfx/torch.vfx.json'),
      position: pos, rotation_y: 0, radius: 5,
      trigger: 'auto', loop: true,
    });
  });

  // Fountain spray
  vfxInstances.push({
    id: 'fountain_spray', muted: false, name: 'Fountain Spray',
    vfx_file: 'assets/vfx/fountain_spray.vfx.json',
    vfx_preset: loadVfxPreset('assets/vfx/fountain_spray.vfx.json'),
    position: [178, 3.2, 185], rotation_y: 0, radius: 8,
    trigger: 'auto', loop: true,
  });

  // Crystal burst
  vfxInstances.push({
    id: 'crystal_burst', muted: false, name: 'Crystal Burst',
    vfx_file: 'assets/vfx/crystal_burst.vfx.json',
    vfx_preset: loadVfxPreset('assets/vfx/crystal_burst.vfx.json'),
    position: [195, 2.0418, 120], rotation_y: 0, radius: 6,
    trigger: 'auto', loop: true,
  });

  // Chimney smoke
  vfxInstances.push({
    id: 'chimney_smoke', muted: false, name: 'Chimney Smoke',
    vfx_file: 'assets/vfx/chimney_smoke.vfx.json',
    vfx_preset: loadVfxPreset('assets/vfx/chimney_smoke.vfx.json'),
    position: [192, 4.5658, 175], rotation_y: 0, radius: 4,
    trigger: 'auto', loop: true,
  });

  // Camera volumes
  const cameraVolumes = [
    {
      id: 'cam_fountain_plaza', name: 'Fountain Plaza',
      bounds: { type: 'aabb', center: [178, 5, 185], half_extents: [20, 10, 20] },
      fov: 40,
    },
    {
      id: 'cam_dungeon_entrance', name: 'Dungeon Entrance',
      bounds: { type: 'sphere', center: [203, 5, 175], radius: 15 },
      fov: 35,
    },
    {
      id: 'cam_forest_edge', name: 'Forest Edge',
      bounds: { type: 'aabb', center: [140, 5, 200], half_extents: [30, 10, 30] },
      fov: 50,
    },
  ];

  // Audio zones
  const audioZones = [
    {
      id: 'audio_field_music', name: 'Field Music Zone',
      bounds: { type: 'aabb', min: [100, -10, 80], max: [280, 50, 280] },
      track_group_name: 'field_theme',
      on_enter: { action: 'play', xfade_ms: 2000, align_to_next_marker: false },
      on_exit: { action: 'stop', fade_ms: 3000 },
    },
  ];

  // Emitter configs
  const torchEmitter: EmitterParams = {
    ...defaultEmitter(),
    spawn_rate: 25, particle_lifetime_min: 0.3, particle_lifetime_max: 0.8,
    velocity_min: [-0.3, 1.0], velocity_max: [0.3, 3.0], acceleration: [0, 0.5],
    size_min: 1.5, size_max: 3.0, size_end_scale: 0.2,
    color_start: [1.0, 0.6, 0.1, 0.9], color_end: [0.8, 0.2, 0.0, 0.0],
  };

  const footstepEmitter: EmitterParams = {
    ...defaultEmitter(),
    spawn_rate: 5, particle_lifetime_min: 0.2, particle_lifetime_max: 0.5,
    velocity_min: [-0.5, 0.2], velocity_max: [0.5, 0.8], acceleration: [0, -1.0],
    size_min: 0.5, size_max: 1.0, size_end_scale: 1.5,
    color_start: [0.6, 0.5, 0.35, 0.6], color_end: [0.6, 0.5, 0.35, 0.0],
  };

  const npcAuraEmitter: EmitterParams = {
    ...defaultEmitter(),
    spawn_rate: 8, particle_lifetime_min: 1.0, particle_lifetime_max: 2.5,
    velocity_min: [-0.2, 0.1], velocity_max: [0.2, 0.4], acceleration: [0, 0],
    size_min: 2.0, size_max: 4.0, size_end_scale: 0.8,
    color_start: [0.3, 0.5, 1.0, 0.5], color_end: [0.3, 0.5, 1.0, 0.0],
  };

  // Torch positions (3D -> 2D: [x,y,z] -> [x,z])
  const torchPositions = torchAudioPositions.map((p) => [p[0], p[2]]);

  // ── Build BricklayerFile v2 ────────────────────────────────────────────

  const bricklayerFile = {
    version: 2,
    asset_registry,
    gridWidth: 128,
    gridDepth: 96,
    voxels: [],
    collision: [],
    collisionGridData,
    nav_zone_names: [],
    color_palettes: [],
    scene: {
      ambientColor,
      godRaysIntensity: 0.0,
      staticLights,
      gameObjects,
      player,
      backgroundLayers,
      torchEmitter,
      torchPositions,
      footstepEmitter,
      npcAuraEmitter,
      weather,
      dayNight,
      gaussianSplat,
      gsParticleEmitters,
      gsAnimations: [],
      vfxInstances,
      cameraVolumes,
      cameraTriggers: [],
      cameraRails: [],
      cameraDefaultParams: { fov: 45, follow_speed: 5.0, look_ahead: 2.0 },
      cameraShowDebugVolumes: false,
      audioZones,
    },
  };

  const outPath = path.join(BRICKLAYER_OUT, 'scene.bricklayer');
  fs.writeFileSync(outPath, JSON.stringify(bricklayerFile, null, 2));

  // ── Summary ────────────────────────────────────────────────────────────

  const s = bricklayerFile.scene;
  console.log(`  Output: ${path.relative(ROOT, outPath)}`);
  console.log(`  gameObjects: ${s.gameObjects.length}`);
  console.log(`  staticLights: ${s.staticLights.length}`);
  console.log(`  gsParticleEmitters: ${s.gsParticleEmitters.length}`);
  console.log(`  vfxInstances: ${s.vfxInstances.length}`);
  console.log(`  cameraVolumes: ${s.cameraVolumes.length}`);
  console.log(`  audioZones: ${s.audioZones.length}`);
  console.log(`  backgroundLayers: ${s.backgroundLayers.length}`);
  console.log(`  weather.enabled: ${s.weather.enabled}`);
  console.log(`  dayNight.enabled: ${s.dayNight.enabled}`);
  console.log(`  asset_registry: chars=${Object.keys(bricklayerFile.asset_registry.characters).length}, vfx=${Object.keys(bricklayerFile.asset_registry.vfx).length}, tex=${Object.keys(bricklayerFile.asset_registry.textures).length}, audio=${Object.keys(bricklayerFile.asset_registry.audio).length}, maps=${Object.keys(bricklayerFile.asset_registry.maps).length}, objects=${Object.keys(bricklayerFile.asset_registry.objects).length}`);
  console.log(`  collisionGridData: ${collisionGridData ? 'yes' : 'no'} (${collisionGridData?.width}x${collisionGridData?.height}, cell_size=${collisionGridData?.cell_size})`);

  console.log('\nPhase 3 complete.');
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('convert-island-demo: Starting asset conversion pipeline');
  console.log(`  Assets: ${ASSETS}`);
  console.log(`  Output: ${TOOLS_DATA}`);

  runEchidnaPhase();
  runMeliesPhase();
  runBricklayerPhase();

  console.log('\nAll phases complete.');
}

main();
