import { describe, it, expect } from 'vitest';
import {
  slugifyProjectName,
  meliesProjectPath,
  vfxPresetPath,
  migrateVfxProject,
  listObjectPlys,
} from '../projectIO';
import { VFX_PROJECT_VERSION } from '../../store/types';
import { testing } from '@gseurat/project-root';

describe('slugifyProjectName', () => {
  it('lowercases and replaces whitespace with underscores', () => {
    expect(slugifyProjectName('Forest Demo')).toBe('forest_demo');
    expect(slugifyProjectName('  Hello   World  ')).toBe('hello_world');
  });
  it('strips characters outside [a-z0-9_-]', () => {
    expect(slugifyProjectName('Cool/Effect#1')).toBe('cooleffect1');
  });
  it('preserves hyphens and underscores', () => {
    expect(slugifyProjectName('forest-demo_v2')).toBe('forest-demo_v2');
  });
  it('falls back to "project" when empty or all stripped', () => {
    expect(slugifyProjectName('')).toBe('project');
    expect(slugifyProjectName('   ')).toBe('project');
    expect(slugifyProjectName('###')).toBe('project');
  });
});

describe('meliesProjectPath', () => {
  it('places project under tools_data/melies_projects/{slug}.json', () => {
    expect(meliesProjectPath('Forest Demo'))
      .toBe('tools_data/melies_projects/forest_demo.json');
  });
});

describe('vfxPresetPath', () => {
  it('places preset under assets/vfx/presets/{slug}.vfx.json', () => {
    expect(vfxPresetPath('Particle Burst'))
      .toBe('assets/vfx/presets/particle_burst.vfx.json');
  });
  it('slugifies names with special chars', () => {
    expect(vfxPresetPath('Cool/Effect#1'))
      .toBe('assets/vfx/presets/cooleffect1.vfx.json');
  });
});

describe('migrateVfxProject', () => {
  it('upgrades v2 to current', () => {
    const v2 = {
      version: 2,
      presets: [{ id: 'p1', name: 'Test', elements: [] }],
    };
    const migrated = migrateVfxProject(v2);
    expect(migrated.version).toBe(VFX_PROJECT_VERSION);
    expect(migrated.presets).toHaveLength(1);
  });

  it('passes current-version through', () => {
    const current = { version: VFX_PROJECT_VERSION, presets: [] };
    const migrated = migrateVfxProject(current);
    expect(migrated.version).toBe(VFX_PROJECT_VERSION);
  });

  it('migrates legacy v1 with `layers` field to current', () => {
    const v1 = {
      version: 1,
      presets: [{ id: 'p1', name: 'Test', layers: [{ id: 'l1', name: 'L', type: 'emitter' }] }],
    };
    const migrated = migrateVfxProject(v1);
    expect(migrated.version).toBe(VFX_PROJECT_VERSION);
    // v1 migration keeps the `layers` key (existing behavior — migrateVfxProject
    // spreads remaining layer properties, does not rename layers→elements)
    const p = migrated.presets[0] as any;
    expect(Array.isArray(p.layers ?? p.elements)).toBe(true);
  });
});

describe('listObjectPlys', () => {
  it('returns .ply filenames from assets/objects/', async () => {
    const root = testing.makeRoot();
    const assets = await root.getDirectoryHandle('assets', { create: true });
    const objects = await assets.getDirectoryHandle('objects', { create: true });
    const fh1 = await objects.getFileHandle('crystal.ply', { create: true });
    const w1 = await fh1.createWritable();
    await w1.write(new Uint8Array([1]));
    await w1.close();
    const fh2 = await objects.getFileHandle('barrel.ply', { create: true });
    const w2 = await fh2.createWritable();
    await w2.write(new Uint8Array([2]));
    await w2.close();
    const fh3 = await objects.getFileHandle('readme.txt', { create: true });
    const w3 = await fh3.createWritable();
    await w3.write('ignore');
    await w3.close();

    const result = await listObjectPlys(root as unknown as FileSystemDirectoryHandle);
    expect(result.sort()).toEqual(['barrel.ply', 'crystal.ply']);
  });

  it('returns empty array when assets/objects/ does not exist', async () => {
    const root = testing.makeRoot();
    const result = await listObjectPlys(root as unknown as FileSystemDirectoryHandle);
    expect(result).toEqual([]);
  });
});
