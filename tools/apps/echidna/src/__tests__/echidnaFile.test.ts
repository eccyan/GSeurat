import { describe, it, expect } from 'vitest';
import { migrateEchidnaFile, slugifyAssetId, ECHIDNA_FILE_VERSION, type EchidnaFile } from '../store/types.js';

describe('slugifyAssetId', () => {
  it('lowercases and replaces whitespace with underscores', () => {
    expect(slugifyAssetId('Walker Bot')).toBe('walker_bot');
    expect(slugifyAssetId('  Hello   World  ')).toBe('hello_world');
  });
  it('strips characters outside [a-z0-9_-]', () => {
    expect(slugifyAssetId('Cat/Dog#1')).toBe('catdog1');
    expect(slugifyAssetId('  Déjà Vu  ')).toBe('dj_vu');  // strips accented + ends up no-underscore run
  });
  it('preserves hyphens and underscores', () => {
    expect(slugifyAssetId('cool-guy_v2')).toBe('cool-guy_v2');
  });
  it('falls back to "asset" when empty or all stripped', () => {
    expect(slugifyAssetId('')).toBe('asset');
    expect(slugifyAssetId('   ')).toBe('asset');
    expect(slugifyAssetId('###')).toBe('asset');
  });
});

describe('migrateEchidnaFile', () => {
  it('adds id by slugifying characterName for legacy v2 file with no id', () => {
    const old = {
      version: 2,
      characterName: 'Walker Bot',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
    };
    const migrated = migrateEchidnaFile(old);
    expect(migrated.version).toBe(ECHIDNA_FILE_VERSION);
    expect(migrated.version).toBe(5);
    expect(migrated.id).toBe('walker_bot');
  });

  it('preserves an existing id on current-version file', () => {
    const file = {
      version: 3,
      id: 'walker',
      characterName: 'Walker Bot',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
    };
    const migrated = migrateEchidnaFile(file);
    expect(migrated.id).toBe('walker');
    expect(migrated.characterName).toBe('Walker Bot');
  });

  it('migrates even when characterName is missing, falling back to "asset"', () => {
    const old = { version: 2, gridWidth: 32, gridDepth: 32, voxels: [], parts: [], poses: {} };
    const migrated = migrateEchidnaFile(old);
    expect(migrated.id).toBe('asset');
  });

  it('preserves animations field when present', () => {
    const old = {
      version: 2,
      characterName: 'Walker',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
      animations: { walk: { duration: 1.0, keyframes: [] } },
    };
    const migrated = migrateEchidnaFile(old);
    expect(migrated.animations).toEqual({ walk: { duration: 1.0, keyframes: [] } });
  });

  it('throws on null/undefined/non-object input', () => {
    expect(() => migrateEchidnaFile(null)).toThrow();
    expect(() => migrateEchidnaFile(undefined)).toThrow();
    expect(() => migrateEchidnaFile(42)).toThrow();
    expect(() => migrateEchidnaFile('string')).toThrow();
  });

  it('seeds color_palettes with a 256-slot default when absent', () => {
    const old = {
      version: 2,
      characterName: 'Walker',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
    };
    const migrated = migrateEchidnaFile(old);
    expect(migrated.color_palettes).toBeDefined();
    expect(migrated.color_palettes!.length).toBe(1);
    expect(migrated.color_palettes![0].colors.length).toBe(256);
    // First 16 slots should be grayscale (r === g === b)
    for (let i = 0; i < 16; i++) {
      const [r, g, b, a] = migrated.color_palettes![0].colors[i];
      expect(r).toBe(g);
      expect(g).toBe(b);
      expect(a).toBe(255);
    }
  });

  it('preserves existing color_palettes when present', () => {
    const file = {
      version: 5,
      id: 'walker',
      characterName: 'Walker',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
      color_palettes: [{ name: 'Custom', colors: [[10, 20, 30, 255]] }],
    };
    const migrated = migrateEchidnaFile(file);
    expect(migrated.color_palettes).toEqual([{ name: 'Custom', colors: [[10, 20, 30, 255]] }]);
  });
});
