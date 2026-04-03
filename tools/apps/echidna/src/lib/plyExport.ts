import type { VoxelKey, Voxel, BodyPart } from '../store/types.js';
import { parseKey, voxelKey } from './voxelUtils.js';

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** Build a lookup from voxel key -> bone index for character export. */
function buildBoneMap(parts: BodyPart[]): Map<VoxelKey, number> {
  const map = new Map<VoxelKey, number>();
  for (let i = 0; i < parts.length; i++) {
    for (const key of parts[i].voxelKeys) {
      map.set(key, i);
    }
  }
  return map;
}

export function exportPly(
  voxels: Map<VoxelKey, Voxel>,
  gridWidth: number,
  gridHeight: number,
  parts?: BodyPart[],
  density: number = 1,
): Blob {
  // Surface culling: skip interior voxels enclosed by 6 neighbors
  const allEntries = Array.from(voxels.entries());
  const entries = allEntries.filter(([key]) => {
    const [x, y, z] = parseKey(key);
    for (const [dx, dy, dz] of NEIGHBORS) {
      if (!voxels.has(voxelKey(x + dx, y + dy, z + dz))) {
        return true; // at least one face exposed
      }
    }
    return false; // fully enclosed
  });

  const n = Math.max(1, Math.floor(density));
  const count = entries.length * n * n * n;

  const hasBones = parts && parts.length > 0;
  const boneMap = hasBones ? buildBoneMap(parts) : null;

  const header =
    `ply\n` +
    `format binary_little_endian 1.0\n` +
    `element vertex ${count}\n` +
    `property float x\n` +
    `property float y\n` +
    `property float z\n` +
    `property float f_dc_0\n` +
    `property float f_dc_1\n` +
    `property float f_dc_2\n` +
    `property float opacity\n` +
    `property float scale_0\n` +
    `property float scale_1\n` +
    `property float scale_2\n` +
    `property float rot_0\n` +
    `property float rot_1\n` +
    `property float rot_2\n` +
    `property float rot_3\n` +
    (hasBones ? `property uchar bone_index\n` : '') +
    `end_header\n`;

  const headerBytes = new TextEncoder().encode(header);
  const bytesPerVertex = 14 * 4 + (hasBones ? 1 : 0);
  const bodyBytes = count * bytesPerVertex;
  const buffer = new ArrayBuffer(headerBytes.length + bodyBytes);
  const uint8 = new Uint8Array(buffer);
  uint8.set(headerBytes, 0);
  const view = new DataView(buffer);

  let offset = headerBytes.length;
  const halfW = gridWidth / 2;
  // Scale: log(0.5 / n) so each sub-gaussian is 1/n the size of the voxel
  const subScale = Math.log(0.5) - Math.log(n);

  // Find max Y for centering vertically
  let maxY = 0;
  for (const [key] of entries) {
    const [, vy] = parseKey(key);
    if (vy > maxY) maxY = vy;
  }
  const halfH = maxY / 2;

  for (const [key, voxel] of entries) {
    const [vx, vy, vz] = parseKey(key);

    // SH DC coefficients (color as 0..1 scaled by SH factor)
    const shFactor = 0.2820947917738781; // 0.5 / sqrt(pi)
    const sh0 = (voxel.color[0] / 255 - 0.5) / shFactor;
    const sh1 = (voxel.color[1] / 255 - 0.5) / shFactor;
    const sh2 = (voxel.color[2] / 255 - 0.5) / shFactor;

    // Opacity (pre-sigmoid: use a high value for opaque voxels)
    const alpha = voxel.color[3] / 255;
    const logitOpacity = Math.log(Math.max(alpha, 0.001) / Math.max(1 - alpha, 0.001));

    const bone = boneMap ? (boneMap.get(key) ?? 0) : 0;

    for (let sx = 0; sx < n; sx++) {
      for (let sy = 0; sy < n; sy++) {
        for (let sz = 0; sz < n; sz++) {
          // Center X and Y, depth along +Z
          // Sub-gaussian position: centered within the subdivided cell
          const px = (vx + (sx + 0.5) / n - 0.5) - halfW;
          const py = (vy + (sy + 0.5) / n - 0.5) - halfH;
          const pz = vz + (sz + 0.5) / n - 0.5;

          view.setFloat32(offset, px, true); offset += 4;
          view.setFloat32(offset, py, true); offset += 4;
          view.setFloat32(offset, pz, true); offset += 4;

          view.setFloat32(offset, sh0, true); offset += 4;
          view.setFloat32(offset, sh1, true); offset += 4;
          view.setFloat32(offset, sh2, true); offset += 4;

          view.setFloat32(offset, logitOpacity, true); offset += 4;

          // Scale (pre-exp: log(0.5/n))
          view.setFloat32(offset, subScale, true); offset += 4;
          view.setFloat32(offset, subScale, true); offset += 4;
          view.setFloat32(offset, subScale, true); offset += 4;

          // Rotation quaternion (identity)
          view.setFloat32(offset, 1, true); offset += 4;
          view.setFloat32(offset, 0, true); offset += 4;
          view.setFloat32(offset, 0, true); offset += 4;
          view.setFloat32(offset, 0, true); offset += 4;

          // Bone index (optional)
          if (boneMap) {
            view.setUint8(offset, bone);
            offset += 1;
          }
        }
      }
    }
  }

  return new Blob([buffer], { type: 'application/octet-stream' });
}
