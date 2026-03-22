/**
 * MagicaVoxel .vox file parser.
 *
 * Parses the RIFF-style chunk format and extracts voxel models + palette.
 * Each model in the file maps to a separate body part.
 *
 * Reference: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
 */

import type { Voxel, VoxelKey } from '../store/types.js';
import { voxelKey } from './voxelUtils.js';

export interface VoxModel {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxels: Map<VoxelKey, Voxel>;
}

export interface VoxFile {
  models: VoxModel[];
  palette: [number, number, number, number][];
}

/** Default MagicaVoxel palette (used when no RGBA chunk is present). */
const DEFAULT_PALETTE: [number, number, number, number][] = [];
for (let i = 0; i < 256; i++) {
  DEFAULT_PALETTE.push([
    ((i >> 0) & 3) * 85,
    ((i >> 2) & 3) * 85,
    ((i >> 4) & 3) * 85,
    255,
  ]);
}

function readString(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}

/**
 * Try parsing as a raw voxel grid format:
 * 12 bytes header: width(u32) height(u32) depth(u32)
 * W*H*D bytes: palette index per voxel (0 = empty)
 * 768 bytes: 256-entry RGB palette (3 bytes each)
 */
function tryParseRawGrid(buffer: ArrayBuffer): VoxFile | null {
  if (buffer.byteLength < 12) return null;
  const view = new DataView(buffer);
  const w = view.getUint32(0, true);
  const h = view.getUint32(4, true);
  const d = view.getUint32(8, true);

  // Sanity check: dimensions should be reasonable, and file size must match
  if (w === 0 || h === 0 || d === 0 || w > 512 || h > 512 || d > 512) return null;
  const voxelCount = w * h * d;
  const expectedSize = 12 + voxelCount + 768;
  if (buffer.byteLength !== expectedSize) return null;

  // Read palette (last 768 bytes) — values are 6-bit (0-63), scale to 8-bit
  const paletteOffset = 12 + voxelCount;
  const palette: [number, number, number, number][] = [];
  for (let i = 0; i < 256; i++) {
    const r6 = view.getUint8(paletteOffset + i * 3);
    const g6 = view.getUint8(paletteOffset + i * 3 + 1);
    const b6 = view.getUint8(paletteOffset + i * 3 + 2);
    // Scale 6-bit (0-63) to 8-bit (0-255): multiply by 255/63 ≈ 4.048
    palette.push([
      Math.round(r6 * 255 / 63),
      Math.round(g6 * 255 / 63),
      Math.round(b6 * 255 / 63),
      255,
    ]);
  }

  // Read voxels — column-major order: index = x*(h*d) + z*h + y
  // 0xFF (255) is empty. Axes: w=X, h=Y (depth), d=Z (height).
  const voxelMap = new Map<VoxelKey, Voxel>();
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      for (let y = 0; y < h; y++) {
        const idx = 12 + x * (h * d) + z * h + y;
        const colorIndex = view.getUint8(idx);
        if (colorIndex === 0xFF) continue; // empty
        // Map to Echidna coords: X=x, Y(up)=z, Z(depth)=y
        const key = voxelKey(x, z, y);
        voxelMap.set(key, { color: [...palette[colorIndex]] });
      }
    }
  }

  return {
    models: [{
      sizeX: w,
      sizeY: d,
      sizeZ: h,
      voxels: voxelMap,
    }],
    palette,
  };
}

export function parseVox(buffer: ArrayBuffer): VoxFile {
  // Try raw grid format first (no magic header)
  const rawResult = tryParseRawGrid(buffer);
  if (rawResult) return rawResult;

  const view = new DataView(buffer);
  let offset = 0;

  // Magic number: "VOX "
  const magic = readString(view, offset, 4);
  offset += 4;
  if (magic !== 'VOX ') {
    throw new Error(`Unsupported .vox format (magic: "${magic}"). Expected MagicaVoxel or raw grid format.`);
  }

  // Version
  const version = view.getInt32(offset, true);
  offset += 4;
  if (version < 150) {
    throw new Error(`Unsupported .vox version: ${version}`);
  }

  // Parse chunks
  const sizes: { x: number; y: number; z: number }[] = [];
  const xyziChunks: { x: number; y: number; z: number; colorIndex: number }[][] = [];
  let palette: [number, number, number, number][] | null = null;

  function parseChunks(start: number, end: number) {
    let pos = start;
    while (pos < end) {
      const chunkId = readString(view, pos, 4);
      pos += 4;
      const contentSize = view.getInt32(pos, true);
      pos += 4;
      const childrenSize = view.getInt32(pos, true);
      pos += 4;

      const contentStart = pos;
      const contentEnd = pos + contentSize;

      if (chunkId === 'SIZE') {
        const x = view.getInt32(contentStart, true);
        const y = view.getInt32(contentStart + 4, true);
        const z = view.getInt32(contentStart + 8, true);
        sizes.push({ x, y, z });
      } else if (chunkId === 'XYZI') {
        const numVoxels = view.getInt32(contentStart, true);
        const voxels: { x: number; y: number; z: number; colorIndex: number }[] = [];
        for (let i = 0; i < numVoxels; i++) {
          const base = contentStart + 4 + i * 4;
          voxels.push({
            x: view.getUint8(base),
            y: view.getUint8(base + 1),
            z: view.getUint8(base + 2),
            colorIndex: view.getUint8(base + 3),
          });
        }
        xyziChunks.push(voxels);
      } else if (chunkId === 'RGBA') {
        palette = [];
        for (let i = 0; i < 256; i++) {
          const base = contentStart + i * 4;
          palette.push([
            view.getUint8(base),
            view.getUint8(base + 1),
            view.getUint8(base + 2),
            view.getUint8(base + 3),
          ]);
        }
      } else if (chunkId === 'MAIN') {
        // MAIN chunk: recurse into children
        parseChunks(contentEnd, contentEnd + childrenSize);
        pos = contentEnd + childrenSize;
        continue;
      }

      pos = contentEnd + childrenSize;
    }
  }

  parseChunks(offset, buffer.byteLength);

  const usePalette = palette ?? DEFAULT_PALETTE;

  // Build models
  const models: VoxModel[] = [];
  for (let i = 0; i < xyziChunks.length; i++) {
    const size = sizes[i] ?? { x: 16, y: 16, z: 16 };
    const voxelMap = new Map<VoxelKey, Voxel>();

    for (const v of xyziChunks[i]) {
      // MagicaVoxel uses Y-up with Z as depth; we remap:
      // MV (x, y, z) -> Echidna (x, z, y) so MV's Z becomes our Y (height)
      const key = voxelKey(v.x, v.z, v.y);
      // Color index in .vox is 1-based (0 = empty), palette is 0-indexed
      const color = usePalette[(v.colorIndex - 1) & 0xff];
      voxelMap.set(key, { color: [...color] });
    }

    models.push({
      // Remap dimensions to match coordinate swap
      sizeX: size.x,
      sizeY: size.z,
      sizeZ: size.y,
      voxels: voxelMap,
    });
  }

  return { models, palette: usePalette };
}
