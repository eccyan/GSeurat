import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { voxelKey } from '../lib/voxelUtils.js';
import type { Asset, BodyPart } from '../store/types.js';

function makeAsset(): Asset {
  const parts: BodyPart[] = [
    { id: 'root', name: 'root', parent: null, joint: [0, 0, 0], voxelKeys: [] },
    { id: 'head', name: 'head', parent: 'root', joint: [0, 10, 0], voxelKeys: [voxelKey(1, 1, 1), voxelKey(2, 2, 2)] },
    { id: 'torso', name: 'torso', parent: 'root', joint: [0, 5, 0], voxelKeys: [voxelKey(3, 3, 3)] },
  ];
  const voxels = new Map();
  for (const p of parts) for (const k of p.voxelKeys) voxels.set(k, { color: [255, 0, 0, 255] });
  return {
    id: 'test',
    kind: 'character',
    characterName: 'Test',
    gridWidth: 32,
    gridDepth: 32,
    voxels,
    characterParts: parts,
    characterPoses: {},
    animations: {},
    tags: [],
    currentFilename: null,
  };
}

describe('unassignVoxelsFromPart', () => {
  beforeEach(() => {
    useCharacterStore.setState({ asset: makeAsset(), mirrorAxis: null });
  });

  it('removes voxels from the target bone', () => {
    useCharacterStore.getState().unassignVoxelsFromPart([voxelKey(1, 1, 1)], 'head');
    const head = useCharacterStore.getState().asset!.characterParts.find((p) => p.id === 'head')!;
    expect(head.voxelKeys).toEqual([voxelKey(2, 2, 2)]);
  });

  it('does nothing when voxel is not in target bone', () => {
    // voxel (3,3,3) is in torso, not head
    useCharacterStore.getState().unassignVoxelsFromPart([voxelKey(3, 3, 3)], 'head');
    const torso = useCharacterStore.getState().asset!.characterParts.find((p) => p.id === 'torso')!;
    expect(torso.voxelKeys).toEqual([voxelKey(3, 3, 3)]);
  });

  it('does nothing for non-existent target bone', () => {
    expect(() => {
      useCharacterStore.getState().unassignVoxelsFromPart([voxelKey(1, 1, 1)], 'nonexistent');
    }).not.toThrow();
    const head = useCharacterStore.getState().asset!.characterParts.find((p) => p.id === 'head')!;
    expect(head.voxelKeys).toEqual([voxelKey(1, 1, 1), voxelKey(2, 2, 2)]);
  });

  it('empty keys array is no-op', () => {
    useCharacterStore.getState().unassignVoxelsFromPart([], 'head');
    const head = useCharacterStore.getState().asset!.characterParts.find((p) => p.id === 'head')!;
    expect(head.voxelKeys).toEqual([voxelKey(1, 1, 1), voxelKey(2, 2, 2)]);
  });

  it('marks dirty', () => {
    useCharacterStore.setState({ dirty: false });
    useCharacterStore.getState().unassignVoxelsFromPart([voxelKey(1, 1, 1)], 'head');
    expect(useCharacterStore.getState().dirty).toBe(true);
  });
});
