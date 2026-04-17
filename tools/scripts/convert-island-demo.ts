/**
 * convert-island-demo.ts — Batch-convert island demo assets into tool formats.
 *
 * Phase 1: Echidna PLY → .echidna project files
 * (Phase 2: Melies VFX — added later)
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

// ── Paths ──────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../examples/island_demo');
const ASSETS = path.join(ROOT, 'assets');
const TOOLS_DATA = path.join(ROOT, 'tools_data');
const ECHIDNA_OUT = path.join(TOOLS_DATA, 'echidna_saves');

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

// ── Main ───────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('convert-island-demo: Starting asset conversion pipeline');
  console.log(`  Assets: ${ASSETS}`);
  console.log(`  Output: ${TOOLS_DATA}`);

  runEchidnaPhase();

  // Future phases will be appended here:
  // runMeliesPhase();
  // runBricklayerPhase();

  console.log('\nAll phases complete.');
}

main();
