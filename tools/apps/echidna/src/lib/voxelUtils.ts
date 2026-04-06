import type { VoxelKey, Voxel } from '../store/types.js';

export function voxelKey(x: number, y: number, z: number): VoxelKey {
  return `${x},${y},${z}`;
}

export function parseKey(key: VoxelKey): [number, number, number] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

export function brushPositions(
  cx: number,
  cy: number,
  cz: number,
  size: number,
): [number, number, number][] {
  const positions: [number, number, number][] = [];
  const r = Math.floor(size / 2);
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      positions.push([cx + dx, cy, cz + dz]);
    }
  }
  return positions;
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export function floodFill3D(voxels: Map<VoxelKey, Voxel>, startKey: VoxelKey): VoxelKey[] {
  const startVoxel = voxels.get(startKey);
  if (!startVoxel) return [];
  const targetColor = startVoxel.color;
  const visited = new Set<VoxelKey>();
  const result: VoxelKey[] = [];
  const queue: VoxelKey[] = [startKey];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const voxel = voxels.get(key);
    if (!voxel) continue;
    if (voxel.color[0] !== targetColor[0] || voxel.color[1] !== targetColor[1] ||
        voxel.color[2] !== targetColor[2] || voxel.color[3] !== targetColor[3]) continue;
    result.push(key);
    const [x, y, z] = parseKey(key);
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nk = voxelKey(x + dx, y + dy, z + dz);
      if (!visited.has(nk)) queue.push(nk);
    }
  }
  return result;
}

export function extrudeLayer(
  voxels: Map<VoxelKey, Voxel>,
  keys: VoxelKey[],
  dy: number,
): { x: number; y: number; z: number; color: [number, number, number, number] }[] {
  const result: { x: number; y: number; z: number; color: [number, number, number, number] }[] = [];
  for (const key of keys) {
    const voxel = voxels.get(key);
    if (!voxel) continue;
    const [x, y, z] = parseKey(key);
    result.push({ x, y: y + dy, z, color: [...voxel.color] });
  }
  return result;
}
