import { describe, it, expect } from 'vitest';
import { migrateBricklayerFile } from '../migrateBricklayerFile';

describe('migrateBricklayerFile', () => {
  it('upgrades v1 with no assets to v2 with empty registry', () => {
    const v1 = {
      version: 1,
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      collision: [],
      scene: {},
    };
    const v2 = migrateBricklayerFile(v1);
    expect(v2.version).toBe(2);
    expect(v2.asset_registry.version).toBe(1);
    expect(Object.keys(v2.asset_registry.characters)).toEqual([]);
    expect(Object.keys(v2.asset_registry.maps)).toEqual([]);
  });

  it('synthesizes registry entries from v1 flat assets[]', () => {
    const v1 = {
      version: 1,
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      collision: [],
      assets: [
        { id: 'house', name: 'House', type: 'ply', path: 'assets/maps/house.ply' },
        { id: 'sky', name: 'Sky', type: 'texture', path: 'assets/textures/sky.png' },
        { id: 'beep', name: 'Beep', type: 'audio', path: 'assets/audio/beep.wav' },
      ],
      scene: {},
    };
    const v2 = migrateBricklayerFile(v1);
    expect(v2.asset_registry.maps.house?.file).toBe('assets/maps/house.ply');
    expect(v2.asset_registry.textures.sky?.file).toBe('assets/textures/sky.png');
    expect(v2.asset_registry.audio.beep?.file).toBe('assets/audio/beep.wav');
  });

  it('synthesizes character entries when ply path lives under assets/characters/', () => {
    const v1 = {
      version: 1,
      gridWidth: 32, gridDepth: 32, voxels: [], collision: [],
      assets: [
        { id: 'walker', name: 'Walker', type: 'ply', path: 'assets/characters/walker/walker.ply' },
      ],
      scene: {},
    };
    const v2 = migrateBricklayerFile(v1);
    expect(v2.asset_registry.characters.walker?.ply).toBe('assets/characters/walker/walker.ply');
    expect(v2.asset_registry.characters.walker?.manifest).toBe('assets/characters/walker/walker.manifest.json');
    // Maps should NOT contain it
    expect(v2.asset_registry.maps.walker).toBeUndefined();
  });

  it('skips assets with non-asset paths', () => {
    const v1 = {
      version: 1,
      gridWidth: 32, gridDepth: 32, voxels: [], collision: [],
      assets: [
        { id: 'evil', name: 'Evil', type: 'ply', path: '/abs/evil.ply' },           // absolute
        { id: 'bare', name: 'Bare', type: 'ply', path: 'walker.ply' },              // bare filename
      ],
      scene: {},
    };
    const v2 = migrateBricklayerFile(v1);
    expect(Object.keys(v2.asset_registry.maps)).toEqual([]);
    expect(Object.keys(v2.asset_registry.characters)).toEqual([]);
  });

  it('passes v2 through unchanged', () => {
    const v2 = {
      version: 2,
      asset_registry: {
        version: 1,
        characters: {},
        vfx: {},
        textures: {},
        audio: {},
        maps: {},
      },
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      collision: [],
      scene: {},
    };
    const result = migrateBricklayerFile(v2);
    expect(result.version).toBe(2);
    expect(result.asset_registry).toEqual(v2.asset_registry);
  });

  it('throws on unknown version', () => {
    expect(() => migrateBricklayerFile({ version: 99, scene: {} })).toThrow(/unknown.*version|version 99/i);
  });

  it('throws on non-object input', () => {
    expect(() => migrateBricklayerFile(null)).toThrow();
    expect(() => migrateBricklayerFile(42)).toThrow();
  });

  it('preserves voxels, collision, and scene through migration', () => {
    const v1 = {
      version: 1,
      gridWidth: 16, gridDepth: 24,
      voxels: [{ x: 1, y: 2, z: 3, r: 100, g: 100, b: 100, a: 255 }],
      collision: ['some-string'],
      scene: { ambientColor: [0.5, 0.5, 0.5, 1.0] },
    };
    const v2 = migrateBricklayerFile(v1);
    expect(v2.gridWidth).toBe(16);
    expect(v2.gridDepth).toBe(24);
    expect(v2.voxels).toHaveLength(1);
    expect(v2.collision).toEqual(['some-string']);
    expect(v2.scene).toEqual({ ambientColor: [0.5, 0.5, 0.5, 1.0] });
  });
});
