import { describe, it, expect, vi } from 'vitest';
import {
  validateScenePaths,
  assertScenePathsValid,
  exportSceneJson,
  ScenePathValidationError,
  type ScenePathError,
} from '../sceneExport';
import { useSceneStore } from '../../store/useSceneStore';
import { createEmptyRegistry, registerCharacter } from '@gseurat/project-root';

describe('validateScenePaths', () => {
  it('passes a clean scene with relative asset paths', () => {
    const reg = createEmptyRegistry();
    const scene = {
      game_objects: [{ id: 'a', ply_file: 'assets/maps/house.ply' }],
      vfx_instances: [{ vfx_file: 'assets/vfx/presets/explosion.vfx.json' }],
      gaussian_splat: { ply_file: 'assets/maps/town.ply' },
    } as any;
    const errs = validateScenePaths(scene, reg);
    expect(errs).toEqual([]);
  });

  it('resolves #id refs against the registry', () => {
    let reg = createEmptyRegistry();
    reg = registerCharacter(reg, 'walker', {
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    const scene = {
      game_objects: [{
        id: 'a',
        components: { CharacterModel: { manifest: '#walker' } },
      }],
    } as any;
    const errs = validateScenePaths(scene, reg);
    expect(errs).toEqual([]);
  });

  it('rejects bare filenames in ply_file', () => {
    const scene = { game_objects: [{ id: 'a', ply_file: 'walker.ply' }] } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].field).toContain('ply_file');
    expect(errs[0].message).toMatch(/bare filename/i);
  });

  it('rejects absolute paths', () => {
    const scene = { game_objects: [{ id: 'a', ply_file: '/Users/foo/walker.ply' }] } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs[0].message).toMatch(/absolute/i);
  });

  it('rejects unknown #id in CharacterModel.manifest', () => {
    const scene = {
      game_objects: [{ id: 'a', components: { CharacterModel: { manifest: '#nope' } } }],
    } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toMatch(/unknown id/i);
  });

  it('validates vfx_instances[i].vfx_file', () => {
    const scene = {
      vfx_instances: [{ vfx_file: 'walker.vfx.json' }],
    } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].field).toContain('vfx_instances[0].vfx_file');
  });

  it('validates gaussian_splat.ply_file', () => {
    const scene = { gaussian_splat: { ply_file: 'town.ply' } } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].field).toBe('gaussian_splat.ply_file');
  });

  it('validates gaussian_splat.background_image', () => {
    const scene = { gaussian_splat: { background_image: 'sky.png' } } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].field).toBe('gaussian_splat.background_image');
  });

  it('validates background_layers[i].texture', () => {
    const scene = {
      background_layers: [{ texture: 'sky.png' }, { texture: 'assets/textures/ground.png' }],
    } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs.length).toBe(1);
    expect(errs[0].field).toBe('background_layers[0].texture');
  });

  it('skips empty/missing optional fields', () => {
    const scene = {
      game_objects: [{ id: 'a' }, { id: 'b', ply_file: '' }],
      vfx_instances: [],
    } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs).toEqual([]);
  });

  it('reports multiple errors in a single scene', () => {
    const scene = {
      game_objects: [
        { id: 'a', ply_file: 'walker.ply' },
        { id: 'b', ply_file: '/abs/foo.ply' },
      ],
      vfx_instances: [{ vfx_file: 'bare.vfx.json' }],
    } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs.length).toBe(3);
  });
});

describe('ScenePathValidationError', () => {
  it('is an Error subclass carrying the errors array', () => {
    const errs: ScenePathError[] = [
      { field: 'game_objects[0].ply_file', value: 'foo.ply', message: 'bare filename' },
    ];
    const err = new ScenePathValidationError(errs);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ScenePathValidationError);
    expect(err.name).toBe('ScenePathValidationError');
    expect(err.errors).toEqual(errs);
    expect(err.message).toMatch(/1 path issue/i);
  });

  it('pluralises the message for multiple errors', () => {
    const err = new ScenePathValidationError([
      { field: 'a', value: 'x', message: 'm' },
      { field: 'b', value: 'y', message: 'n' },
    ]);
    expect(err.message).toMatch(/2 path issues/i);
  });
});

describe('exportSceneJson — gaussian_splat.morph', () => {
  // Reset the store to its defaults before each test so state from a prior test
  // cannot leak.
  function resetStore() {
    const s = useSceneStore.getState();
    useSceneStore.setState({
      gaussianSplat: {
        ...s.gaussianSplat,
        morphPairPly: '',
        morphDuration: 1.5,
        morphDefaultBlend: 0.0,
        morphEasing: 'linear',
      },
    });
  }

  it('omits the morph key when pair_ply is empty (zero-regression invariant)', () => {
    resetStore();
    const scene = exportSceneJson(useSceneStore.getState()) as {
      gaussian_splat: Record<string, unknown>;
    };
    expect(scene.gaussian_splat).toBeDefined();
    expect('morph' in scene.gaussian_splat).toBe(false);
  });

  it('omits the morph key when pair_ply is whitespace-only', () => {
    resetStore();
    useSceneStore.setState({
      gaussianSplat: {
        ...useSceneStore.getState().gaussianSplat,
        morphPairPly: '   \t  ',
      },
    });
    const scene = exportSceneJson(useSceneStore.getState()) as {
      gaussian_splat: Record<string, unknown>;
    };
    expect('morph' in scene.gaussian_splat).toBe(false);
  });

  it('emits morph with snake_case keys when pair_ply is set', () => {
    resetStore();
    useSceneStore.setState({
      gaussianSplat: {
        ...useSceneStore.getState().gaussianSplat,
        morphPairPly: 'assets/maps/library_past.ply',
        morphDuration: 2.25,
        morphDefaultBlend: 0.3,
        morphEasing: 'ease_in_out',
      },
    });
    const scene = exportSceneJson(useSceneStore.getState()) as {
      gaussian_splat: { morph?: Record<string, unknown> };
    };
    expect(scene.gaussian_splat.morph).toBeDefined();
    const morph = scene.gaussian_splat.morph!;

    // Exact key set — C++ parser rejects extras silently, but we also reject
    // missing fields here to lock the contract.
    expect(Object.keys(morph).sort()).toEqual(
      ['default_blend', 'duration', 'easing', 'pair_ply'],
    );
    expect(morph.pair_ply).toBe('assets/maps/library_past.ply');
    expect(morph.duration).toBe(2.25);
    expect(morph.default_blend).toBe(0.3);
    expect(morph.easing).toBe('ease_in_out');
  });

  it('trims leading/trailing whitespace on pair_ply', () => {
    resetStore();
    useSceneStore.setState({
      gaussianSplat: {
        ...useSceneStore.getState().gaussianSplat,
        morphPairPly: '  assets/maps/library_past.ply  ',
      },
    });
    const scene = exportSceneJson(useSceneStore.getState()) as {
      gaussian_splat: { morph?: { pair_ply: string } };
    };
    expect(scene.gaussian_splat.morph?.pair_ply).toBe(
      'assets/maps/library_past.ply',
    );
  });
});

describe('assertScenePathsValid', () => {
  it('does nothing when the scene is clean (default mode)', () => {
    const reg = createEmptyRegistry();
    const scene = {
      game_objects: [{ id: 'a', ply_file: 'assets/maps/town.ply' }],
    };
    expect(() => assertScenePathsValid(scene, reg)).not.toThrow();
  });

  it('does nothing when the scene is clean in strict mode', () => {
    const reg = createEmptyRegistry();
    const scene = {
      game_objects: [{ id: 'a', ply_file: 'assets/maps/town.ply' }],
    };
    expect(() => assertScenePathsValid(scene, reg, { strict: true })).not.toThrow();
  });

  it('logs warnings (default mode) when paths are invalid and does NOT throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reg = createEmptyRegistry();
      const scene = { game_objects: [{ id: 'a', ply_file: 'walker.ply' }] };
      expect(() => assertScenePathsValid(scene, reg)).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('throws ScenePathValidationError in strict mode when paths are invalid', () => {
    const reg = createEmptyRegistry();
    const scene = {
      game_objects: [
        { id: 'a', ply_file: 'walker.ply' },
        { id: 'b', ply_file: '/abs/foo.ply' },
      ],
    };
    let thrown: unknown = null;
    try {
      assertScenePathsValid(scene, reg, { strict: true });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ScenePathValidationError);
    expect((thrown as ScenePathValidationError).errors).toHaveLength(2);
  });

  it('does NOT log a warning in strict mode (the throw carries the errors)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reg = createEmptyRegistry();
      const scene = { game_objects: [{ id: 'a', ply_file: 'walker.ply' }] };
      expect(() =>
        assertScenePathsValid(scene, reg, { strict: true }),
      ).toThrow(ScenePathValidationError);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
