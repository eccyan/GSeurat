/**
 * PLY importer for Echidna.
 *
 * Reads a binary PLY file (as produced by plyExport.ts) and converts
 * Gaussian splat vertices back into a voxel map + body parts list.
 *
 * Supported properties:
 *   x, y, z            — position
 *   f_dc_0/1/2         — SH DC color coefficients
 *   opacity            — logit opacity
 *   bone_index (uchar) — optional, triggers multi-part reconstruction
 */

import type { Voxel, VoxelKey, BodyPart } from '../store/types.js';
import { voxelKey, parseKey } from './voxelUtils.js';

const SH_FACTOR = 0.2820947917738781; // 0.5 / sqrt(pi)

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Next power of 2 >= n, minimum 8. */
function nextPow2(n: number): number {
  let p = 8;
  while (p < n) p *= 2;
  return p;
}

export interface PlyImportResult {
  voxels: Map<VoxelKey, Voxel>;
  parts: BodyPart[];
  gridSize: number;
}

/**
 * Parse a binary PLY buffer and convert Gaussian splats back to voxels.
 *
 * @param buffer   - ArrayBuffer of the PLY file
 * @param gridSize - optional hint; if omitted, auto-detected from bounding box
 */
export function parsePlyToVoxels(buffer: ArrayBuffer, gridSize?: number): PlyImportResult {
  const uint8 = new Uint8Array(buffer);

  // ── 1. Parse PLY header ──────────────────────────────────────────────────

  // Find end of header ("end_header\n")
  const END_HEADER = 'end_header\n';
  const endMarkerBytes = new TextEncoder().encode(END_HEADER);

  let headerEnd = -1;
  outer: for (let i = 0; i <= uint8.length - endMarkerBytes.length; i++) {
    for (let j = 0; j < endMarkerBytes.length; j++) {
      if (uint8[i + j] !== endMarkerBytes[j]) continue outer;
    }
    headerEnd = i + endMarkerBytes.length;
    break;
  }

  if (headerEnd === -1) {
    throw new Error('parsePlyToVoxels: end_header not found');
  }

  const headerText = new TextDecoder().decode(uint8.slice(0, headerEnd));
  const lines = headerText.split('\n').map(l => l.trim());

  // Extract vertex count
  let vertexCount = 0;
  for (const line of lines) {
    const m = line.match(/^element vertex (\d+)$/);
    if (m) { vertexCount = parseInt(m[1], 10); break; }
  }

  // Collect property names in order
  const properties: string[] = [];
  for (const line of lines) {
    const m = line.match(/^property (\S+) (\S+)$/);
    if (m) properties.push(m[2]);
  }

  // Property byte sizes
  const propSizes: number[] = properties.map(p => {
    if (p === 'bone_index') return 1; // uchar
    return 4; // float
  });

  const bytesPerVertex = propSizes.reduce((a, b) => a + b, 0);

  // Property index helpers
  const idx = (name: string) => properties.indexOf(name);
  const iX     = idx('x');
  const iY     = idx('y');
  const iZ     = idx('z');
  const iDc0   = idx('f_dc_0');
  const iDc1   = idx('f_dc_1');
  const iDc2   = idx('f_dc_2');
  const iOpacity = idx('opacity');
  const iBone  = idx('bone_index');
  const hasBones = iBone !== -1;

  // Byte offsets for each property within a vertex record
  const propOffsets: number[] = [];
  let runningOffset = 0;
  for (let p = 0; p < properties.length; p++) {
    propOffsets.push(runningOffset);
    runningOffset += propSizes[p];
  }

  const view = new DataView(buffer);

  // ── 2. Read all vertices ─────────────────────────────────────────────────

  interface Vertex {
    x: number; y: number; z: number;
    r: number; g: number; b: number; a: number;
    bone: number;
  }

  const vertices: Vertex[] = [];

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let vi = 0; vi < vertexCount; vi++) {
    const base = headerEnd + vi * bytesPerVertex;

    const readFloat = (propIdx: number) =>
      view.getFloat32(base + propOffsets[propIdx], true);

    const x = iX !== -1 ? readFloat(iX) : 0;
    const y = iY !== -1 ? readFloat(iY) : 0;
    const z = iZ !== -1 ? readFloat(iZ) : 0;

    const sh0 = iDc0 !== -1 ? readFloat(iDc0) : 0;
    const sh1 = iDc1 !== -1 ? readFloat(iDc1) : 0;
    const sh2 = iDc2 !== -1 ? readFloat(iDc2) : 0;

    const logitOpacity = iOpacity !== -1 ? readFloat(iOpacity) : 10;

    const r = Math.round(Math.min(255, Math.max(0, (sh0 * SH_FACTOR + 0.5) * 255)));
    const g = Math.round(Math.min(255, Math.max(0, (sh1 * SH_FACTOR + 0.5) * 255)));
    const b = Math.round(Math.min(255, Math.max(0, (sh2 * SH_FACTOR + 0.5) * 255)));
    const a = Math.round(sigmoid(logitOpacity) * 255);

    const bone = hasBones ? view.getUint8(base + propOffsets[iBone]) : 0;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;

    vertices.push({ x, y, z, r, g, b, a, bone });
  }

  if (vertices.length === 0) {
    // Empty file — return empty result
    const gs = gridSize ?? 8;
    return {
      voxels: new Map(),
      parts: [{ id: 'root', name: 'root', parent: null, joint: [0, 0, 0], voxelKeys: [] }],
      gridSize: gs,
    };
  }

  // ── 3. Determine grid size ───────────────────────────────────────────────

  // The exporter centers X around halfW and Y around halfH, with Z from 0.
  // To recover grid coordinates:
  //   vx = px + halfW  → range ~[0, gridWidth)
  //   vy = py + halfH  → range ~[0, maxY)
  //   vz = pz          → range ~[0, depth)

  // The bounding box in world coords:
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const rangeZ = maxZ - minZ;
  const maxRange = Math.max(rangeX, rangeY, rangeZ);

  let gs: number;
  if (gridSize !== undefined) {
    gs = gridSize;
  } else {
    // Each voxel cell occupies ~1 world unit; bounding box spans ~gridSize units.
    // Add 2 for margins / rounding.
    gs = nextPow2(Math.ceil(maxRange) + 2);
  }

  // ── 4. Quantize to grid ──────────────────────────────────────────────────

  // The exporter formula:
  //   px = (vx + sub_offset - 0.5) - halfW
  //   py = (vy + sub_offset - 0.5) - halfH
  //   pz = vz + sub_offset - 0.5
  //
  // Invert (ignoring sub-voxel offset which is small):
  //   vx ≈ round(px + halfW + 0.5) = round(px - minX)
  //   vy ≈ round(py + halfH + 0.5) = round(py - minY)
  //   vz ≈ round(pz + 0.5)        = round(pz - minZ)

  // Accumulator for averaging colors when multiple Gaussians land in same cell
  interface Accum {
    r: number; g: number; b: number; a: number;
    count: number;
    bone: number;
  }
  const accumMap = new Map<VoxelKey, Accum>();

  for (const v of vertices) {
    const gx = Math.round(v.x - minX);
    const gy = Math.round(v.y - minY);
    const gz = Math.round(v.z - minZ);

    const key = voxelKey(gx, gy, gz);
    const existing = accumMap.get(key);
    if (existing) {
      existing.r += v.r;
      existing.g += v.g;
      existing.b += v.b;
      existing.a += v.a;
      existing.count++;
    } else {
      accumMap.set(key, { r: v.r, g: v.g, b: v.b, a: v.a, count: 1, bone: v.bone });
    }
  }

  // ── 5. Build final voxel map ─────────────────────────────────────────────

  const voxels = new Map<VoxelKey, Voxel>();
  for (const [key, acc] of accumMap) {
    const n = acc.count;
    voxels.set(key, {
      color: [
        Math.round(acc.r / n),
        Math.round(acc.g / n),
        Math.round(acc.b / n),
        Math.round(acc.a / n),
      ],
    });
  }

  // ── 6. Build body parts ───────────────────────────────────────────────────

  let parts: BodyPart[];

  if (!hasBones) {
    // Single root part containing all voxels — joint at centroid
    const allKeys = Array.from(voxels.keys());
    let jx = 0, jy = 0, jz = 0;
    for (const key of allKeys) {
      const [x, y, z] = parseKey(key);
      jx += x; jy += y; jz += z;
    }
    const n = allKeys.length || 1;
    parts = [{
      id: 'root',
      name: 'root',
      parent: null,
      joint: [Math.round(jx / n), Math.round(jy / n), Math.round(jz / n)],
      voxelKeys: allKeys,
    }];
  } else {
    // Group by bone index
    const boneToKeys = new Map<number, VoxelKey[]>();

    // We need per-key bone assignment — use the bone from the accumulator
    for (const [key, acc] of accumMap) {
      const bone = acc.bone;
      let keys = boneToKeys.get(bone);
      if (!keys) { keys = []; boneToKeys.set(bone, keys); }
      keys.push(key);
    }

    // Sort by bone index for stable ordering
    const sortedBones = Array.from(boneToKeys.keys()).sort((a, b) => a - b);

    parts = sortedBones.map((boneIdx, i) => {
      const keys = boneToKeys.get(boneIdx) ?? [];
      // Compute centroid of this part's voxels for joint position
      let jx = 0, jy = 0, jz = 0;
      for (const key of keys) {
        const [x, y, z] = parseKey(key);
        jx += x; jy += y; jz += z;
      }
      const n = keys.length || 1;
      return {
        id: i === 0 ? 'root' : `part_${boneIdx}`,
        name: i === 0 ? 'root' : `part_${boneIdx}`,
        parent: i === 0 ? null : 'root',
        joint: [Math.round(jx / n), Math.round(jy / n), Math.round(jz / n)] as [number, number, number],
        voxelKeys: keys,
      };
    });
  }

  return { voxels, parts, gridSize: gs };
}
