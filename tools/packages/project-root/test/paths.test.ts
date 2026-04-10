import { describe, it, expect } from 'vitest';
import {
  toAssetPath,
  validateAssetRef,
  parseAssetRef,
  isAssetRef,
  type AssetRef,
} from '../src/paths';

describe('toAssetPath', () => {
  it('builds character paths', () => {
    expect(toAssetPath('characters', 'walker', 'walker.ply'))
      .toBe('assets/characters/walker/walker.ply');
  });

  it('builds vfx preset paths', () => {
    expect(toAssetPath('vfx', 'presets', 'explosion.vfx.json'))
      .toBe('assets/vfx/presets/explosion.vfx.json');
  });

  it('rejects empty parts', () => {
    expect(() => toAssetPath('characters', '')).toThrow(/empty/i);
  });

  it('rejects parts with separators', () => {
    expect(() => toAssetPath('characters', 'foo/bar')).toThrow(/separator/i);
  });

  it('rejects traversal', () => {
    expect(() => toAssetPath('characters', '..', 'evil')).toThrow(/traversal/i);
  });

  it('rejects zero parts', () => {
    expect(() => toAssetPath('characters' as any)).toThrow(/at least one/i);
  });
});

describe('parseAssetRef / isAssetRef', () => {
  it('recognizes ID refs', () => {
    expect(parseAssetRef('#walker')).toEqual({ kind: 'id', id: 'walker' });
    expect(isAssetRef('#walker')).toBe(true);
  });

  it('recognizes path refs', () => {
    expect(parseAssetRef('assets/characters/walker/walker.ply'))
      .toEqual({ kind: 'path', path: 'assets/characters/walker/walker.ply' });
    expect(isAssetRef('assets/characters/walker/walker.ply')).toBe(true);
  });

  it('rejects bare filenames', () => {
    expect(() => parseAssetRef('walker.ply')).toThrow(/bare filename/i);
    expect(isAssetRef('walker.ply')).toBe(false);
  });

  it('rejects absolute paths (unix)', () => {
    expect(() => parseAssetRef('/Users/foo/walker.ply')).toThrow(/absolute/i);
    expect(isAssetRef('/Users/foo/walker.ply')).toBe(false);
  });

  it('rejects absolute paths (windows)', () => {
    expect(() => parseAssetRef('C:/foo/walker.ply')).toThrow(/absolute/i);
    expect(() => parseAssetRef('D:\\foo\\walker.ply')).toThrow(/absolute/i);
  });

  it('rejects traversal', () => {
    expect(() => parseAssetRef('assets/../evil')).toThrow(/traversal/i);
    expect(() => parseAssetRef('assets/foo/../../etc/passwd')).toThrow(/traversal/i);
  });

  it('rejects single-dot segment', () => {
    expect(() => parseAssetRef('assets/./characters/walker.ply')).toThrow(/traversal/i);
  });

  it('rejects "assets/" with no further segments', () => {
    expect(() => parseAssetRef('assets/')).toThrow(/at least two segments/i);
  });

  it('rejects "assets/kind" without a name', () => {
    expect(() => parseAssetRef('assets/characters')).toThrow(/at least two segments/i);
  });

  it('accepts dots inside a path segment', () => {
    // walker..v2 is a legitimate directory name, not traversal
    expect(isAssetRef('assets/characters/walker..v2/walker.ply')).toBe(true);
  });

  it('rejects tools_data paths as asset refs', () => {
    expect(() => parseAssetRef('tools_data/bricklayer/scene.bricklayer')).toThrow(/asset path/i);
  });

  it('rejects empty id after hash', () => {
    expect(() => parseAssetRef('#')).toThrow(/invalid id/i);
  });

  it('rejects id containing separator', () => {
    expect(() => parseAssetRef('#foo/bar')).toThrow(/invalid id/i);
  });

  it('rejects empty string', () => {
    expect(() => parseAssetRef('')).toThrow(/empty/i);
  });
});

describe('validateAssetRef', () => {
  it('returns null for valid', () => {
    expect(validateAssetRef('#walker')).toBeNull();
    expect(validateAssetRef('assets/foo/bar.ply')).toBeNull();
  });

  it('returns error message for invalid', () => {
    expect(validateAssetRef('walker.ply')).toMatch(/bare filename/i);
    expect(validateAssetRef('/abs/walker.ply')).toMatch(/absolute/i);
  });
});
