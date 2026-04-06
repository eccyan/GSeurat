import { describe, it, expect } from 'vitest';
import { parseObjToVoxels } from '../lib/objImport.js';

const TRIANGLE_OBJ = `
v 0 0 0
v 5 0 0
v 0 5 0
f 1 2 3
`;

const CUBE_OBJ = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;

describe('parseObjToVoxels', () => {
  it('produces voxels from a triangle', () => {
    const result = parseObjToVoxels(TRIANGLE_OBJ, 16);
    expect(result.voxels.size).toBeGreaterThan(0);
    expect(result.gridSize).toBe(16);
  });

  it('produces voxels for a cube', () => {
    const result = parseObjToVoxels(CUBE_OBJ, 8);
    expect(result.voxels.size).toBeGreaterThan(0);
  });

  it('returns a single root part', () => {
    const result = parseObjToVoxels(TRIANGLE_OBJ, 16);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].id).toBe('root');
  });
});
