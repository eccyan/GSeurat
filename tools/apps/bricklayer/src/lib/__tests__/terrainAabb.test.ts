import { describe, it, expect } from 'vitest';
import { computeAabbFromPositions } from '../../viewport/plyAabb';

describe('computeAabbFromPositions', () => {
  it('computes min/max from a Float32Array of xyz positions', () => {
    // 3 vertices: (1,2,3), (-4,5,-6), (7,-8,9)
    const positions = new Float32Array([1, 2, 3, -4, 5, -6, 7, -8, 9]);
    const aabb = computeAabbFromPositions(positions);
    expect(aabb).toEqual({
      min: [-4, -8, -6],
      max: [7, 5, 9],
    });
  });

  it('handles single vertex', () => {
    const positions = new Float32Array([10, 20, 30]);
    const aabb = computeAabbFromPositions(positions);
    expect(aabb).toEqual({
      min: [10, 20, 30],
      max: [10, 20, 30],
    });
  });

  it('returns null for empty array', () => {
    const positions = new Float32Array(0);
    const aabb = computeAabbFromPositions(positions);
    expect(aabb).toBeNull();
  });
});
