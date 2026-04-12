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
  it('falls back to "character" when empty or all stripped', () => {
    expect(slugifyAssetId('')).toBe('character');
    expect(slugifyAssetId('   ')).toBe('character');
    expect(slugifyAssetId('###')).toBe('character');
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
    expect(migrated.version).toBe(4);
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

  it('migrates even when characterName is missing, falling back to "character"', () => {
    const old = { version: 2, gridWidth: 32, gridDepth: 32, voxels: [], parts: [], poses: {} };
    const migrated = migrateEchidnaFile(old);
    expect(migrated.id).toBe('character');
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
});
