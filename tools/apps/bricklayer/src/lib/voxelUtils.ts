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

export function floodFill3D(
  voxels: Map<VoxelKey, Voxel>,
  startX: number,
  startY: number,
  startZ: number,
  targetColor: [number, number, number, number],
  fillColor: [number, number, number, number],
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): VoxelKey[] {
  if (colorsEqual(targetColor, fillColor)) return [];

  const filled: VoxelKey[] = [];
  const stack: [number, number, number][] = [[startX, startY, startZ]];
  const visited = new Set<VoxelKey>();

  while (stack.length > 0) {
    const [x, y, z] = stack.pop()!;
    const key = voxelKey(x, y, z);

    if (visited.has(key)) continue;
    if (x < bounds.minX || x > bounds.maxX) continue;
    if (y < bounds.minY || y > bounds.maxY) continue;
    if (z < bounds.minZ || z > bounds.maxZ) continue;

    visited.add(key);

    const existing = voxels.get(key);
    const existingColor: [number, number, number, number] = existing
      ? existing.color
      : [0, 0, 0, 0];

    if (!colorsEqual(existingColor, targetColor)) continue;

    filled.push(key);

    stack.push([x + 1, y, z], [x - 1, y, z]);
    stack.push([x, y + 1, z], [x, y - 1, z]);
    stack.push([x, y, z + 1], [x, y, z - 1]);
  }

  return filled;
}

function colorsEqual(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function collisionKey(x: number, z: number): string {
  return `${x},${z}`;
}

export function autoCollisionFromVoxels(
  voxels: Map<VoxelKey, Voxel>,
): Set<string> {
  const occupied = new Set<string>();
  for (const key of voxels.keys()) {
    const [x, , z] = parseKey(key);
    occupied.add(collisionKey(x, z));
  }
  return occupied;
}
