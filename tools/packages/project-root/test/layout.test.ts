import { describe, it, expect } from 'vitest';
import { PROJECT_LAYOUT, ASSET_KINDS, isToolsDataPath, isAssetPath } from '../src/layout';

describe('PROJECT_LAYOUT', () => {
  it('exposes asset subdirs', () => {
    expect(PROJECT_LAYOUT.assets.characters).toBe('assets/characters');
    expect(PROJECT_LAYOUT.assets.vfx).toBe('assets/vfx');
    expect(PROJECT_LAYOUT.assets.vfxPresets).toBe('assets/vfx/presets');
    expect(PROJECT_LAYOUT.assets.scenes).toBe('assets/scenes');
    expect(PROJECT_LAYOUT.assets.maps).toBe('assets/maps');
    expect(PROJECT_LAYOUT.assets.textures).toBe('assets/textures');
    expect(PROJECT_LAYOUT.assets.audio).toBe('assets/audio');
    expect(PROJECT_LAYOUT.assets.components).toBe('assets/components');
  });

  it('exposes tools_data subdirs', () => {
    expect(PROJECT_LAYOUT.toolsData.bricklayer).toBe('tools_data/bricklayer');
    expect(PROJECT_LAYOUT.toolsData.melies).toBe('tools_data/melies_projects');
    expect(PROJECT_LAYOUT.toolsData.echidnaSaves).toBe('tools_data/echidna_saves');
    expect(PROJECT_LAYOUT.toolsData.cache).toBe('tools_data/cache');
  });

  it('lists asset kinds', () => {
    expect(ASSET_KINDS).toContain('characters');
    expect(ASSET_KINDS).toContain('vfx');
    expect(ASSET_KINDS).toContain('maps');
  });
});

describe('classifiers', () => {
  it('isAssetPath', () => {
    expect(isAssetPath('assets/characters/walker/walker.ply')).toBe(true);
    expect(isAssetPath('tools_data/bricklayer/scene.bricklayer')).toBe(false);
    expect(isAssetPath('walker.ply')).toBe(false);
  });

  it('isToolsDataPath', () => {
    expect(isToolsDataPath('tools_data/echidna_saves/walker.echidna')).toBe(true);
    expect(isToolsDataPath('assets/scenes/town.json')).toBe(false);
  });
});
