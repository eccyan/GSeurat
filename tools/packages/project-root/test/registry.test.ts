import { describe, it, expect } from 'vitest';
import {
  createEmptyRegistry,
  registerCharacter,
  registerVfx,
  registerTexture,
  registerAudio,
  registerMap,
  resolveRef,
  type AssetRegistry,
} from '../src/registry';

describe('AssetRegistry', () => {
  it('starts empty with version 1', () => {
    const r = createEmptyRegistry();
    expect(r.version).toBe(1);
    expect(Object.keys(r.characters)).toEqual([]);
    expect(Object.keys(r.vfx)).toEqual([]);
    expect(Object.keys(r.textures)).toEqual([]);
    expect(Object.keys(r.audio)).toEqual([]);
    expect(Object.keys(r.maps)).toEqual([]);
  });

  it('registers a character with ply and manifest', () => {
    const r0 = createEmptyRegistry();
    const r = registerCharacter(r0, 'walker', {
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    expect(r.characters.walker).toEqual({
      id: 'walker',
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    expect(r0.characters.walker).toBeUndefined();  // original unchanged
  });

  it('registers vfx, textures, audio, and maps', () => {
    let r = createEmptyRegistry();
    r = registerVfx(r, 'explosion', { file: 'assets/vfx/presets/explosion.vfx.json' });
    r = registerTexture(r, 'sky', { file: 'assets/textures/sky.png' });
    r = registerAudio(r, 'boom', { file: 'assets/audio/boom.wav' });
    r = registerMap(r, 'town', { file: 'assets/maps/town.ply' });

    expect(r.vfx.explosion).toEqual({ id: 'explosion', file: 'assets/vfx/presets/explosion.vfx.json' });
    expect(r.textures.sky).toEqual({ id: 'sky', file: 'assets/textures/sky.png' });
    expect(r.audio.boom).toEqual({ id: 'boom', file: 'assets/audio/boom.wav' });
    expect(r.maps.town).toEqual({ id: 'town', file: 'assets/maps/town.ply' });
  });

  it('register* overwrites an existing entry with the same id', () => {
    const r0 = createEmptyRegistry();
    const r1 = registerVfx(r0, 'explosion', { file: 'assets/vfx/presets/explosion_v1.vfx.json' });
    const r = registerVfx(r1, 'explosion', { file: 'assets/vfx/presets/explosion_v2.vfx.json' });
    expect(r.vfx.explosion.file).toBe('assets/vfx/presets/explosion_v2.vfx.json');
  });

  it('register* does not mutate the input registry', () => {
    const r0 = createEmptyRegistry();
    const r1 = registerVfx(r0, 'explosion', { file: 'assets/vfx/presets/explosion.vfx.json' });
    expect(r0.vfx.explosion).toBeUndefined();  // original unchanged
    expect(r1.vfx.explosion).toBeDefined();    // result has it
    expect(r1).not.toBe(r0);                   // new object identity
  });

  it('registerCharacter overwrites an existing entry with new ply and manifest', () => {
    const r0 = createEmptyRegistry();
    const r1 = registerCharacter(r0, 'walker', {
      ply: 'assets/characters/walker/walker_v1.ply',
      manifest: 'assets/characters/walker/walker_v1.manifest.json',
    });
    const r2 = registerCharacter(r1, 'walker', {
      ply: 'assets/characters/walker/walker_v2.ply',
      manifest: 'assets/characters/walker/walker_v2.manifest.json',
    });
    expect(r2.characters.walker.ply).toBe('assets/characters/walker/walker_v2.ply');
    expect(r2.characters.walker.manifest).toBe('assets/characters/walker/walker_v2.manifest.json');
  });
});

describe('resolveRef', () => {
  it('returns character manifest path by id', () => {
    const r0 = createEmptyRegistry();
    const r = registerCharacter(r0, 'walker', {
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    expect(resolveRef('#walker', 'character', r))
      .toBe('assets/characters/walker/walker.manifest.json');
  });

  it('returns vfx file path by id', () => {
    const r0 = createEmptyRegistry();
    const r = registerVfx(r0, 'explosion', { file: 'assets/vfx/presets/explosion.vfx.json' });
    expect(resolveRef('#explosion', 'vfx', r))
      .toBe('assets/vfx/presets/explosion.vfx.json');
  });

  it('returns texture path by id', () => {
    const r0 = createEmptyRegistry();
    const r = registerTexture(r0, 'sky', { file: 'assets/textures/sky.png' });
    expect(resolveRef('#sky', 'texture', r)).toBe('assets/textures/sky.png');
  });

  it('returns audio path by id', () => {
    const r0 = createEmptyRegistry();
    const r = registerAudio(r0, 'boom', { file: 'assets/audio/boom.wav' });
    expect(resolveRef('#boom', 'audio', r)).toBe('assets/audio/boom.wav');
  });

  it('returns map path by id', () => {
    const r0 = createEmptyRegistry();
    const r = registerMap(r0, 'town', { file: 'assets/maps/town.ply' });
    expect(resolveRef('#town', 'map', r)).toBe('assets/maps/town.ply');
  });

  it('returns the path for a path-typed ref (passthrough)', () => {
    const r = createEmptyRegistry();
    expect(resolveRef('assets/characters/walker/walker.manifest.json', 'character', r))
      .toBe('assets/characters/walker/walker.manifest.json');
  });

  it('passes path refs through without checking kind matches subdirectory', () => {
    const r = createEmptyRegistry();
    // A path ref is returned unchanged regardless of kind — kind only matters for #id lookups
    expect(resolveRef('assets/textures/sky.png', 'character', r))
      .toBe('assets/textures/sky.png');
  });

  it('throws on unknown id (characters)', () => {
    const r = createEmptyRegistry();
    expect(() => resolveRef('#missing', 'character', r)).toThrow(/unknown id.*character.*registry/i);
  });

  it('throws on unknown id (vfx)', () => {
    const r = createEmptyRegistry();
    expect(() => resolveRef('#missing', 'vfx', r)).toThrow(/unknown id.*vfx.*registry/i);
  });

  it('rejects bare filenames (delegates to parseAssetRef)', () => {
    const r = createEmptyRegistry();
    expect(() => resolveRef('walker.ply', 'character', r)).toThrow(/bare filename/i);
  });

  it('rejects absolute paths', () => {
    const r = createEmptyRegistry();
    expect(() => resolveRef('/abs/walker.ply', 'character', r)).toThrow(/absolute/i);
  });
});

describe('serialization round-trip', () => {
  it('serializes and deserializes without loss', () => {
    let r = createEmptyRegistry();
    r = registerCharacter(r, 'walker', {
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    r = registerVfx(r, 'explosion', { file: 'assets/vfx/presets/explosion.vfx.json' });
    const json = JSON.stringify(r);
    const parsed: AssetRegistry = JSON.parse(json);
    expect(parsed).toEqual(r);
    expect(parsed.version).toBe(1);
  });
});
