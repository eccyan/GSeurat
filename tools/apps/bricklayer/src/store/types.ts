// ── Voxel ──

export interface Voxel {
  color: [number, number, number, number];
}

export type VoxelKey = `${number},${number},${number}`;

// ── Scene elements (mirrors engine SceneData) ──

export interface StaticLight {
  id: string;
  position: [number, number, number];
  radius: number;
  color: [number, number, number];
  intensity: number;
  direction?: [number, number, number];  // spot light direction (normalized); omit for point/area
  cone_angle?: number;                   // spot light cone degrees; omit or 180 for point/area
  area_width?: number;                   // area light width; 0 or omit = point/spot light
  area_height?: number;                  // area light height; 0 or omit = point/spot light
  area_normal?: [number, number];        // area light face direction XZ
}

export interface NpcData {
  id: string;
  name: string;
  position: [number, number, number];
  tint: [number, number, number, number];
  facing: string;
  reverse_facing: string;
  patrol_interval: number;
  patrol_speed: number;
  waypoints: [number, number][];
  waypoint_pause: number;
  dialog: { speaker_key: string; text_key: string }[];
  light_color: [number, number, number, number];
  light_radius: number;
  aura_color_start: [number, number, number, number];
  aura_color_end: [number, number, number, number];
  character_id: string;
  script_module: string;
  script_class: string;
}

export interface PortalData {
  id: string;
  position: [number, number, number];
  size: [number, number];
  target_scene: string;
  spawn_position: [number, number, number];
  spawn_facing: string;
}

export interface EmitterConfig {
  spawn_rate: number;
  particle_lifetime_min: number;
  particle_lifetime_max: number;
  velocity_min: [number, number];
  velocity_max: [number, number];
  acceleration: [number, number];
  size_min: number;
  size_max: number;
  size_end_scale: number;
  color_start: [number, number, number, number];
  color_end: [number, number, number, number];
  tile: string;
  z: number;
  spawn_offset_min: [number, number];
  spawn_offset_max: [number, number];
}

export interface BackgroundLayer {
  id: string;
  texture: string;
  z: number;
  parallax_factor: number;
  quad_width: number;
  quad_height: number;
  uv_repeat_x: number;
  uv_repeat_y: number;
  tint: [number, number, number, number];
  wall: boolean;
  wall_y_offset: number;
}

export interface WeatherData {
  enabled: boolean;
  type: string;
  emitter: EmitterConfig;
  ambient_override: [number, number, number, number];
  fog_density: number;
  fog_color: [number, number, number];
  transition_speed: number;
}

export interface DayNightData {
  enabled: boolean;
  cycle_speed: number;
  initial_time: number;
  keyframes: {
    time: number;
    ambient: [number, number, number, number];
    torch_intensity: number;
  }[];
}

export interface GaussianSplatConfig {
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  render_width: number;
  render_height: number;
  scale_multiplier: number;
  background_image: string;
  parallax: {
    azimuth_range: number;
    elevation_min: number;
    elevation_max: number;
    distance_range: number;
    parallax_strength: number;
  };
}

export interface PlayerData {
  position: [number, number, number];
  tint: [number, number, number, number];
  facing: string;
  character_id: string;
}

export type BricklayerMode = 'terrain' | 'scene' | 'settings';

export type ToolType =
  | 'place'
  | 'paint'
  | 'erase'
  | 'fill'
  | 'extrude'
  | 'eyedropper'
  | 'select';

export type InspectorTab =
  | 'scene'
  | 'lights'
  | 'weather'
  | 'vfx'
  | 'entities'
  | 'objects'
  | 'backgrounds'
  | 'gaussian'
  | 'gs_emitters'
  | 'nav_zone';

export type CollisionLayer = 'solid' | 'elevation' | 'nav_zone';

export type SettingsCategory =
  | 'gs_camera'
  | 'ambient'
  | 'weather'
  | 'day_night'
  | 'vfx'
  | 'backgrounds';

export type GsEasing =
  | 'linear'
  | 'in_quad' | 'out_quad' | 'in_out_quad'
  | 'in_cubic' | 'out_cubic' | 'in_out_cubic'
  | 'in_quart' | 'out_quart' | 'in_out_quart'
  | 'in_quint' | 'out_quint' | 'in_out_quint'
  | 'in_sine' | 'out_sine' | 'in_out_sine'
  | 'in_expo' | 'out_expo' | 'in_out_expo'
  | 'in_circ' | 'out_circ' | 'in_out_circ'
  | 'in_back' | 'out_back' | 'in_out_back'
  | 'in_elastic' | 'out_elastic' | 'in_out_elastic'
  | 'in_bounce' | 'out_bounce' | 'in_out_bounce';

export interface GsAnimParams {
  rotations: number;
  rotations_easing: GsEasing;
  expansion: number;
  expansion_easing: GsEasing;
  height_rise: number;
  height_easing: GsEasing;
  opacity_end: number;
  opacity_easing: GsEasing;
  scale_end: number;
  scale_easing: GsEasing;
  velocity: number;
  gravity: [number, number, number];
  noise: number;
  wave_speed: number;
  pulse_frequency: number;
}

export interface GsAnimationGroupData {
  id: string;
  muted?: boolean;
  effect: string;  // 'detach' | 'float' | 'orbit' | 'dissolve' | 'reform'
  shape: string;   // 'sphere' | 'box'
  center: [number, number, number];
  radius: number;
  half_extents: [number, number, number];
  lifetime: number;
  loop: boolean;
  params: GsAnimParams;
  reform_enabled: boolean;
  reform_lifetime: number;
}

export interface GsParticleEmitterData {
  id: string;
  muted?: boolean;
  preset: string;  // '' | 'dust_puff' | 'spark_shower' | 'magic_spiral'
  position: [number, number, number];  // [scene_x, height, scene_z]
  spawn_rate: number;
  lifetime_min: number;
  lifetime_max: number;
  velocity_min: [number, number, number];
  velocity_max: [number, number, number];
  acceleration: [number, number, number];
  color_start: [number, number, number];
  color_end: [number, number, number];
  scale_min: [number, number, number];
  scale_max: [number, number, number];
  scale_end_factor: number;
  opacity_start: number;
  opacity_end: number;
  emission: number;
  spawn_offset_min: [number, number, number];
  spawn_offset_max: [number, number, number];
  burst_duration: number;
}

// ── VFX Instances (Méliès preset placed on map) ──

export interface VfxLayerData {
  name: string;
  type: 'emitter' | 'animation' | 'light';
  start: number;
  duration: number;
  emitter?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  light?: { color: [number, number, number]; intensity: number; radius: number };
}

export interface VfxPresetData {
  name: string;
  duration: number;
  layers: VfxLayerData[];
}

export interface VfxInstanceData {
  id: string;
  muted?: boolean;
  name: string;
  vfx_file: string;
  vfx_preset: VfxPresetData;
  position: [number, number, number];
  radius: number;
  trigger: 'auto' | 'event';
  loop: boolean;
}

export interface PlacedObjectData {
  id: string;
  ply_file: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  is_static: boolean;
  character_manifest: string;
}

export interface CollisionGridData {
  width: number;
  height: number;
  cell_size: number;
  solid: boolean[];         // row-major walkability
  elevation: number[];      // per-cell ground height
  nav_zone: number[];       // per-cell zone ID (0=default)
}

export interface SelectedEntity {
  type: string;
  id: string;
}

// ── Project management ──

export interface ProjectManifest {
  version: number;
  name: string;
  terrains: TerrainEntry[];
  assets: AssetEntry[];
}

export interface TerrainEntry {
  id: string;
  name: string;
  file: string;
}

export interface AssetEntry {
  id: string;
  name: string;
  type: 'ply' | 'texture' | 'audio';
  path: string;
}

// ── Navigation tree ──

export type NavigationNode =
  | { kind: 'terrain'; terrainId: string }
  | { kind: 'collision'; terrainId: string }
  | { kind: 'scene' }
  | { kind: 'scene_category'; category: 'objects' | 'lights' | 'npcs' | 'portals' }
  | { kind: 'scene_item'; entityType: string; entityId: string }
  | { kind: 'player' }
  | { kind: 'settings' }
  | { kind: 'settings_category'; category: SettingsCategory };

// ── Color palettes ──

export interface ColorPalette {
  name: string;
  colors: [number, number, number, number][];
}

export interface Snapshot {
  voxels: [VoxelKey, Voxel][];
  collisionGridData: CollisionGridData | null;
}

export interface BricklayerFile {
  version: number;
  gridWidth: number;
  gridDepth: number;
  voxels: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[];
  collision: string[];  // legacy format
  collisionGridData?: CollisionGridData;
  nav_zone_names?: string[];
  color_palettes?: ColorPalette[];
  terrains?: TerrainEntry[];
  assets?: AssetEntry[];
  scene: {
    ambientColor: [number, number, number, number];
    godRaysIntensity?: number;
    staticLights: StaticLight[];
    npcs: NpcData[];
    portals: PortalData[];
    player: PlayerData;
    backgroundLayers: BackgroundLayer[];
    torchEmitter: EmitterConfig;
    torchPositions: [number, number][];
    footstepEmitter: EmitterConfig;
    npcAuraEmitter: EmitterConfig;
    weather: WeatherData;
    dayNight: DayNightData;
    gaussianSplat: GaussianSplatConfig;
    placedObjects: PlacedObjectData[];
    gsParticleEmitters?: GsParticleEmitterData[];
    gsAnimations?: GsAnimationGroupData[];
    vfxInstances?: VfxInstanceData[];
  };
}
