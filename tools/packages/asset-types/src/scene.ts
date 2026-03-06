// Primitive vector types matching glm::vec2/vec3/vec4 in JSON arrays
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

// Direction strings matching engine Direction enum serialization
export type DirectionString = "up" | "down" | "left" | "right";

// Particle tile names matching ParticleTile enum in particle.hpp
export type ParticleTileString =
  | "Circle"
  | "SoftGlow"
  | "Spark"
  | "SmokePuff"
  | "Raindrop"
  | "Snowflake";

// Tileset descriptor — matches Tileset struct in tilemap.hpp
export interface TilesetJSON {
  tile_width: number;
  tile_height: number;
  columns: number;
  sheet_width: number;
  sheet_height: number;
}

// Animated tile definition — matches TileAnimationDef struct in tilemap.hpp
// JSON key: "base_tile" (maps to base_tile_id), "frames" (maps to frame_tile_ids)
export interface TileAnimationJSON {
  base_tile: number;
  frames: number[];
  frame_duration: number;
}

// Tilemap layer — matches TileLayer struct in tilemap.hpp
export interface TilemapJSON {
  tileset: TilesetJSON;
  width: number;
  height: number;
  tile_size: number;
  z: number;
  tiles: number[];
  tile_animations?: TileAnimationJSON[];
}

// NPC dialog line — matches DialogLine struct in dialog.hpp
export interface DialogLineJSON {
  speaker_key: string;
  text_key: string;
}

// NPC entity — matches NpcData struct in scene_loader.hpp
export interface NpcJSON {
  name: string;
  position: Vec3;
  tint?: Vec4;
  facing?: DirectionString;
  reverse_facing?: DirectionString;
  patrol_interval?: number;
  patrol_speed?: number;
  dialog?: DialogLineJSON[];
  light_color?: Vec4;
  light_radius?: number;
  aura_color_start?: Vec4;
  aura_color_end?: Vec4;
  script_module?: string;
  script_class?: string;
  waypoints?: Vec2[];
  waypoint_pause?: number;
  character_id?: string;
}

// Static point light — matches PointLight struct in types.hpp
// position is Vec2 (x,y); height and intensity are separate fields
export interface LightJSON {
  position: Vec2;
  radius: number;
  color?: Vec3;
  intensity?: number;
  height?: number;
}

// Scene transition portal — matches PortalData struct in scene_loader.hpp
export interface PortalJSON {
  position: Vec2;
  size?: Vec2;
  target_scene: string;
  spawn_position: Vec3;
  spawn_facing?: DirectionString;
}

// Particle emitter configuration — matches EmitterConfig struct in particle.hpp
export interface EmitterConfigJSON {
  spawn_rate?: number;
  particle_lifetime_min?: number;
  particle_lifetime_max?: number;
  velocity_min?: Vec2;
  velocity_max?: Vec2;
  acceleration?: Vec2;
  size_min?: number;
  size_max?: number;
  size_end_scale?: number;
  color_start?: Vec4;
  color_end?: Vec4;
  tile?: ParticleTileString;
  z?: number;
  spawn_offset_min?: Vec2;
  spawn_offset_max?: Vec2;
}

// Weather configuration — matches WeatherData struct in scene_loader.hpp
export interface WeatherJSON {
  enabled?: boolean;
  type?: string;
  emitter?: EmitterConfigJSON;
  ambient_override?: Vec4;
  fog_density?: number;
  fog_color?: Vec3;
  transition_speed?: number;
}

// Day/night cycle keyframe — matches DayNightKeyframe struct in day_night_system.hpp
export interface DayNightKeyframeJSON {
  time: number;
  ambient: Vec4;
  torch_intensity?: number;
}

// Day/night cycle configuration — matches DayNightData struct in scene_loader.hpp
export interface DayNightJSON {
  enabled?: boolean;
  cycle_speed?: number;
  initial_time?: number;
  keyframes?: DayNightKeyframeJSON[];
}

// Parallax background layer — matches ParallaxLayerData struct in parallax_layer.hpp
export interface BackgroundLayerJSON {
  texture: string;
  z?: number;
  parallax_factor?: number;
  quad_width?: number;
  quad_height?: number;
  uv_repeat_x?: number;
  uv_repeat_y?: number;
  tint?: Vec4;
  wall?: boolean;
  wall_y_offset?: number;
}

// Minimap HUD configuration — matches Minimap::Config struct in minimap.hpp
// JSON keys "x"/"y" map to screen_x/screen_y in the C++ struct
export interface MinimapJSON {
  x?: number;
  y?: number;
  size?: number;
  border?: number;
  border_color?: Vec4;
  bg_color?: Vec4;
}

// Player spawn configuration embedded inside SceneJSON
export interface PlayerJSON {
  position: Vec3;
  tint?: Vec4;
  facing?: DirectionString;
  character_id?: string;
}

// Top-level scene descriptor — matches SceneData struct in scene_loader.hpp
// All fields are optional to support partial/incremental scene definitions
export interface SceneJSON {
  tilemap?: TilemapJSON;
  ambient_color?: Vec4;
  static_lights?: LightJSON[];
  torch_emitter?: EmitterConfigJSON;
  torch_positions?: Vec2[];
  torch_audio_positions?: Vec3[];
  footstep_emitter?: EmitterConfigJSON;
  npc_aura_emitter?: EmitterConfigJSON;
  player?: PlayerJSON;
  npcs?: NpcJSON[];
  background_layers?: BackgroundLayerJSON[];
  portals?: PortalJSON[];
  weather?: WeatherJSON;
  day_night?: DayNightJSON;
  minimap?: MinimapJSON;
}
