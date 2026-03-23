// ── Voxel ──

export interface Voxel {
  color: [number, number, number, number];
}

export type VoxelKey = `${number},${number},${number}`;

// ── Scene elements (mirrors engine SceneData) ──

export interface StaticLight {
  id: string;
  position: [number, number];
  radius: number;
  height: number;
  color: [number, number, number];
  intensity: number;
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
  position: [number, number];
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
  | 'nav_zone';

export type CollisionLayer = 'solid' | 'elevation' | 'nav_zone';

export type SettingsCategory =
  | 'gs_camera'
  | 'ambient'
  | 'weather'
  | 'day_night'
  | 'vfx'
  | 'backgrounds';

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

export interface ProjectManifest {
  name: string;
  version: number;
  terrains: TerrainEntry[];
  assets: AssetEntry[];
  globalSettings: {
    ambientColor: [number, number, number, number];
    gaussianSplat: GaussianSplatConfig;
    weather: WeatherData;
    dayNight: DayNightData;
    backgroundLayers: BackgroundLayer[];
    torchEmitter: EmitterConfig;
    torchPositions: [number, number][];
    footstepEmitter: EmitterConfig;
    npcAuraEmitter: EmitterConfig;
  };
  scene: {
    placedObjects: PlacedObjectData[];
    staticLights: StaticLight[];
    npcs: NpcData[];
    portals: PortalData[];
    player: PlayerData;
  };
}

export interface TerrainEntry {
  id: string;
  name: string;
  voxelFile: string;     // relative path to .bricklayer voxel data file
  collision: CollisionGridData | null;
  navZoneNames: string[];
}

export interface AssetEntry {
  id: string;
  path: string;          // relative path within project assets/
  type: 'ply' | 'image' | 'other';
}

export interface SelectedEntity {
  type: string;
  id: string;
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
  scene: {
    ambientColor: [number, number, number, number];
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
  };
}
