import { describe, it, expect } from 'vitest';
import { parsePlyToVoxels } from '../lib/plyImport.js';
import { exportPly } from '../lib/plyExport.js';
import { voxelKey } from '../lib/voxelUtils.js';
import type { BodyPart, Voxel, VoxelKey } from '../store/types.js';

describe('parsePlyToVoxels', () => {
  it('imports a single-voxel unrigged PLY', async () => {
    const voxels = new Map<VoxelKey, Voxel>();
    voxels.set(voxelKey(5, 3, 5), { color: [255, 128, 64, 255] });
    const blob = exportPly(voxels, 10, 10);
    const buffer = await blob.arrayBuffer();
    const result = parsePlyToVoxels(buffer, 10);
    expect(result.voxels.size).toBeGreaterThanOrEqual(1);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].id).toBe('root');
  });

  it('imports rigged PLY and reconstructs parts', async () => {
    const voxels = new Map<VoxelKey, Voxel>();
    voxels.set(voxelKey(0, 0, 0), { color: [255, 0, 0, 255] });
    voxels.set(voxelKey(5, 5, 5), { color: [0, 255, 0, 255] });
    const parts: BodyPart[] = [
      { id: 'head', name: 'head', parent: null, joint: [0, 0, 0], voxelKeys: [voxelKey(0, 0, 0)] },
      { id: 'body', name: 'body', parent: null, joint: [0, 0, 0], voxelKeys: [voxelKey(5, 5, 5)] },
    ];
    const blob = exportPly(voxels, 10, 10, parts);
    const buffer = await blob.arrayBuffer();
    const result = parsePlyToVoxels(buffer, 10);
    expect(result.parts.length).toBe(2);
    expect(result.parts[0].voxelKeys.length).toBeGreaterThanOrEqual(1);
    expect(result.parts[1].voxelKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('auto-detects grid size from bounding box', async () => {
    const voxels = new Map<VoxelKey, Voxel>();
    voxels.set(voxelKey(0, 0, 0), { color: [255, 0, 0, 255] });
    voxels.set(voxelKey(30, 10, 30), { color: [0, 255, 0, 255] });
    const blob = exportPly(voxels, 32, 32);
    const buffer = await blob.arrayBuffer();
    const result = parsePlyToVoxels(buffer);
    expect(result.gridSize).toBeGreaterThanOrEqual(32);
  });
});
