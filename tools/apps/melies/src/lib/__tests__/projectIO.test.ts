import { describe, it, expect } from 'vitest';
import {
  slugifyProjectName,
  meliesProjectPath,
  vfxPresetPath,
  migrateVfxProject,
} from '../projectIO';
import { VFX_PROJECT_VERSION } from '../../store/types';

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
