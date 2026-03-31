import type { SceneStoreState } from '../store/useSceneStore.js';

export function exportSceneJson(state: SceneStoreState): object {
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
      out.components = go.components;
      return out;
    });
  }

  if (state.portals.length > 0) {
    scene.portals = state.portals.map((p) => ({
      position: p.position,
      size: p.size,
      target_scene: p.target_scene,
      spawn_position: p.spawn_position,
      spawn_facing: p.spawn_facing,
    }));
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

  // Terrain PLY path: assets/maps/<project_name>.ply
  const terrainPly = `assets/maps/${state.projectName || 'map'}.ply`;

  // Auto-compute camera to look at scene center if using default target
  const cam = state.gaussianSplat.camera;
  const isDefaultCamera = cam.target[0] === 0 && cam.target[1] === 0 && cam.target[2] === 0;
  const centerX = state.gridWidth / 2;
  const centerZ = state.gridDepth / 2;
  const autoCamera = isDefaultCamera ? {
    position: [centerX, Math.max(state.gridWidth, state.gridDepth) * 0.4, centerZ + Math.max(state.gridWidth, state.gridDepth) * 0.5],
    target: [centerX, 0, centerZ],
    fov: cam.fov,
  } : cam;

  scene.gaussian_splat = {
    ply_file: terrainPly,
    camera: autoCamera,
    render_width: state.gaussianSplat.render_width,
    render_height: state.gaussianSplat.render_height,
    scale_multiplier: state.gaussianSplat.scale_multiplier,
    background_image: state.gaussianSplat.background_image,
    parallax: state.gaussianSplat.parallax,
  };

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
      if (p.gravity[0] !== 0 || p.gravity[1] !== -9.8 || p.gravity[2] !== 0) params.gravity = p.gravity;
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

  return scene;
}
