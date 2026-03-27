import type { SceneStoreState } from '../store/useSceneStore.js';

export function exportSceneJson(state: SceneStoreState): object {
  const scene: Record<string, unknown> = {
    ambient_color: state.ambientColor,
  };

  if (state.godRaysIntensity > 0) {
    scene.god_rays_intensity = state.godRaysIntensity;
  }

  if (state.staticLights.length > 0) {
    scene.static_lights = state.staticLights.map((l) => {
      const out: Record<string, unknown> = {
        position: l.position,
        radius: l.radius,
        height: l.height,
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

  if (state.npcs.length > 0) {
    scene.npcs = state.npcs.map((n) => ({
      name: n.name,
      position: n.position,
      tint: n.tint,
      facing: n.facing,
      reverse_facing: n.reverse_facing,
      patrol_interval: n.patrol_interval,
      patrol_speed: n.patrol_speed,
      waypoints: n.waypoints,
      waypoint_pause: n.waypoint_pause,
      dialog: n.dialog,
      light_color: n.light_color,
      light_radius: n.light_radius,
      aura_color_start: n.aura_color_start,
      aura_color_end: n.aura_color_end,
      character_id: n.character_id,
      script_module: n.script_module,
      script_class: n.script_class,
    }));
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

  scene.player_position = state.player.position;
  scene.player_tint = state.player.tint;
  scene.player_facing = state.player.facing;
  if (state.player.character_id) {
    scene.player_character_id = state.player.character_id;
  }

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
    scene.torch_positions = state.torchPositions;
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

  if (state.placedObjects.length > 0) {
    scene.placed_objects = state.placedObjects.map((obj) => {
      // Ensure placed object PLY paths have assets/ prefix
      const plyPath = obj.ply_file.startsWith('assets/') ? obj.ply_file : `assets/${obj.ply_file}`;
      return {
        id: obj.id,
        ply_file: plyPath,
        position: obj.position,
        rotation: obj.rotation,
        scale: obj.scale,
        is_static: obj.is_static,
        ...(obj.character_manifest ? { character_manifest: obj.character_manifest } : {}),
      };
    });
  }

  if (state.gsParticleEmitters.length > 0) {
    scene.gs_particle_emitters = state.gsParticleEmitters.map((e) => {
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
        spawn_offset_min: e.spawn_offset_min,
        spawn_offset_max: e.spawn_offset_max,
      };
      if (e.preset) out.preset = e.preset;
      if (e.burst_duration > 0) out.burst_duration = e.burst_duration;
      return out;
    });
  }

  if (state.gsAnimations.length > 0) {
    scene.gs_animations = state.gsAnimations.map((a) => {
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
      const p = a.params;
      const params: Record<string, unknown> = {};
      if (p.speed !== 1) params.speed = p.speed;
      if (p.gravity[0] !== 0 || p.gravity[1] !== -9.8 || p.gravity[2] !== 0) params.gravity = p.gravity;
      if (p.velocity_scale !== 1) params.velocity_scale = p.velocity_scale;
      if (p.noise_amplitude !== 1) params.noise_amplitude = p.noise_amplitude;
      if (p.orbit_speed !== 1) params.orbit_speed = p.orbit_speed;
      if (p.orbit_acceleration !== 0) params.orbit_acceleration = p.orbit_acceleration;
      if (p.expansion !== 1) params.expansion = p.expansion;
      if (p.height_rise !== 1) params.height_rise = p.height_rise;
      if (p.opacity_fade !== 1) params.opacity_fade = p.opacity_fade;
      if (p.scale_shrink !== 1) params.scale_shrink = p.scale_shrink;
      if (Object.keys(params).length > 0) out.params = params;
      if (a.reform_enabled) {
        out.reform = { lifetime: a.reform_lifetime, speed: a.reform_speed };
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

  return scene;
}
