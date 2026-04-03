import { describe, it, expect } from 'vitest';
import { exportPly } from '../lib/plyExport.js';
import { voxelKey } from '../lib/voxelUtils.js';
import type { Voxel, VoxelKey, BodyPart } from '../store/types.js';

/** Parse the vertex count from the PLY header text. */
async function getVertexCount(blob: Blob): Promise<number> {
  const buffer = await blob.arrayBuffer();
  const text = new TextDecoder().decode(buffer);
  const match = text.match(/element vertex (\d+)/);
  if (!match) throw new Error('No element vertex line found in PLY header');
  return Number(match[1]);
}

/** Parse all bone_index bytes from PLY binary body (assumes hasBones = true). */
async function getBoneIndices(blob: Blob): Promise<number[]> {
  const buffer = await blob.arrayBuffer();
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  // Find end of header
  const endHeaderIdx = text.indexOf('end_header\n');
  if (endHeaderIdx === -1) throw new Error('end_header not found');
  const headerLength = new TextEncoder().encode(text.slice(0, endHeaderIdx + 'end_header\n'.length)).length;

  const view = new DataView(buffer);
  // Each vertex: 14 floats (56 bytes) + 1 byte bone_index = 57 bytes
  const bytesPerVertex = 14 * 4 + 1;
  const totalBytes = buffer.byteLength - headerLength;
  const count = totalBytes / bytesPerVertex;

  const bones: number[] = [];
  for (let i = 0; i < count; i++) {
    const boneOffset = headerLength + i * bytesPerVertex + 14 * 4;
    bones.push(view.getUint8(boneOffset));
  }
  return bones;
}

/** Build a simple voxel map from a list of [x, y, z] positions with a given color. */
function makeVoxels(positions: [number, number, number][], color: [number, number, number, number] = [255, 128, 64, 255]): Map<VoxelKey, Voxel> {
  const map = new Map<VoxelKey, Voxel>();
  for (const [x, y, z] of positions) {
    map.set(voxelKey(x, y, z), { color });
  }
  return map;
}

describe('exportPly density parameter', () => {
  it('density 1 (default) → 1 vertex per surface voxel', async () => {
    // Single isolated voxel — all 6 faces exposed, so it is a surface voxel
    const voxels = makeVoxels([[0, 0, 0]]);
    const blob = exportPly(voxels, 10, 10);
    const count = await getVertexCount(blob);
    expect(count).toBe(1);
  });

  it('density 2 → 8 vertices per voxel', async () => {
    const voxels = makeVoxels([[0, 0, 0]]);
    const blob = exportPly(voxels, 10, 10, undefined, 2);
    const count = await getVertexCount(blob);
    expect(count).toBe(8);
  });

  it('density 3 → 27 vertices per voxel', async () => {
    const voxels = makeVoxels([[0, 0, 0]]);
    const blob = exportPly(voxels, 10, 10, undefined, 3);
    const count = await getVertexCount(blob);
    expect(count).toBe(27);
  });

  it('density 4 → 64 vertices per voxel', async () => {
    const voxels = makeVoxels([[0, 0, 0]]);
    const blob = exportPly(voxels, 10, 10, undefined, 4);
    const count = await getVertexCount(blob);
    expect(count).toBe(64);
  });

  it('default density (omitted) → 1 vertex per surface voxel', async () => {
    // Two isolated voxels — both surface voxels
    const voxels = makeVoxels([[0, 0, 0], [5, 5, 5]]);
    const blob = exportPly(voxels, 10, 10);
    const count = await getVertexCount(blob);
    expect(count).toBe(2);
  });

  it('bone_index preserved for all sub-gaussians with density 2', async () => {
    const voxels = new Map<VoxelKey, Voxel>();
    const key0 = voxelKey(0, 0, 0);
    const key1 = voxelKey(5, 5, 5);
    voxels.set(key0, { color: [255, 0, 0, 255] });
    voxels.set(key1, { color: [0, 255, 0, 255] });

    const parts: BodyPart[] = [
      { id: 'part_a', parent: null, joint: [0, 0, 0], voxelKeys: [key0] },
      { id: 'part_b', parent: null, joint: [0, 0, 0], voxelKeys: [key1] },
    ];

    const blob = exportPly(voxels, 10, 10, parts, 2);
    const count = await getVertexCount(blob);
    expect(count).toBe(16); // 2 voxels × 8 sub-gaussians

    const bones = await getBoneIndices(blob);
    expect(bones).toHaveLength(16);

    // 8 sub-gaussians for voxel 0 should all have bone 0,
    // 8 sub-gaussians for voxel 1 should all have bone 1
    // (order in output depends on map iteration order, but both groups should be uniform)
    const uniqueBones = new Set(bones);
    expect(uniqueBones.size).toBe(2);
    expect(uniqueBones.has(0)).toBe(true);
    expect(uniqueBones.has(1)).toBe(true);

    // Each group of 8 should be the same bone
    const firstBone = bones[0];
    for (let i = 1; i < 8; i++) {
      expect(bones[i]).toBe(firstBone);
    }
    const secondBone = bones[8];
    for (let i = 9; i < 16; i++) {
      expect(bones[i]).toBe(secondBone);
    }
    // The two groups must differ
    expect(firstBone).not.toBe(secondBone);
  });
});
