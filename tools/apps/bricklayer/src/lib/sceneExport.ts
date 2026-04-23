import type { SceneStoreState } from '../store/useSceneStore.js';
import { parseAssetRef, resolveRef, type AssetRegistry, type RefKind } from '@gseurat/project-root';

export interface ScenePathError {
  field: string;
  value: string;
  message: string;
}

/**
 * Thrown by `assertScenePathsValid` (and `exportSceneJson` in strict mode)
 * when one or more scene asset paths fail validation. Carries the full
 * error list so callers can render a structured failure dialog instead of
 * just a string. Phase 0.1 #3.
 */
export class ScenePathValidationError extends Error {
  readonly errors: ScenePathError[];
  constructor(errors: ScenePathError[]) {
    const noun = errors.length === 1 ? 'issue' : 'issues';
    super(`Scene export has ${errors.length} path ${noun}`);
    this.name = 'ScenePathValidationError';
    this.errors = errors;
  }
}

export interface AssertScenePathsOptions {
  /**
   * When true, throws `ScenePathValidationError` on any validation failure
   * instead of logging warnings. Phase 0.1 #3 introduces this flag — it
   * stays default-off during the migration window so legacy scenes can
   * still load. Once all known scenes are clean, flip the call sites
   * (Open in Staging / Auto-Sync) to `{ strict: true }`.
   */
  strict?: boolean;
}

/**
 * Validate every asset path field in `scene` and either log warnings
 * (default, lossy) or throw `ScenePathValidationError` (strict). The strict
 * branch deliberately skips the warn so the thrown error is the single
 * source of truth — callers shouldn't see both.
 */
export function assertScenePathsValid(
  scene: unknown,
  reg: AssetRegistry,
  options: AssertScenePathsOptions = {},
): void {
  const errors = validateScenePaths(scene, reg);
  if (errors.length === 0) return;
  if (options.strict) {
    throw new ScenePathValidationError(errors);
  }
  console.warn(`[bricklayer] Scene export has ${errors.length} path issue(s):`);
  for (const e of errors) {
    console.warn(`  ${e.field}: ${e.value} — ${e.message}`);
  }
}

function validateRef(
  field: string,
  value: unknown,
  kind: RefKind,
  reg: AssetRegistry,
  out: ScenePathError[],
): void {
  // Skip empty/missing fields — they're not errors at validation time.
  if (typeof value !== 'string' || value.length === 0) return;

  try {
    parseAssetRef(value);
  } catch (e) {
    out.push({ field, value, message: (e as Error).message });
    return;
  }
  // For #id refs, additionally verify the id resolves in the registry
  if (value.startsWith('#')) {
    try {
      resolveRef(value, kind, reg);
    } catch (e) {
      out.push({ field, value, message: (e as Error).message });
    }
  }
}

/**
 * Walk an exported engine scene JSON and validate every asset path field.
 * Returns a list of errors (empty if all valid). Does NOT throw — callers
 * decide how to handle violations.
 *
 * Validates:
 * - game_objects[i].ply_file (map)
 * - game_objects[i].components.CharacterModel.manifest (character)
 * - vfx_instances[i].vfx_file (vfx)
 * - gaussian_splat.ply_file (map)
 * - gaussian_splat.background_image (texture)
 * - background_layers[i].texture (texture)
 */
export function validateScenePaths(scene: any, reg: AssetRegistry): ScenePathError[] {
  const errs: ScenePathError[] = [];

  if (Array.isArray(scene?.game_objects)) {
    for (let i = 0; i < scene.game_objects.length; i++) {
      const go = scene.game_objects[i];
      validateRef(`game_objects[${i}].ply_file`, go?.ply_file, 'map', reg, errs);
      const cm = go?.components?.CharacterModel;
      if (cm) {
        validateRef(
          `game_objects[${i}].components.CharacterModel.manifest`,
          cm.manifest,
          'character',
          reg,
          errs,
        );
      }
    }
  }

  if (Array.isArray(scene?.vfx_instances)) {
    for (let i = 0; i < scene.vfx_instances.length; i++) {
      const v = scene.vfx_instances[i];
      validateRef(`vfx_instances[${i}].vfx_file`, v?.vfx_file, 'vfx', reg, errs);
    }
  }

  if (scene?.gaussian_splat) {
    validateRef('gaussian_splat.ply_file', scene.gaussian_splat.ply_file, 'map', reg, errs);
    validateRef(
      'gaussian_splat.background_image',
      scene.gaussian_splat.background_image,
      'texture',
      reg,
      errs,
    );
  }

  if (Array.isArray(scene?.background_layers)) {
    for (let i = 0; i < scene.background_layers.length; i++) {
      const b = scene.background_layers[i];
      validateRef(`background_layers[${i}].texture`, b?.texture, 'texture', reg, errs);
    }
  }

  return errs;
}

export function exportSceneJson(
  state: SceneStoreState,
  options: AssertScenePathsOptions = {},
): object {
  const scene: Record<string, unknown> = {
    version: 2,
    ambient_color: state.ambientColor,
  };

  if (state.godRaysIntensity > 0) {
    scene.god_rays_intensity = state.godRaysIntensity;
  }

  if (state.staticLights.length > 0) {
    scene.lights = state.staticLights.map((l) => {
      const out: Record<string, unknown> = {
        position: l.position,
        radius: l.radius,
        color: l.color,
        intensity: l.intensity,
      };
      if (l.direction && l.cone_angle !== undefined && l.cone_angle < 180) {
        out.direction = l.direction;
        out.cone_angle = l.cone_angle;
      }
      if (l.area_width && l.area_width > 0) {
        out.area_width = l.area_width;
        out.area_height = l.area_height ?? l.area_width;
        if (l.area_normal) out.area_normal = l.area_normal;
      }
      return out;
    });
  }

  if (state.gameObjects.length > 0) {
    scene.game_objects = state.gameObjects.map((go) => {
      const out: Record<string, unknown> = {
        id: go.id,
        name: go.name,
        position: go.position,
        rotation: go.rotation,
        scale: go.scale,
      };
      if (go.ply_file) out.ply_file = go.ply_file;
      if (go.pbd) out.pbd = go.pbd;
      out.components = go.components;
      return out;
    });
  }

  const playerObj: Record<string, unknown> = {
    position: state.player.position,
    tint: state.player.tint,
    facing: state.player.facing,
  };
  if (state.player.character_id) {
    playerObj.character_id = state.player.character_id;
  }
  scene.player = playerObj;

  if (state.backgroundLayers.length > 0) {
    scene.background_layers = state.backgroundLayers.map((l) => ({
      texture: l.texture,
      z: l.z,
      parallax_factor: l.parallax_factor,
      quad_width: l.quad_width,
      quad_height: l.quad_height,
      uv_repeat_x: l.uv_repeat_x,
      uv_repeat_y: l.uv_repeat_y,
      tint: l.tint,
      wall: l.wall,
      wall_y_offset: l.wall_y_offset,
    }));
  }

  scene.torch_emitter = state.torchEmitter;
  if (state.torchPositions.length > 0) {
    scene.torch_positions = state.torchPositions.map((p) =>
      p.length === 2 ? [p[0], 0, p[1]] : p,
    );
  }
  scene.footstep_emitter = state.footstepEmitter;
  scene.npc_aura_emitter = state.npcAuraEmitter;

  if (state.weather.enabled) {
    scene.weather = {
      type: state.weather.type,
      emitter: state.weather.emitter,
      ambient_override: state.weather.ambient_override,
      fog_density: state.weather.fog_density,
      fog_color: state.weather.fog_color,
      transition_speed: state.weather.transition_speed,
    };
  }

  if (state.dayNight.enabled) {
    scene.day_night = {
      cycle_speed: state.dayNight.cycle_speed,
      initial_time: state.dayNight.initial_time,
      keyframes: state.dayNight.keyframes,
    };
  }

  // Terrain PLY path: use stored path, fall back to project-name-derived path
  const terrainPly = state.gaussianSplat.ply_file || `assets/maps/${state.projectName || 'map'}.ply`;

  // Auto-compute camera to look at scene center if using default target
  const cam = state.gaussianSplat.camera;
  const isDefaultCamera = !cam?.target || (cam.target[0] === 0 && cam.target[1] === 0 && cam.target[2] === 0);
  const centerX = state.gridWidth / 2;
  const centerZ = state.gridDepth / 2;
  const autoCamera = isDefaultCamera ? {
    position: [centerX, Math.max(state.gridWidth, state.gridDepth) * 0.4, centerZ + Math.max(state.gridWidth, state.gridDepth) * 0.5],
    target: [centerX, 0, centerZ],
    fov: cam.fov,
  } : cam;

  const gs = state.gaussianSplat;
  const gaussianSplatOut: Record<string, unknown> = {
    ply_file: terrainPly,
    camera: autoCamera,
    render_width: gs.render_width,
    render_height: gs.render_height,
    scale_multiplier: gs.scale_multiplier,
    background_image: gs.background_image,
    parallax: gs.parallax,
  };

  // Morph pair (optional) — emitted only when pair_ply is set (after trim).
  // Contract: snake_case keys `pair_ply`, `duration`, `default_blend`, `easing`
  // consumed by GSeurat's SceneLoader into GsMorphPairData. Engine parses but
  // does NOT load the pair PLY — the game's SceneManager owns that policy.
  if (gs.morphPairPly.trim().length > 0) {
    gaussianSplatOut.morph = {
      pair_ply: gs.morphPairPly.trim(),
      duration: gs.morphDuration,
      default_blend: gs.morphDefaultBlend,
      easing: gs.morphEasing,
    };
  }

  scene.gaussian_splat = gaussianSplatOut;

  const activeEmitters = state.gsParticleEmitters.filter((e) => !e.muted);
  if (activeEmitters.length > 0) {
    scene.particle_emitters = activeEmitters.map((e) => {
      const out: Record<string, unknown> = {
        position: e.position,
        spawn_rate: e.spawn_rate,
        lifetime_min: e.lifetime_min,
        lifetime_max: e.lifetime_max,
        velocity_min: e.velocity_min,
        velocity_max: e.velocity_max,
        acceleration: e.acceleration,
        color_start: e.color_start,
        color_end: e.color_end,
        scale_min: e.scale_min,
        scale_max: e.scale_max,
        scale_end_factor: e.scale_end_factor,
        opacity_start: e.opacity_start,
        opacity_end: e.opacity_end,
        emission: e.emission,
        region: e.spawn_region,
      };
      if (e.preset) out.preset = e.preset;
      if (e.burst_duration > 0) out.burst_duration = e.burst_duration;
      if (e.spline) out.spline = e.spline;
      return out;
    });
  }

  const activeAnimations = state.gsAnimations.filter((a) => !a.muted);
  if (activeAnimations.length > 0) {
    scene.animations = activeAnimations.map((a) => {
      const region: Record<string, unknown> = {
        shape: a.shape,
        center: a.center,
      };
      if (a.shape === 'sphere') region.radius = a.radius;
      else region.half_extents = a.half_extents;
      const out: Record<string, unknown> = {
        effect: a.effect,
        region,
        lifetime: a.lifetime,
      };
      if (a.loop) out.loop = true;
      // Only write params that differ from defaults
      const p = a.params ?? {
        rotations: 1, rotations_easing: 'linear',
        expansion: 1, expansion_easing: 'linear',
        height_rise: 0, height_easing: 'linear',
        opacity_end: 0, opacity_easing: 'linear',
        scale_end: 0, scale_easing: 'linear',
        velocity: 1, gravity: [0, -9.8, 0],
        noise: 1, wave_speed: 5, pulse_frequency: 4,
      };
      const params: Record<string, unknown> = {};
      if (p.rotations !== 1) params.rotations = p.rotations;
      if (p.rotations_easing !== 'linear') params.rotations_easing = p.rotations_easing;
      if (p.expansion !== 1) params.expansion = p.expansion;
      if (p.expansion_easing !== 'linear') params.expansion_easing = p.expansion_easing;
      if (p.height_rise !== 0) params.height_rise = p.height_rise;
      if (p.height_easing !== 'linear') params.height_easing = p.height_easing;
      if (p.opacity_end !== 0) params.opacity_end = p.opacity_end;
      if (p.opacity_easing !== 'linear') params.opacity_easing = p.opacity_easing;
      if (p.scale_end !== 0) params.scale_end = p.scale_end;
      if (p.scale_easing !== 'linear') params.scale_easing = p.scale_easing;
      if (p.velocity !== 1) params.velocity = p.velocity;
      if (p.gravity && (p.gravity[0] !== 0 || p.gravity[1] !== -9.8 || p.gravity[2] !== 0)) params.gravity = p.gravity;
      if (p.noise !== 1) params.noise = p.noise;
      if (p.wave_speed !== 5) params.wave_speed = p.wave_speed;
      if (p.pulse_frequency !== 4) params.pulse_frequency = p.pulse_frequency;
      if (Object.keys(params).length > 0) out.params = params;
      if (a.reform_enabled) {
        out.reform = { lifetime: a.reform_lifetime };
      }
      return out;
    });
  }

  const activeVfx = state.vfxInstances.filter((v) => !v.muted);
  if (activeVfx.length > 0) {
    scene.vfx_instances = activeVfx.map((v) => {
      const out: Record<string, unknown> = {
        vfx_file: v.vfx_file,
        position: v.position,
      };
      if (v.rotation_y) out.rotation_y = v.rotation_y;
      if (v.radius !== 5) out.radius = v.radius;
      if (v.trigger !== 'auto') out.trigger = v.trigger;
      if (!v.loop) out.loop = false;
      if (v.splinePoints && v.splinePoints.length > 0) {
        out.spline_points = v.splinePoints;
      }
      return out;
    });
  }

  if (state.collisionGridData) {
    const g = state.collisionGridData;
    scene.collision = {
      width: g.width,
      height: g.height,
      cell_size: g.cell_size,
      solid: g.solid,
      elevation: g.elevation,
      nav_zone: g.nav_zone,
    };
  }

  if (state.navZoneNames && state.navZoneNames.length > 0) {
    scene.nav_zones = state.navZoneNames;
  }

  // Camera zones
  const { cameraVolumes, cameraTriggers, cameraRails, cameraDefaultParams, cameraShowDebugVolumes } = state;
  if (cameraVolumes.length > 0 || cameraTriggers.length > 0 || cameraRails.length > 0) {
    const cameraZones: Record<string, unknown> = {};

    if (Object.keys(cameraDefaultParams).length > 0) {
      cameraZones.default_params = cameraDefaultParams;
    }
    if (cameraShowDebugVolumes) {
      cameraZones.show_debug_volumes = true;
    }

    if (cameraVolumes.length > 0) {
      cameraZones.volumes = cameraVolumes.map((v) => {
        const out: Record<string, unknown> = { id: v.id, shape: v.shape };
        // Only export non-default params
        const p = v.params;
        const params: Record<string, unknown> = {};
        if (p.mode !== 'free_look') params.mode = p.mode;
        if (p.priority !== 0) params.priority = p.priority;
        if (p.blend_time !== 1.0) params.blend_time = p.blend_time;
        if (!p.allow_user_orbit) params.allow_user_orbit = false;
        if (p.pitch_min !== -60) params.pitch_min = p.pitch_min;
        if (p.pitch_max !== 10) params.pitch_max = p.pitch_max;
        if (p.yaw_min !== -180) params.yaw_min = p.yaw_min;
        if (p.yaw_max !== 180) params.yaw_max = p.yaw_max;
        if (p.fov !== 45) params.fov = p.fov;
        if (p.orbit_distance !== 10) params.orbit_distance = p.orbit_distance;
        if (p.offset && (p.offset[0] !== 0 || p.offset[1] !== 5 || p.offset[2] !== -10)) params.offset = p.offset;
        if (p.fixed_position) params.fixed_position = p.fixed_position;
        if (p.rail_id) params.rail_id = p.rail_id;
        // Cinematic rail parameters (only export non-defaults)
        if (p.cinematic_duration !== undefined && p.cinematic_duration !== 5.0) params.cinematic_duration = p.cinematic_duration;
        if (p.cinematic_easing && p.cinematic_easing !== 'in_out_quad') params.cinematic_easing = p.cinematic_easing;
        if (p.cinematic_playback && p.cinematic_playback !== 'once') params.cinematic_playback = p.cinematic_playback;
        if (p.play_on_enter === false) params.play_on_enter = false;
        if (p.target_mode && p.target_mode !== 'player') params.target_mode = p.target_mode;
        if (p.min_ground_clearance !== undefined && p.min_ground_clearance !== 10) params.min_ground_clearance = p.min_ground_clearance;
        if (p.target_y_offset !== undefined && p.target_y_offset !== 2.5) params.target_y_offset = p.target_y_offset;
        if (Object.keys(params).length > 0) out.params = params;
        return out;
      });
    }

    if (cameraTriggers.length > 0) {
      cameraZones.triggers = cameraTriggers.map((t) => {
        const out: Record<string, unknown> = { shape: t.shape, to_zone: t.to_zone };
        if (t.from_zone) out.from_zone = t.from_zone;
        if (t.blend_override >= 0) out.blend_override = t.blend_override;
        return out;
      });
    }

    if (cameraRails.length > 0) {
      cameraZones.rails = cameraRails.map((r) => {
        const out: Record<string, unknown> = { id: r.id, control_points: r.control_points };
        if (r.target_points && r.target_points.length > 0) out.target_points = r.target_points;
        return out;
      });
    }

    scene.camera_zones = cameraZones;
  }

  // Default mode (Phase 0.0 migration window): warn but don't throw.
  // Pass `{ strict: true }` once all known scenes are clean — see Phase 0.1 #3.
  assertScenePathsValid(scene, state.asset_registry, options);

  return scene;
}
