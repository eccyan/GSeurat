import type { VoxelKey, Voxel } from '../store/types.js';
import { parseKey } from './voxelUtils.js';

export function exportPly(
  voxels: Map<VoxelKey, Voxel>,
  gridWidth: number,
  gridDepth: number,
): Blob {
  const entries = Array.from(voxels.entries());
  const count = entries.length;

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
    `end_header\n`;

  const headerBytes = new TextEncoder().encode(header);
  const floatsPerVertex = 14;
  const bodyBytes = count * floatsPerVertex * 4;
  const buffer = new ArrayBuffer(headerBytes.length + bodyBytes);
  const uint8 = new Uint8Array(buffer);
  uint8.set(headerBytes, 0);
  const view = new DataView(buffer);

  let offset = headerBytes.length;
  const halfW = gridWidth / 2;
  const halfD = gridDepth / 2;
  const voxelScale = Math.log(0.5);

  for (const [key, voxel] of entries) {
    const [vx, vy, vz] = parseKey(key);

    // Bricklayer → PLY coordinate transform
    const px = vx - halfW;
    const py = gridDepth / 2 - vz;
    const pz = vy;

    view.setFloat32(offset, px, true); offset += 4;
    view.setFloat32(offset, py, true); offset += 4;
    view.setFloat32(offset, pz, true); offset += 4;

    // SH DC coefficients (color as 0..1 scaled by SH factor)
    const shFactor = 0.2820947917738781; // 0.5 / sqrt(pi)
    view.setFloat32(offset, (voxel.color[0] / 255 - 0.5) / shFactor, true); offset += 4;
    view.setFloat32(offset, (voxel.color[1] / 255 - 0.5) / shFactor, true); offset += 4;
    view.setFloat32(offset, (voxel.color[2] / 255 - 0.5) / shFactor, true); offset += 4;

    // Opacity (pre-sigmoid: use a high value for opaque voxels)
    const alpha = voxel.color[3] / 255;
    const logitOpacity = Math.log(Math.max(alpha, 0.001) / Math.max(1 - alpha, 0.001));
    view.setFloat32(offset, logitOpacity, true); offset += 4;

    // Scale (pre-exp: log of half-voxel-size)
    view.setFloat32(offset, voxelScale, true); offset += 4;
    view.setFloat32(offset, voxelScale, true); offset += 4;
    view.setFloat32(offset, voxelScale, true); offset += 4;

    // Rotation quaternion (identity)
    view.setFloat32(offset, 1, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
  }

  return new Blob([buffer], { type: 'application/octet-stream' });
}
