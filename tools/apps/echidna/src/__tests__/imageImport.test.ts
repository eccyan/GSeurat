import { describe, it, expect } from 'vitest';
import { imageToVoxels } from '../lib/imageImport.js';
import { parseKey } from '../lib/voxelUtils.js';

function makeImageData(w: number, h: number, fill: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('imageToVoxels', () => {
  it('creates voxel columns from depth map', () => {
    const img = makeImageData(4, 4, [255, 0, 0, 255]);
    const depthMap = new Float32Array(4 * 4).fill(0.5);
    const result = imageToVoxels(img, depthMap, 4, 8);
    expect(result.voxels.size).toBeGreaterThan(0);
    expect(result.voxels.size).toBeLessThanOrEqual(64);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].id).toBe('root');
  });

  it('skips transparent pixels', () => {
    const img = makeImageData(2, 2, [0, 0, 0, 0]);
    const depthMap = new Float32Array(4).fill(1.0);
    const result = imageToVoxels(img, depthMap, 2, 8);
    expect(result.voxels.size).toBe(0);
  });

  it('preserves pixel colors', () => {
    const img = makeImageData(1, 1, [100, 150, 200, 255]);
    const depthMap = new Float32Array([0.25]);
    const result = imageToVoxels(img, depthMap, 1, 4);
    expect(result.voxels.size).toBe(1);
    const voxel = result.voxels.values().next().value!;
    expect(voxel.color).toEqual([100, 150, 200, 255]);
  });

  it('downscales image to fit gridWidth', () => {
    const img = makeImageData(8, 8, [255, 0, 0, 255]);
    const depthMap = new Float32Array(8 * 8).fill(0.1);
    const result = imageToVoxels(img, depthMap, 4, 4);
    for (const key of result.voxels.keys()) {
      const [x, y] = parseKey(key);
      expect(x).toBeLessThan(4);
      expect(y).toBeLessThan(4);
    }
  });

  it('enforces voxel budget', () => {
    const img = makeImageData(16, 16, [255, 0, 0, 255]);
    const depthMap = new Float32Array(16 * 16).fill(1.0);
    const result = imageToVoxels(img, depthMap, 16, 32, 100);
    expect(result.voxels.size).toBeLessThanOrEqual(100);
  });
});
