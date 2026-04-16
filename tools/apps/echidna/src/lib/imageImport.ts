import type { Voxel, VoxelKey, BodyPart } from '../store/types.js';
import { voxelKey, parseKey } from './voxelUtils.js';

export interface ImageImportResult {
  voxels: Map<VoxelKey, Voxel>;
  parts: BodyPart[];
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function downscaleImageData(img: ImageData, maxWidth: number): ImageData {
  if (img.width <= maxWidth) return img;
  const scale = maxWidth / img.width;
  const newW = maxWidth;
  const newH = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(newW * newH * 4);
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(Math.floor(x / scale), img.width - 1);
      const srcY = Math.min(Math.floor(y / scale), img.height - 1);
      const si = (srcY * img.width + srcX) * 4;
      const di = (y * newW + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  }
  return { data: out, width: newW, height: newH, colorSpace: img.colorSpace } as ImageData;
}

function downscaleDepthMap(
  depthMap: Float32Array, srcW: number, srcH: number, dstW: number, dstH: number,
): Float32Array {
  if (srcW === dstW && srcH === dstH) return depthMap;
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  const out = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(Math.floor(x * scaleX), srcW - 1);
      const sy = Math.min(Math.floor(y * scaleY), srcH - 1);
      out[y * dstW + x] = depthMap[sy * srcW + sx];
    }
  }
  return out;
}

export function imageToVoxels(
  imageData: ImageData, depthMap: Float32Array,
  gridWidth: number, gridDepth: number, budget?: number,
): ImageImportResult {
  const scaled = downscaleImageData(imageData, gridWidth);
  const scaledDepth = downscaleDepthMap(depthMap, imageData.width, imageData.height, scaled.width, scaled.height);
  const w = scaled.width;
  const h = scaled.height;
  const voxels = new Map<VoxelKey, Voxel>();

  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const idx = (iy * w + ix) * 4;
      const r = scaled.data[idx], g = scaled.data[idx + 1], b = scaled.data[idx + 2], a = scaled.data[idx + 3];
      if (a < 10) continue;
      const vy = h - 1 - iy;
      const depth = scaledDepth[iy * w + ix] ?? 0;
      const colHeight = Math.max(1, Math.round(depth * gridDepth));
      for (let z = 0; z < colHeight; z++) {
        voxels.set(voxelKey(ix, vy, z), { color: [r, g, b, a] });
      }
    }
  }

  // Surface culling: remove fully-enclosed voxels
  const toDelete: VoxelKey[] = [];
  for (const key of voxels.keys()) {
    const [x, y, z] = parseKey(key);
    if (NEIGHBORS.every(([dx, dy, dz]) => voxels.has(voxelKey(x + dx, y + dy, z + dz)))) toDelete.push(key);
  }
  for (const key of toDelete) voxels.delete(key);

  // Budget enforcement
  if (budget && budget > 0 && voxels.size > budget) {
    const entries = Array.from(voxels.entries());
    const stride = Math.ceil(entries.length / budget);
    voxels.clear();
    for (let i = 0; i < entries.length; i += stride) voxels.set(entries[i][0], entries[i][1]);
  }

  const allKeys = Array.from(voxels.keys());
  let jx = 0, jy = 0, jz = 0;
  for (const key of allKeys) { const [x, y, z] = parseKey(key); jx += x; jy += y; jz += z; }
  const n = allKeys.length || 1;
  const parts: BodyPart[] = [{
    id: 'root', name: 'root', parent: null,
    joint: [Math.round(jx / n), Math.round(jy / n), Math.round(jz / n)],
    voxelKeys: allKeys,
  }];

  return { voxels, parts };
}
