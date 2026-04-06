import { describe, it, expect } from 'vitest';
import { voxelKey, parseKey, brushPositions, floodFill3D, extrudeLayer } from '../lib/voxelUtils.js';
import type { Voxel, VoxelKey } from '../store/types.js';

describe('voxelKey / parseKey', () => {
  it('round-trips coordinates', () => {
    const key = voxelKey(3, 7, 11);
    expect(key).toBe('3,7,11');
    expect(parseKey(key)).toEqual([3, 7, 11]);
  });
});

describe('brushPositions', () => {
  it('size 1 returns single position', () => {
    expect(brushPositions(5, 3, 5, 1)).toEqual([[5, 3, 5]]);
  });
  it('size 3 returns 9 positions', () => {
    const pos = brushPositions(5, 3, 5, 3);
    expect(pos).toHaveLength(9);
  });
});

function makeVoxelMap(entries: [number, number, number, [number, number, number, number]][]): Map<VoxelKey, Voxel> {
  const map = new Map<VoxelKey, Voxel>();
  for (const [x, y, z, color] of entries) {
    map.set(voxelKey(x, y, z), { color: [...color] });
  }
  return map;
}

describe('floodFill3D', () => {
  const red: [number, number, number, number] = [255, 0, 0, 255];
  const blue: [number, number, number, number] = [0, 0, 255, 255];

  it('fills connected same-color voxels in 3D', () => {
    const voxels = makeVoxelMap([
      [0, 0, 0, red], [1, 0, 0, red], [2, 0, 0, red], [4, 0, 0, red],
    ]);
    const keys = floodFill3D(voxels, voxelKey(0, 0, 0));
    expect(keys).toHaveLength(3);
    expect(keys).toContain(voxelKey(0, 0, 0));
    expect(keys).toContain(voxelKey(1, 0, 0));
    expect(keys).toContain(voxelKey(2, 0, 0));
    expect(keys).not.toContain(voxelKey(4, 0, 0));
  });

  it('does not cross color boundaries', () => {
    const voxels = makeVoxelMap([[0, 0, 0, red], [1, 0, 0, blue], [2, 0, 0, red]]);
    const keys = floodFill3D(voxels, voxelKey(0, 0, 0));
    expect(keys).toHaveLength(1);
  });

  it('returns empty array for non-existent start', () => {
    expect(floodFill3D(new Map(), voxelKey(0, 0, 0))).toEqual([]);
  });
});

describe('extrudeLayer', () => {
  const red: [number, number, number, number] = [255, 0, 0, 255];

  it('extrudes voxels up by 1', () => {
    const voxels = makeVoxelMap([[0, 0, 0, red], [1, 0, 0, red]]);
    const result = extrudeLayer(voxels, [voxelKey(0, 0, 0), voxelKey(1, 0, 0)], 1);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ x: 0, y: 1, z: 0, color: red });
    expect(result).toContainEqual({ x: 1, y: 1, z: 0, color: red });
  });

  it('extrudes down by -1', () => {
    const voxels = makeVoxelMap([[0, 5, 0, red]]);
    const result = extrudeLayer(voxels, [voxelKey(0, 5, 0)], -1);
    expect(result).toHaveLength(1);
    expect(result).toContainEqual({ x: 0, y: 4, z: 0, color: red });
  });

  it('skips voxels not in the map', () => {
    const result = extrudeLayer(new Map(), [voxelKey(0, 0, 0)], 1);
    expect(result).toHaveLength(0);
  });
});
