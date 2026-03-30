/**
 * Unit tests for Bricklayer incremental auto-sync logic.
 *
 * Validates that structural changes (PLY, camera, objects) trigger full reload,
 * while property-only changes (lights, emitters, animations, VFX) use lightweight
 * update_scene_data command.
 *
 * Run: pnpm test:bricklayer-incremental-sync
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Scene fingerprint (mirrors the logic that will be in Bricklayer) ──

interface SceneFingerprint {
  ply_file: string;
  camera_json: string;
  objects_json: string;
  render_width: number;
  render_height: number;
}

function computeFingerprint(scene: Record<string, unknown>): SceneFingerprint {
  const gs = (scene.gaussian_splat ?? {}) as Record<string, unknown>;
  return {
    ply_file: (gs.ply_file as string) ?? '',
    camera_json: gs.camera ? JSON.stringify(gs.camera) : '',
    objects_json: scene.objects ? JSON.stringify(scene.objects) : '',
    render_width: (gs.render_width as number) ?? 320,
    render_height: (gs.render_height as number) ?? 240,
  };
}

function fingerprintsEqual(a: SceneFingerprint, b: SceneFingerprint): boolean {
  return (
    a.ply_file === b.ply_file &&
    a.camera_json === b.camera_json &&
    a.objects_json === b.objects_json &&
    a.render_width === b.render_width &&
    a.render_height === b.render_height
  );
}

function isStructuralChange(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
): boolean {
  if (!prev) return true; // first sync always structural
  return !fingerprintsEqual(computeFingerprint(prev), computeFingerprint(next));
}

// ── Tests ──

describe('Scene fingerprint: structural change detection', () => {
  const baseScene = {
    version: 2,
    gaussian_splat: {
      ply_file: 'assets/maps/test.ply',
      camera: { position: [0, 50, 100], target: [0, 0, 0], fov: 45 },
      render_width: 320,
      render_height: 240,
    },
    lights: [{ position: [10, 20, 30], radius: 50, color: [1, 1, 1], intensity: 5 }],
  };

  it('identical scenes are not structural', () => {
    assert.equal(isStructuralChange(baseScene, { ...baseScene }), false);
  });

  it('first sync (prev=null) is always structural', () => {
    assert.equal(isStructuralChange(null, baseScene), true);
  });

  it('light change is NOT structural', () => {
    const modified = {
      ...baseScene,
      lights: [{ position: [99, 99, 99], radius: 100, color: [1, 0, 0], intensity: 10 }],
    };
    assert.equal(isStructuralChange(baseScene, modified), false);
  });

  it('emitter change is NOT structural', () => {
    const a = { ...baseScene, particle_emitters: [{ position: [5, 10, 15], spawn_rate: 100 }] };
    const b = { ...baseScene, particle_emitters: [{ position: [99, 99, 99], spawn_rate: 200 }] };
    assert.equal(isStructuralChange(a, b), false);
  });

  it('animation change is NOT structural', () => {
    const a = { ...baseScene, animations: [{ effect: 'wave', region: { radius: 5 } }] };
    const b = { ...baseScene, animations: [{ effect: 'pulse', region: { radius: 20 } }] };
    assert.equal(isStructuralChange(a, b), false);
  });

  it('VFX instance change is NOT structural', () => {
    const a = { ...baseScene, vfx_instances: [{ vfx_file: 'torch.vfx.json', position: [10, 0, 10] }] };
    const b = { ...baseScene, vfx_instances: [{ vfx_file: 'torch.vfx.json', position: [50, 0, 50] }] };
    assert.equal(isStructuralChange(a, b), false);
  });

  it('ambient color change is NOT structural', () => {
    const a = { ...baseScene, ambient_color: [0.1, 0.2, 0.3, 1.0] };
    const b = { ...baseScene, ambient_color: [0.5, 0.5, 0.5, 1.0] };
    assert.equal(isStructuralChange(a, b), false);
  });

  it('PLY file change IS structural', () => {
    const modified = {
      ...baseScene,
      gaussian_splat: { ...baseScene.gaussian_splat, ply_file: 'assets/maps/other.ply' },
    };
    assert.equal(isStructuralChange(baseScene, modified), true);
  });

  it('camera position change IS structural', () => {
    const modified = {
      ...baseScene,
      gaussian_splat: {
        ...baseScene.gaussian_splat,
        camera: { position: [10, 60, 200], target: [0, 0, 0], fov: 45 },
      },
    };
    assert.equal(isStructuralChange(baseScene, modified), true);
  });

  it('camera FOV change IS structural', () => {
    const modified = {
      ...baseScene,
      gaussian_splat: {
        ...baseScene.gaussian_splat,
        camera: { ...baseScene.gaussian_splat.camera, fov: 60 },
      },
    };
    assert.equal(isStructuralChange(baseScene, modified), true);
  });

  it('render resolution change IS structural', () => {
    const modified = {
      ...baseScene,
      gaussian_splat: { ...baseScene.gaussian_splat, render_width: 160, render_height: 120 },
    };
    assert.equal(isStructuralChange(baseScene, modified), true);
  });

  it('object added IS structural', () => {
    const modified = {
      ...baseScene,
      objects: [{ id: 'rock1', ply_file: 'rock.ply', position: [1, 2, 3] }],
    };
    assert.equal(isStructuralChange(baseScene, modified), true);
  });

  it('object position moved IS structural', () => {
    const a = { ...baseScene, objects: [{ id: 'rock1', ply_file: 'rock.ply', position: [1, 2, 3] }] };
    const b = { ...baseScene, objects: [{ id: 'rock1', ply_file: 'rock.ply', position: [9, 8, 7] }] };
    assert.equal(isStructuralChange(a, b), true);
  });
});

describe('Command selection', () => {
  function chooseCommand(
    prev: Record<string, unknown> | null,
    next: Record<string, unknown>,
  ): 'load_scene_json' | 'update_scene_data' {
    return isStructuralChange(prev, next) ? 'load_scene_json' : 'update_scene_data';
  }

  it('first sync uses load_scene_json', () => {
    const scene = { version: 2, gaussian_splat: { ply_file: 'test.ply' } };
    assert.equal(chooseCommand(null, scene), 'load_scene_json');
  });

  it('light move uses update_scene_data', () => {
    const base = { version: 2, gaussian_splat: { ply_file: 'test.ply' } };
    const a = { ...base, lights: [{ position: [1, 2, 3] }] };
    const b = { ...base, lights: [{ position: [9, 9, 9] }] };
    assert.equal(chooseCommand(a, b), 'update_scene_data');
  });

  it('PLY swap uses load_scene_json', () => {
    const a = { version: 2, gaussian_splat: { ply_file: 'map_v1.ply' } };
    const b = { version: 2, gaussian_splat: { ply_file: 'map_v2.ply' } };
    assert.equal(chooseCommand(a, b), 'load_scene_json');
  });
});
