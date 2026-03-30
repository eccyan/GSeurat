// ---------------------------------------------------------------------------
// Protocol command types
// ---------------------------------------------------------------------------

export interface GetStateCommand {
  cmd: "get_state";
}

export interface GetMapCommand {
  cmd: "get_map";
}

export interface GetSceneCommand {
  cmd: "get_scene";
}

export interface GetTilemapCommand {
  cmd: "get_tilemap";
}

export interface LoadSceneJsonCommand {
  cmd: "load_scene_json";
  json: string;
}

export interface ReloadSceneCommand {
  cmd: "reload_scene";
}

export interface SetTileCommand {
  cmd: "set_tile";
  col: number;
  row: number;
  tile_id: number;
}

export interface TileEntry {
  col: number;
  row: number;
  tile_id: number;
}

export interface SetTilesCommand {
  cmd: "set_tiles";
  tiles: TileEntry[];
}

export interface ResizeTilemapCommand {
  cmd: "resize_tilemap";
  cols: number;
  rows: number;
  fill_tile_id?: number;
}

export interface SetPlayerPositionCommand {
  cmd: "set_player_position";
  x: number;
  y: number;
}

export interface UpdateNpcCommand {
  cmd: "update_npc";
  npc_id: number;
  x?: number;
  y?: number;
  facing?: string;
  tint?: [number, number, number, number];
}

export interface SetAmbientCommand {
  cmd: "set_ambient";
  r: number;
  g: number;
  b: number;
  strength?: number;
}

export interface LightParams {
  x: number;
  y: number;
  z?: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  intensity?: number;
}

export interface AddLightCommand {
  cmd: "add_light";
  light: LightParams;
}

export interface RemoveLightCommand {
  cmd: "remove_light";
  index: number;
}

export interface UpdateLightCommand {
  cmd: "update_light";
  index: number;
  light: Partial<LightParams>;
}

export interface PortalParams {
  x: number;
  y: number;
  width: number;
  height: number;
  target_scene: string;
  spawn_x: number;
  spawn_y: number;
  spawn_facing?: string;
}

export interface AddPortalCommand {
  cmd: "add_portal";
  portal: PortalParams;
}

export interface RemovePortalCommand {
  cmd: "remove_portal";
  index: number;
}

export interface SetWeatherCommand {
  cmd: "set_weather";
  type: "clear" | "rain" | "snow";
  intensity?: number;
}

export interface SetDayNightCommand {
  cmd: "set_day_night";
  enabled: boolean;
  cycle_speed?: number;
  time_of_day?: number;
}

export interface ListEmittersCommand {
  cmd: "list_emitters";
}

export interface EmitterConfig {
  spawn_rate?: number;
  min_velocity?: [number, number];
  max_velocity?: [number, number];
  min_lifetime?: number;
  max_lifetime?: number;
  start_color?: [number, number, number, number];
  end_color?: [number, number, number, number];
  start_size?: number;
  end_size?: number;
  atlas_tile?: number;
}

export interface SetEmitterConfigCommand {
  cmd: "set_emitter_config";
  emitter_id: number;
  config: EmitterConfig;
}

export interface AddEmitterCommand {
  cmd: "add_emitter";
  x: number;
  y: number;
  config: EmitterConfig;
}

export interface RemoveEmitterCommand {
  cmd: "remove_emitter";
  emitter_id: number;
}

export interface GetFeaturesCommand {
  cmd: "get_features";
}

export interface SetFeatureCommand {
  cmd: "set_feature";
  feature: string;
  enabled: boolean;
}

export interface SetCameraCommand {
  cmd: "set_camera";
  target_x?: number;
  target_y?: number;
  zoom?: number;
  follow_speed?: number;
}

export interface SubscribeCommand {
  cmd: "subscribe";
  events: string[];
}

export interface UnsubscribeCommand {
  cmd: "unsubscribe";
  events: string[];
}

export interface MoveCommand {
  cmd: "move";
  direction: "up" | "down" | "left" | "right";
  sprint?: boolean;
}

export interface StopCommand {
  cmd: "stop";
}

export interface InteractCommand {
  cmd: "interact";
}

export interface SetModeCommand {
  cmd: "set_mode";
  mode: "realtime" | "step";
}

export interface StepCommand {
  cmd: "step";
  frames?: number;
}

export interface ScreenshotCommand {
  cmd: "screenshot";
  path: string;
}

export interface ShakeCommand {
  cmd: "shake";
  amplitude: number;
  frequency: number;
  duration: number;
}

export interface ZoomCommand {
  cmd: "zoom";
  zoom: number;
  duration?: number;
}

export interface FlashCommand {
  cmd: "flash";
  r: number;
  g: number;
  b: number;
  a: number;
  duration: number;
}

export interface ChromaticCommand {
  cmd: "chromatic";
  intensity: number;
  duration?: number;
}

export interface SetTimeCommand {
  cmd: "set_time";
  time: number;
}

export interface GetTimeCommand {
  cmd: "get_time";
}

/**
 * Union of all protocol command objects.
 */
// ---------------------------------------------------------------------------
// Staging / render review commands
// ---------------------------------------------------------------------------

export interface GetRenderParamsCommand {
  cmd: "get_render_params";
}

export interface SetRenderParamCommand {
  cmd: "set_render_param";
  name: string;
  value: number;
}

export interface GetPerfCommand {
  cmd: "get_perf";
}

export interface ListScenesCommand {
  cmd: "list_scenes";
}

export type Command =
  | GetStateCommand
  | GetMapCommand
  | GetSceneCommand
  | GetTilemapCommand
  | LoadSceneJsonCommand
  | ReloadSceneCommand
  | SetTileCommand
  | SetTilesCommand
  | ResizeTilemapCommand
  | SetPlayerPositionCommand
  | UpdateNpcCommand
  | SetAmbientCommand
  | AddLightCommand
  | RemoveLightCommand
  | UpdateLightCommand
  | AddPortalCommand
  | RemovePortalCommand
  | SetWeatherCommand
  | SetDayNightCommand
  | ListEmittersCommand
  | SetEmitterConfigCommand
  | AddEmitterCommand
  | RemoveEmitterCommand
  | GetFeaturesCommand
  | SetFeatureCommand
  | SetCameraCommand
  | SubscribeCommand
  | UnsubscribeCommand
  | MoveCommand
  | StopCommand
  | InteractCommand
  | SetModeCommand
  | StepCommand
  | ScreenshotCommand
  | ShakeCommand
  | ZoomCommand
  | FlashCommand
  | ChromaticCommand
  | SetTimeCommand
  | GetTimeCommand
  | GetRenderParamsCommand
  | SetRenderParamCommand
  | GetPerfCommand
  | ListScenesCommand;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface OkResponse {
  type: "ok";
  id?: number;
}

export interface ErrorResponse {
  type: "error";
  id?: number;
  message: string;
}

export interface PlayerState {
  x: number;
  y: number;
  facing: string;
  animation: string;
}

export interface NpcState {
  id: number;
  x: number;
  y: number;
  facing: string;
  animation: string;
}

export interface DialogState {
  active: boolean;
  speaker?: string;
  text?: string;
}

export interface StateResponse {
  type: "state";
  id?: number;
  tick: number;
  game_mode: string;
  player: PlayerState;
  npcs: NpcState[];
  dialog: DialogState;
  nearby_npc?: number;
}

export interface MapTile {
  col: number;
  row: number;
  tile_id: number;
  solid: boolean;
}

export interface MapResponse {
  type: "map";
  id?: number;
  cols: number;
  rows: number;
  tile_size: number;
  tiles: MapTile[];
}

export interface SceneLight {
  x: number;
  y: number;
  z: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export interface ScenePortal {
  x: number;
  y: number;
  width: number;
  height: number;
  target_scene: string;
  spawn_x: number;
  spawn_y: number;
  spawn_facing: string;
}

export interface SceneResponse {
  type: "scene";
  id?: number;
  path: string;
  ambient_r: number;
  ambient_g: number;
  ambient_b: number;
  ambient_strength: number;
  lights: SceneLight[];
  portals: ScenePortal[];
  weather: string;
  day_night_enabled: boolean;
  time_of_day: number;
}

export interface TilemapResponse {
  type: "tilemap";
  id?: number;
  cols: number;
  rows: number;
  tile_size: number;
  tileset_cols: number;
  tileset_rows: number;
  tiles: number[];
  solid: boolean[];
  tile_animations: TileAnimationDef[];
}

export interface TileAnimationDef {
  base_tile_id: number;
  frame_tile_ids: number[];
  frame_duration: number;
}

export interface FeatureEntry {
  name: string;
  enabled: boolean;
  label: string;
  phase: number;
}

export interface FeaturesResponse {
  type: "features";
  id?: number;
  features: FeatureEntry[];
}

export interface EmitterEntry {
  id: number;
  x: number;
  y: number;
  active: boolean;
  config: EmitterConfig;
}

export interface EmittersResponse {
  type: "emitters";
  id?: number;
  emitters: EmitterEntry[];
}

export interface TimeResponse {
  type: "time";
  id?: number;
  time_of_day: number;
  cycle_speed: number;
  enabled: boolean;
}

export interface ScreenshotResponse {
  type: "screenshot";
  id?: number;
  path: string;
  width: number;
  height: number;
}

export interface RenderParamsResponse {
  type: "render_params";
  id?: number;
  params: Record<string, number>;
}

export interface PerfResponse {
  type: "perf";
  id?: number;
  gaussian_count: number;
  visible_count: number;
  max_capacity: number;
}

export interface ScenesResponse {
  type: "scenes";
  id?: number;
  files: string[];
}

/**
 * All possible response shapes from the engine.
 */
export type Response =
  | OkResponse
  | ErrorResponse
  | StateResponse
  | MapResponse
  | SceneResponse
  | TilemapResponse
  | FeaturesResponse
  | EmittersResponse
  | TimeResponse
  | ScreenshotResponse
  | RenderParamsResponse
  | PerfResponse
  | ScenesResponse;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface DialogStartedEvent {
  event: "dialog_started";
  npc_id: number;
  speaker: string;
  text: string;
}

export interface DialogAdvancedEvent {
  event: "dialog_advanced";
  text: string;
}

export interface DialogEndedEvent {
  event: "dialog_ended";
}

export interface SceneChangedEvent {
  event: "scene_changed";
  path: string;
}

export interface PlayerMovedEvent {
  event: "player_moved";
  x: number;
  y: number;
  facing: string;
}

export interface GenericEvent {
  event: string;
  data?: unknown;
}

/**
 * Union of all known engine event shapes.
 */
export type EngineEvent =
  | DialogStartedEvent
  | DialogAdvancedEvent
  | DialogEndedEvent
  | SceneChangedEvent
  | PlayerMovedEvent
  | GenericEvent;
