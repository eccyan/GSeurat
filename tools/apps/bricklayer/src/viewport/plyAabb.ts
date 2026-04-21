export type Aabb = { min: [number, number, number]; max: [number, number, number] };

/**
 * Compute axis-aligned bounding box from a flat Float32Array of XYZ positions.
 * Returns null if the array is empty.
 */
export function computeAabbFromPositions(positions: Float32Array): Aabb | null {
  const count = positions.length / 3;
  if (count === 0) return null;

  let minX = positions[0], minY = positions[1], minZ = positions[2];
  let maxX = minX, maxY = minY, maxZ = minZ;

  for (let i = 1; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
