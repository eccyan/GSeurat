import { create } from 'zustand';
import { migrateBricklayerFile } from '../lib/migrateBricklayerFile.js';
import { createEmptyRegistry, type AssetRegistry } from '@gseurat/project-root';
import { BRICKLAYER_FILE_VERSION } from './types.js';
import type {
  StaticLight,
  GameObjectData,
  ComponentSchema,
  GsParticleEmitterData,
  GsAnimationGroupData,
  VfxInstanceData,
  EmitterConfig,
  BackgroundLayer,
  WeatherData,
  DayNightData,
  GaussianSplatConfig,
  PlayerData,
  InspectorTab,
  SettingsCategory,
  SelectedEntity,
  BricklayerFile,
  CollisionGridData,
  AssetEntry,
  NavigationNode,
  CameraZoneVolume,
  CameraZoneTrigger,
  CameraZoneRail,
  CameraZoneParams,
  AudioZoneData,
} from './types.js';
import { DEFAULT_CAMERA_ZONE_PARAMS } from './types.js';

export const BUILTIN_SCHEMAS: ComponentSchema[] = [
  { name: 'Health', description: 'Destructible entity', category: 'Gameplay',
    fields: [
      { name: 'max_hp', type: 'float', default: 100, min: 0 },
      { name: 'current_hp', type: 'float', default: 100, min: 0 },
    ]},
  { name: 'Interactable', description: 'Player interaction', category: 'Gameplay',
    fields: [
      { name: 'prompt', type: 'string', default: 'Interact' },
      { name: 'radius', type: 'float', default: 2.0, min: 0.1, max: 50 },
      { name: 'one_shot', type: 'bool', default: false },
    ]},
  { name: 'Facing', description: 'Direction entity faces', category: 'Core',
    fields: [
      { name: 'direction', type: 'enum', default: 'down', enum_values: ['up', 'down', 'left', 'right'] },
    ]},
  { name: 'Patrol', description: 'Patrol between waypoints', category: 'AI',
    fields: [
      { name: 'speed', type: 'float', default: 2.0, min: 0 },
      { name: 'pause', type: 'float', default: 1.0, min: 0 },
    ]},
  { name: 'Dialog', description: 'Entity speaks dialog', category: 'Narrative',
    fields: [
      { name: 'dialog_id', type: 'string', default: '' },
    ]},
  { name: 'CharacterModel', description: 'Voxel character', category: 'Visual',
    fields: [
      { name: 'character_id', type: 'string', default: '' },
      { name: 'manifest', type: 'string', default: '' },
    ]},
  // ── Engine-registered components (mirror of examples/island_demo/assets/components/*.schema.json) ──
  { name: 'ProximityTrigger', description: 'Triggers when a player enters proximity radius', category: 'Gameplay',
    fields: [
      { name: 'radius', type: 'float', default: 5, min: 0.1 },
      { name: 'one_shot', type: 'bool', default: false },
    ]},
  { name: 'PortalTarget', description: 'Pair with ProximityTrigger on a Game Object to make it a scene portal. effect_type selects the visual: 0 = solid color fade, 1 = left-to-right wipe, 2 = iris wipe (circular).', category: 'Gameplay',
    fields: [
      { name: 'target_scene', type: 'string', default: '' },
      { name: 'target_position', type: 'vec3', default: [0, 0, 0] },
      { name: 'transition_color', type: 'vec3', default: [1, 1, 1] },
      { name: 'transition_duration', type: 'float', default: 0.5, min: 0 },
      { name: 'effect_type', type: 'int', default: 0, min: 0, max: 2 },
    ]},
  { name: 'LinkedTrigger', description: 'Links this entity to another entity as a trigger target', category: 'Gameplay',
    fields: [
      { name: 'target_entity', type: 'int', default: 0 },
    ]},
  { name: 'LightToggle', description: 'Toggles a dynamic light on or off with configurable color and radius', category: 'Effects',
    fields: [
      { name: 'color_r', type: 'float', default: 1, min: 0, max: 1 },
      { name: 'color_g', type: 'float', default: 1, min: 0, max: 1 },
      { name: 'color_b', type: 'float', default: 1, min: 0, max: 1 },
      { name: 'radius', type: 'float', default: 10, min: 0 },
      { name: 'intensity', type: 'float', default: 1, min: 0 },
    ]},
  { name: 'EmitterToggle', description: 'Toggles a particle emitter on or off', category: 'Effects',
    fields: [
      { name: 'emitter_index', type: 'int', default: 0, min: 0 },
    ]},
  { name: 'EmissiveToggle', description: 'Toggles emissive glow on Gaussian splat objects', category: 'Effects',
    fields: [
      { name: 'emission', type: 'float', default: 2, min: 0 },
      { name: 'color_r', type: 'float', default: 1, min: 0, max: 1 },
      { name: 'color_g', type: 'float', default: 1, min: 0, max: 1 },
      { name: 'color_b', type: 'float', default: 1, min: 0, max: 1 },
      { name: 'effect_radius', type: 'float', default: 3, min: 0 },
    ]},
  { name: 'BurstEffect', description: 'Fires a one-shot burst from a particle emitter', category: 'Effects',
    fields: [
      { name: 'emitter_index', type: 'int', default: 0, min: 0 },
    ]},
  { name: 'ScatterEffect', description: 'Scatters particles in a radius for a limited lifetime', category: 'Effects',
    fields: [
      { name: 'radius', type: 'float', default: 2, min: 0 },
      { name: 'lifetime', type: 'float', default: 2, min: 0 },
    ]},
  { name: 'PlayerController', description: 'Player movement controller with speed and acceleration', category: 'Player',
    fields: [
      { name: 'speed', type: 'float', default: 10, min: 0 },
      { name: 'acceleration', type: 'float', default: 10, min: 0 },
    ]},
  { name: 'ScreenFade', description: 'Full-screen color overlay consumed by the post-process composite. Generic — used for portal transitions, damage flashes, ambient tints, cutscene fades, etc. effect_type selects the visual: 0 = solid color fade, 1 = left-to-right wipe, 2 = iris wipe (circular).', category: 'Effects',
    fields: [
      { name: 'transition_color', type: 'vec3', default: [1, 1, 1] },
      { name: 'alpha', type: 'float', default: 0, min: 0, max: 1 },
      { name: 'effect_type', type: 'int', default: 0, min: 0, max: 2 },
    ]},
  { name: 'AudioZone', description: 'Spatial trigger that plays/transitions interactive music when the player enters or exits', category: 'Audio',
    fields: [
      { name: 'track_group_name', type: 'string', default: '' },
      { name: 'on_enter_action', type: 'string', default: 'play' },
      { name: 'enter_xfade_ms', type: 'float', default: 1000, min: 0, max: 5000 },
      { name: 'align_to_next_marker', type: 'bool', default: true },
      { name: 'on_exit_action', type: 'string', default: 'stop' },
      { name: 'exit_fade_ms', type: 'float', default: 500, min: 0, max: 5000 },
    ]},
];

function defaultEmitter(): EmitterConfig {
  return {
    spawn_rate: 10,
    particle_lifetime_min: 0.5,
    particle_lifetime_max: 1.5,
    velocity_min: [-0.5, -0.5],
    velocity_max: [0.5, 0.5],
    acceleration: [0, 0],
    size_min: 1,
    size_max: 2,
    size_end_scale: 0.5,
    color_start: [1, 1, 1, 1],
    color_end: [1, 1, 1, 0],
    tile: '',
    z: 0,
    spawn_offset_min: [0, 0],
    spawn_offset_max: [0, 0],
  };
}

function defaultWeather(): WeatherData {
  return {
    enabled: false,
    type: 'rain',
    emitter: defaultEmitter(),
    ambient_override: [0.3, 0.3, 0.4, 1],
    fog_density: 0,
    fog_color: [0.5, 0.5, 0.6],
    transition_speed: 1,
  };
}

function defaultDayNight(): DayNightData {
  return {
    enabled: false,
    cycle_speed: 1,
    initial_time: 0.25,
    keyframes: [
      { time: 0, ambient: [0.05, 0.05, 0.15, 1], torch_intensity: 1 },
      { time: 0.25, ambient: [0.8, 0.7, 0.5, 1], torch_intensity: 0 },
      { time: 0.5, ambient: [1, 1, 0.95, 1], torch_intensity: 0 },
      { time: 0.75, ambient: [0.8, 0.4, 0.3, 1], torch_intensity: 0.3 },
    ],
  };
}

function defaultGaussianSplat(): GaussianSplatConfig {
  return {
    ply_file: '',
    camera: { position: [0, 5, 10], target: [0, 0, 0], fov: 45 },
    render_width: 320,
    render_height: 240,
    scale_multiplier: 1,
    background_image: '',
    parallax: {
      azimuth_range: 15,
      elevation_min: -5,
      elevation_max: 5,
      distance_range: 2,
      parallax_strength: 1,
    },
    morphPairPly: '',
    morphDuration: 1.5,
    morphDefaultBlend: 0.0,
    morphEasing: 'linear',
  };
}

function defaultPlayer(): PlayerData {
  return {
    position: [0, 0, 0],
    tint: [1, 1, 1, 1],
    facing: 'down',
    character_id: '',
  };
}

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

export interface SceneStoreState {
  // Editor workspace size (used by Grid display and camera positioning)
  gridWidth: number;
  gridDepth: number;

  // Project management
  projectName: string;
  projectHandle: FileSystemDirectoryHandle | null;
  /**
   * Absolute disk path the bridge has been told about (Phase 0.1 #2). Set
   * via Connect Bridge to Project Root… or restored automatically on
   * bootstrap from `loadBridgePath`. Null when no bridge connection has
   * been established this session.
   */
  bridgeConnectedPath: string | null;
  assets: AssetEntry[];
  asset_registry: AssetRegistry;
  assetBlobs: Map<string, Blob>;
  activeNode: NavigationNode | null;

  // Save state
  isDirty: boolean;
  lastSavedAt: number | null;

  // Grab mode
  grabMode: boolean;
  grabOriginalPosition: [number, number, number] | null;
  grabAxisLock: 'free' | 'x' | 'y' | 'z';

  // Orbit lock
  orbitLocked: boolean;

  // Spline editing
  editingSpline: string | null;

  // Scene elements
  ambientColor: [number, number, number, number];
  godRaysIntensity: number;
  staticLights: StaticLight[];
  gameObjects: GameObjectData[];
  componentSchemas: ComponentSchema[];
  gsParticleEmitters: GsParticleEmitterData[];
  gsAnimations: GsAnimationGroupData[];
  vfxInstances: VfxInstanceData[];
  player: PlayerData;
  backgroundLayers: BackgroundLayer[];
  torchEmitter: EmitterConfig;
  torchPositions: [number, number][];
  footstepEmitter: EmitterConfig;
  npcAuraEmitter: EmitterConfig;
  weather: WeatherData;
  dayNight: DayNightData;
  gaussianSplat: GaussianSplatConfig;
  collisionGridData: CollisionGridData | null;
  navZoneNames: string[];
  cameraVolumes: CameraZoneVolume[];
  cameraTriggers: CameraZoneTrigger[];
  cameraRails: CameraZoneRail[];
  cameraDefaultParams: Partial<CameraZoneParams>;
  cameraShowDebugVolumes: boolean;
  savedEditorCamera: { position: [number,number,number]; target: [number,number,number] } | null;
  audioZones: AudioZoneData[];

  // Editor state
  selectedEntity: SelectedEntity | null;
  inspectorTab: InspectorTab;
  showGrid: boolean;
  showCollision: boolean;
  showGizmos: boolean;
  showTerrainPly: boolean;
  showObjectPly: boolean;
  terrainPlyFile: string;
  stagingAutoSync: boolean;
  selectedSettingsCategory: SettingsCategory;

  // Actions – scene
  setAmbientColor: (c: [number, number, number, number]) => void;
  setGodRaysIntensity: (v: number) => void;
  addLight: (position?: [number, number, number]) => void;
  updateLight: (id: string, patch: Partial<StaticLight>) => void;
  removeLight: (id: string) => void;
  addGameObject: (position?: [number, number, number]) => void;
  updateGameObject: (id: string, patch: Partial<GameObjectData>) => void;
  removeGameObject: (id: string) => void;
  loadComponentSchemas: (schemas: ComponentSchema[]) => void;
  storeAssetBlob: (path: string, blob: Blob) => void;
  addGsEmitter: (position?: [number, number, number]) => void;
  updateGsEmitter: (id: string, patch: Partial<GsParticleEmitterData>) => void;
  removeGsEmitter: (id: string) => void;
  addGsAnimation: (center?: [number, number, number]) => void;
  updateGsAnimation: (id: string, patch: Partial<GsAnimationGroupData>) => void;
  removeGsAnimation: (id: string) => void;
  addVfxInstance: (data: VfxInstanceData) => void;
  updateVfxInstance: (id: string, patch: Partial<VfxInstanceData>) => void;
  removeVfxInstance: (id: string) => void;
  addAudioZone: () => void;
  updateAudioZone: (id: string, patch: Partial<AudioZoneData>) => void;
  removeAudioZone: (id: string) => void;
  addCameraVolume: (position?: [number, number, number]) => void;
  updateCameraVolume: (id: string, patch: Partial<CameraZoneVolume>) => void;
  removeCameraVolume: (id: string) => void;
  addCameraTrigger: (position?: [number, number, number]) => void;
  updateCameraTrigger: (id: string, patch: Partial<CameraZoneTrigger>) => void;
  removeCameraTrigger: (id: string) => void;
  addCameraRail: () => void;
  updateCameraRail: (id: string, patch: Partial<CameraZoneRail>) => void;
  removeCameraRail: (id: string) => void;
  addRailControlPoint: (railId: string, point: [number, number, number]) => void;
  removeRailControlPoint: (railId: string, index: number) => void;
  updateRailControlPoint: (railId: string, index: number, point: [number, number, number]) => void;
  updateCameraDefaultParams: (patch: Partial<CameraZoneParams>) => void;
  setCameraShowDebugVolumes: (show: boolean) => void;
  importCameraZonesJson: (data: Record<string, unknown>) => void;
  updatePlayer: (patch: Partial<PlayerData>) => void;
  addBackgroundLayer: () => void;
  updateBackgroundLayer: (id: string, patch: Partial<BackgroundLayer>) => void;
  removeBackgroundLayer: (id: string) => void;
  setTorchEmitter: (e: EmitterConfig) => void;
  setTorchPositions: (p: [number, number][]) => void;
  addTorchPosition: (pos: [number, number]) => void;
  removeTorchPosition: (index: number) => void;
  setFootstepEmitter: (e: EmitterConfig) => void;
  setNpcAuraEmitter: (e: EmitterConfig) => void;
  setWeather: (w: Partial<WeatherData>) => void;
  setDayNight: (d: Partial<DayNightData>) => void;
  setGaussianSplat: (g: Partial<GaussianSplatConfig>) => void;
  // Actions – project
  setProjectName: (name: string) => void;
  setProjectHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setBridgeConnectedPath: (path: string | null) => void;
  addAsset: (asset: AssetEntry) => void;
  removeAsset: (id: string) => void;
  setAssetRegistry: (reg: AssetRegistry) => void;
  setActiveNode: (node: NavigationNode | null) => void;
  markDirty: () => void;
  markClean: () => void;

  // Actions – grab
  setGrabMode: (v: boolean) => void;
  setGrabOriginalPosition: (pos: [number, number, number] | null) => void;
  setGrabAxisLock: (axis: 'free' | 'x' | 'y' | 'z') => void;
  setOrbitLocked: (v: boolean) => void;
  setEditingSpline: (id: string | null) => void;

  // Actions – editor
  setSelectedEntity: (e: SelectedEntity | null) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setShowGrid: (v: boolean) => void;
  setShowCollision: (v: boolean) => void;
  setShowGizmos: (v: boolean) => void;
  setShowTerrainPly: (v: boolean) => void;
  setShowObjectPly: (v: boolean) => void;
  setTerrainPlyFile: (v: string) => void;
  setStagingAutoSync: (v: boolean) => void;
  setSavedEditorCamera: (v: { position: [number,number,number]; target: [number,number,number] } | null) => void;
  setSelectedSettingsCategory: (cat: SettingsCategory) => void;

  // Actions – file
  newScene: (width: number, depth: number) => void;
  saveProject: () => BricklayerFile;
  loadProject: (data: any) => void;
}

export const useSceneStore = create<SceneStoreState>((set, get) => ({
  gridWidth: 128,
  gridDepth: 96,

  projectName: 'Untitled',
  projectHandle: null,
  bridgeConnectedPath: null,
  assets: [],
  asset_registry: createEmptyRegistry(),
  assetBlobs: new Map(),
  activeNode: null,
  isDirty: false,
  lastSavedAt: null,

  grabMode: false,
  grabOriginalPosition: null,
  grabAxisLock: 'free' as const,
  orbitLocked: false,
  editingSpline: null,

  ambientColor: [0.25, 0.28, 0.45, 1],
  godRaysIntensity: 0,
  staticLights: [],
  gameObjects: [] as GameObjectData[],
  componentSchemas: [] as ComponentSchema[],
  gsParticleEmitters: [],
  gsAnimations: [],
  vfxInstances: [] as VfxInstanceData[],
  player: defaultPlayer(),
  backgroundLayers: [],
  torchEmitter: defaultEmitter(),
  torchPositions: [],
  footstepEmitter: defaultEmitter(),
  npcAuraEmitter: defaultEmitter(),
  weather: defaultWeather(),
  dayNight: defaultDayNight(),
  gaussianSplat: defaultGaussianSplat(),
  collisionGridData: null,
  navZoneNames: [],
  cameraVolumes: [],
  cameraTriggers: [],
  cameraRails: [],
  cameraDefaultParams: {},
  cameraShowDebugVolumes: false,
  savedEditorCamera: null,
  audioZones: [] as AudioZoneData[],

  selectedEntity: null,
  inspectorTab: 'scene',
  showGrid: true,
  showCollision: false,
  showGizmos: true,
  showTerrainPly: false,
  showObjectPly: true,
  terrainPlyFile: '',
  stagingAutoSync: false,
  selectedSettingsCategory: 'gs_camera',

  // ── Scene actions ──
  setAmbientColor: (c) => set({ ambientColor: c }),
  setGodRaysIntensity: (v: number) => set({ godRaysIntensity: v, isDirty: true }),

  addLight: (pos?) => {
    const light: StaticLight = {
      id: genId('light'),
      position: pos ?? [0, 2, 0],
      radius: 5,
      color: [1, 0.9, 0.7],
      intensity: 1,
    };
    set({ staticLights: [...get().staticLights, light], isDirty: true });
  },
  updateLight: (id, patch) => set({
    staticLights: get().staticLights.map((l) => (l.id === id ? { ...l, ...patch } : l)), isDirty: true,
  }),
  removeLight: (id) => set({
    staticLights: get().staticLights.filter((l) => l.id !== id), isDirty: true,
  }),

  addGameObject: (pos?) => {
    const obj: GameObjectData = {
      id: `go_${Date.now()}`,
      name: 'New Object',
      position: (pos ?? [0, 0, 0]) as [number, number, number],
      rotation: [0, 0, 0],
      scale: 1,
      ply_file: '',
      components: {},
    };
    set({ gameObjects: [...get().gameObjects, obj], isDirty: true });
  },
  updateGameObject: (id, patch) => set({
    gameObjects: get().gameObjects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    isDirty: true,
  }),
  removeGameObject: (id) => set({
    gameObjects: get().gameObjects.filter((o) => o.id !== id),
    isDirty: true,
  }),
  loadComponentSchemas: (schemas) => set({ componentSchemas: schemas }),

  storeAssetBlob: (path, blob) => {
    const blobs = new Map(get().assetBlobs);
    blobs.set(path, blob);
    set({ assetBlobs: blobs });
  },

  addGsEmitter: (pos?) => {
    const emitter: GsParticleEmitterData = {
      id: genId('gs_emitter'),
      preset: '',
      position: pos ?? [0, 2, 0],
      spawn_rate: 10,
      lifetime_min: 0.5,
      lifetime_max: 1.5,
      velocity_min: [-1, 1, -1],
      velocity_max: [1, 3, 1],
      acceleration: [0, -9.8, 0],
      color_start: [1, 0.8, 0.3],
      color_end: [1, 0.2, 0],
      scale_min: [0.3, 0.3, 0.3],
      scale_max: [0.6, 0.6, 0.6],
      scale_end_factor: 0,
      opacity_start: 1,
      opacity_end: 0,
      emission: 0,
      spawn_region: { shape: 'sphere', radius: 1, center: [0, 0, 0], half_extents: [1, 1, 1] },
      burst_duration: 0,
    };
    set({ gsParticleEmitters: [...get().gsParticleEmitters, emitter], isDirty: true });
  },
  updateGsEmitter: (id, patch) => set({
    gsParticleEmitters: get().gsParticleEmitters.map((e) => (e.id === id ? { ...e, ...patch } : e)), isDirty: true,
  }),
  removeGsEmitter: (id) => set({
    gsParticleEmitters: get().gsParticleEmitters.filter((e) => e.id !== id), isDirty: true,
  }),

  addGsAnimation: (center?) => {
    const anim: GsAnimationGroupData = {
      id: genId('gs_anim'),
      effect: 'orbit',
      shape: 'sphere',
      center: center ?? [0, 2, 0],
      radius: 5,
      half_extents: [5, 5, 5],
      lifetime: 4,
      loop: true,
      params: {
        rotations: 1, rotations_easing: 'linear' as const,
        expansion: 1, expansion_easing: 'linear' as const,
        height_rise: 0, height_easing: 'linear' as const,
        opacity_end: 0, opacity_easing: 'linear' as const,
        scale_end: 0, scale_easing: 'linear' as const,
        velocity: 1, gravity: [0, -9.8, 0] as [number, number, number],
        noise: 1, wave_speed: 5, pulse_frequency: 4,
      },
      reform_enabled: false,
      reform_lifetime: 2,
    };
    set({ gsAnimations: [...get().gsAnimations, anim], isDirty: true });
  },
  updateGsAnimation: (id, patch) => set({
    gsAnimations: get().gsAnimations.map((a) => (a.id === id ? { ...a, ...patch } : a)), isDirty: true,
  }),
  removeGsAnimation: (id) => set({
    gsAnimations: get().gsAnimations.filter((a) => a.id !== id), isDirty: true,
  }),
  addVfxInstance: (data) => set({ vfxInstances: [...get().vfxInstances, data], isDirty: true }),
  updateVfxInstance: (id, patch) => set({
    vfxInstances: get().vfxInstances.map((v) => (v.id === id ? { ...v, ...patch } : v)), isDirty: true,
  }),
  removeVfxInstance: (id) => set({
    vfxInstances: get().vfxInstances.filter((v) => v.id !== id), isDirty: true,
  }),

  // ── Audio Zone actions ──
  addAudioZone: () => {
    const zones = get().audioZones;
    const zone: AudioZoneData = {
      id: genId('audiozone'),
      name: `Audio Zone ${zones.length + 1}`,
      bounds: { type: 'aabb', min: [-5, 0, -5], max: [5, 5, 5] },
      track_group_name: '',
      on_enter: { action: 'play', xfade_ms: 1000, align_to_next_marker: true },
      on_exit: { action: 'stop', fade_ms: 500 },
    };
    set({ audioZones: [...zones, zone], isDirty: true });
  },
  updateAudioZone: (id, patch) => set({
    audioZones: get().audioZones.map((z) => (z.id === id ? { ...z, ...patch } : z)), isDirty: true,
  }),
  removeAudioZone: (id) => set({
    audioZones: get().audioZones.filter((z) => z.id !== id), isDirty: true,
  }),

  // ── Camera Zone actions ──
  addCameraVolume: (pos?) => {
    const volumes = get().cameraVolumes;
    const volume: CameraZoneVolume = {
      id: genId('camvol'),
      name: `Volume ${volumes.length + 1}`,
      shape: {
        type: 'aabb',
        center: pos ?? [0, 2, 0],
        half_extents: [5, 5, 5],
      },
      params: { ...DEFAULT_CAMERA_ZONE_PARAMS },
    };
    set({ cameraVolumes: [...volumes, volume], isDirty: true });
  },
  updateCameraVolume: (id, patch) => set({
    cameraVolumes: get().cameraVolumes.map((v) => (v.id === id ? { ...v, ...patch } : v)), isDirty: true,
  }),
  removeCameraVolume: (id) => set({
    cameraVolumes: get().cameraVolumes.filter((v) => v.id !== id), isDirty: true,
  }),

  addCameraTrigger: (pos?) => {
    const trigger: CameraZoneTrigger = {
      id: genId('camtrig'),
      shape: {
        type: 'aabb',
        center: pos ?? [0, 2, 0],
        half_extents: [1, 3, 3],
      },
      to_zone: '',
      blend_override: -1,
    };
    set({ cameraTriggers: [...get().cameraTriggers, trigger], isDirty: true });
  },
  updateCameraTrigger: (id, patch) => set({
    cameraTriggers: get().cameraTriggers.map((t) => (t.id === id ? { ...t, ...patch } : t)), isDirty: true,
  }),
  removeCameraTrigger: (id) => set({
    cameraTriggers: get().cameraTriggers.filter((t) => t.id !== id), isDirty: true,
  }),

  addCameraRail: () => {
    const rails = get().cameraRails;
    const rail: CameraZoneRail = {
      id: genId('camrail'),
      name: `Rail ${rails.length + 1}`,
      control_points: [
        [0, 5, -10],
        [0, 5, 0],
        [0, 5, 10],
      ],
    };
    set({ cameraRails: [...rails, rail], isDirty: true });
  },
  updateCameraRail: (id, patch) => set({
    cameraRails: get().cameraRails.map((r) => (r.id === id ? { ...r, ...patch } : r)), isDirty: true,
  }),
  removeCameraRail: (id) => set({
    cameraRails: get().cameraRails.filter((r) => r.id !== id), isDirty: true,
  }),
  addRailControlPoint: (railId, point) => set({
    cameraRails: get().cameraRails.map((r) =>
      r.id === railId ? { ...r, control_points: [...r.control_points, point] } : r
    ), isDirty: true,
  }),
  removeRailControlPoint: (railId, index) => set({
    cameraRails: get().cameraRails.map((r) =>
      r.id === railId
        ? { ...r, control_points: r.control_points.filter((_, i) => i !== index) }
        : r
    ), isDirty: true,
  }),
  updateRailControlPoint: (railId, index, point) => set({
    cameraRails: get().cameraRails.map((r) =>
      r.id === railId
        ? { ...r, control_points: r.control_points.map((p, i) => (i === index ? point : p)) }
        : r
    ), isDirty: true,
  }),

  updateCameraDefaultParams: (patch) => set({
    cameraDefaultParams: { ...get().cameraDefaultParams, ...patch }, isDirty: true,
  }),
  setCameraShowDebugVolumes: (show) => set({ cameraShowDebugVolumes: show }),

  importCameraZonesJson: (data) => {
    const zones = data.camera_zones as Record<string, unknown> | undefined;
    if (!zones) return;

    const rawVolumes = (zones.volumes as Record<string, unknown>[] | undefined) ?? [];
    const rawRails = (zones.rails as Record<string, unknown>[] | undefined) ?? [];
    const rawTriggers = (zones.triggers as Record<string, unknown>[] | undefined) ?? [];

    const newVolumes: CameraZoneVolume[] = rawVolumes.map((v) => ({
      id: genId('camvol'),
      name: (v.name as string | undefined) ?? 'Imported Volume',
      shape: (v.shape as CameraZoneVolume['shape']) ?? { type: 'aabb', center: [0, 2, 0], half_extents: [5, 5, 5] },
      params: { ...DEFAULT_CAMERA_ZONE_PARAMS, ...(v.params as Partial<CameraZoneParams> | undefined) },
    }));

    const newRails: CameraZoneRail[] = rawRails.map((r) => ({
      id: genId('camrail'),
      name: (r.name as string | undefined) ?? 'Imported Rail',
      control_points: (r.control_points as [number, number, number][]) ?? [],
      ...(r.target_points !== undefined ? { target_points: r.target_points as [number, number, number][] } : {}),
    }));

    const newTriggers: CameraZoneTrigger[] = rawTriggers.map((t) => ({
      id: genId('camtrig'),
      shape: (t.shape as CameraZoneTrigger['shape']) ?? { type: 'aabb', center: [0, 2, 0], half_extents: [1, 3, 3] },
      to_zone: (t.to_zone as string) ?? '',
      ...(t.from_zone !== undefined ? { from_zone: t.from_zone as string } : {}),
      blend_override: (t.blend_override as number | undefined) ?? -1,
    }));

    const st = get();
    const patch: Partial<SceneStoreState> = {
      cameraVolumes: [...st.cameraVolumes, ...newVolumes],
      cameraRails: [...st.cameraRails, ...newRails],
      cameraTriggers: [...st.cameraTriggers, ...newTriggers],
      isDirty: true,
    };

    if (zones.default_params) {
      patch.cameraDefaultParams = {
        ...st.cameraDefaultParams,
        ...(zones.default_params as Partial<CameraZoneParams>),
      };
    }

    set(patch);
  },

  updatePlayer: (patch) => set({ player: { ...get().player, ...patch }, isDirty: true }),

  addBackgroundLayer: () => {
    const layer: BackgroundLayer = {
      id: genId('bg'),
      texture: '',
      z: 0,
      parallax_factor: 1,
      quad_width: 320,
      quad_height: 240,
      uv_repeat_x: 1,
      uv_repeat_y: 1,
      tint: [1, 1, 1, 1],
      wall: false,
      wall_y_offset: 0,
    };
    set({ backgroundLayers: [...get().backgroundLayers, layer] });
  },
  updateBackgroundLayer: (id, patch) => set({
    backgroundLayers: get().backgroundLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }),
  removeBackgroundLayer: (id) => set({
    backgroundLayers: get().backgroundLayers.filter((l) => l.id !== id),
  }),

  setTorchEmitter: (e) => set({ torchEmitter: e }),
  setTorchPositions: (p) => set({ torchPositions: p }),
  addTorchPosition: (pos) => set({ torchPositions: [...get().torchPositions, pos] }),
  removeTorchPosition: (index) => set({
    torchPositions: get().torchPositions.filter((_, i) => i !== index),
  }),
  setFootstepEmitter: (e) => set({ footstepEmitter: e }),
  setNpcAuraEmitter: (e) => set({ npcAuraEmitter: e }),

  setWeather: (w) => set({ weather: { ...get().weather, ...w } }),
  setDayNight: (d) => set({ dayNight: { ...get().dayNight, ...d } }),
  setGaussianSplat: (g) => set({ gaussianSplat: { ...get().gaussianSplat, ...g } }),

  // ── Project actions ──
  setProjectName: (name) => set({ projectName: name }),
  setProjectHandle: (handle) => set({ projectHandle: handle }),
  setBridgeConnectedPath: (path) => set({ bridgeConnectedPath: path }),
  addAsset: (asset) => set({ assets: [...get().assets, asset] }),
  removeAsset: (id) => set({ assets: get().assets.filter((a) => a.id !== id) }),
  setAssetRegistry: (reg) => set({ asset_registry: reg }),
  setActiveNode: (node) => set({ activeNode: node }),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false, lastSavedAt: Date.now() }),

  // ── Grab actions ──
  setGrabMode: (v) => set({ grabMode: v }),
  setGrabOriginalPosition: (pos) => set({ grabOriginalPosition: pos }),
  setGrabAxisLock: (axis) => set({ grabAxisLock: axis }),
  setOrbitLocked: (v) => set({ orbitLocked: v }),
  setEditingSpline: (id) => {
    if (id) {
      set({ editingSpline: id, orbitLocked: true });
    } else {
      set({ editingSpline: null, orbitLocked: false });
    }
  },

  // ── Editor actions ──
  setSelectedEntity: (e) => set({ selectedEntity: e }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowCollision: (v) => set({ showCollision: v }),
  setShowGizmos: (v) => set({ showGizmos: v }),
  setShowTerrainPly: (v) => set({ showTerrainPly: v }),
  setShowObjectPly: (v) => set({ showObjectPly: v }),
  setTerrainPlyFile: (v) => set({ terrainPlyFile: v }),
  setStagingAutoSync: (v) => set({ stagingAutoSync: v }),
  setSavedEditorCamera: (v) => set({ savedEditorCamera: v }),
  setSelectedSettingsCategory: (cat) => set({ selectedSettingsCategory: cat }),

  // ── File actions ──
  newScene: (width, depth) => set({
    gridWidth: width,
    gridDepth: depth,
    collisionGridData: null,
    navZoneNames: [],
    staticLights: [],
    gameObjects: [],
    componentSchemas: BUILTIN_SCHEMAS,
    gsParticleEmitters: [],
    vfxInstances: [],
    player: defaultPlayer(),
    backgroundLayers: [],
    torchPositions: [],
    weather: defaultWeather(),
    dayNight: defaultDayNight(),
    gaussianSplat: defaultGaussianSplat(),
  }),

  // ── File ──

  saveProject: () => {
    const s = get();
    return {
      version: BRICKLAYER_FILE_VERSION,
      asset_registry: s.asset_registry,
      gridWidth: s.gridWidth,
      gridDepth: s.gridDepth,
      collisionGridData: s.collisionGridData ?? undefined,
      nav_zone_names: s.navZoneNames.length > 0 ? s.navZoneNames : undefined,
      assets: s.assets.length > 0 ? s.assets : undefined,
      scene: {
        ambientColor: s.ambientColor,
        godRaysIntensity: s.godRaysIntensity,
        staticLights: s.staticLights,
        gameObjects: s.gameObjects.length > 0 ? s.gameObjects : undefined,
        player: s.player,
        backgroundLayers: s.backgroundLayers,
        torchEmitter: s.torchEmitter,
        torchPositions: s.torchPositions,
        footstepEmitter: s.footstepEmitter,
        npcAuraEmitter: s.npcAuraEmitter,
        weather: s.weather,
        dayNight: s.dayNight,
        gaussianSplat: s.gaussianSplat,
        gsParticleEmitters: s.gsParticleEmitters,
        gsAnimations: s.gsAnimations,
        vfxInstances: s.vfxInstances.length > 0 ? s.vfxInstances : undefined,
        cameraVolumes: s.cameraVolumes.length > 0 ? s.cameraVolumes : undefined,
        cameraTriggers: s.cameraTriggers.length > 0 ? s.cameraTriggers : undefined,
        cameraRails: s.cameraRails.length > 0 ? s.cameraRails : undefined,
        cameraDefaultParams: Object.keys(s.cameraDefaultParams).length > 0 ? s.cameraDefaultParams : undefined,
        cameraShowDebugVolumes: s.cameraShowDebugVolumes || undefined,
        audioZones: s.audioZones.length > 0 ? s.audioZones : undefined,
      },
    };
  },

  loadProject: (raw) => {
    const data = migrateBricklayerFile(raw);
    // Migrate old vec2 positions to vec3
    const migratedLights: StaticLight[] = data.scene.staticLights.map((l) => {
      const raw = l as StaticLight & { height?: number };
      const pos = raw.position as unknown as number[];
      if (pos.length === 2) {
        // Old format: position=[x, z], height=y
        const h = raw.height ?? 2;
        const { height: _, ...rest } = raw;
        return { ...rest, position: [pos[0], h, pos[1]] as [number, number, number] };
      }
      // Already vec3 — strip height if present
      const { height: _, ...rest } = raw;
      return rest as StaticLight;
    });
    set({
      gridWidth: data.gridWidth,
      gridDepth: data.gridDepth,
      collisionGridData: data.collisionGridData ?? null,
      navZoneNames: data.nav_zone_names ?? [],
      assets: data.assets ?? [],
      asset_registry: data.asset_registry,
      ambientColor: data.scene.ambientColor,
      godRaysIntensity: data.scene.godRaysIntensity ?? 0,
      staticLights: migratedLights,
      gameObjects: (() => {
        let gameObjects: GameObjectData[] = data.scene.gameObjects ?? [];
        if (gameObjects.length === 0) {
          if (data.scene.placedObjects) {
            for (const obj of data.scene.placedObjects as any[]) {
              gameObjects.push({
                id: obj.id || `go_${Date.now()}_${Math.random()}`,
                name: obj.id || 'Object',
                position: obj.position,
                rotation: obj.rotation ?? [0, 0, 0],
                scale: obj.scale ?? 1,
                ply_file: obj.ply_file ?? '',
                components: obj.character_manifest ? { CharacterModel: { manifest: obj.character_manifest } } : {},
              });
            }
          }
          if (data.scene.npcs) {
            for (const npc of data.scene.npcs as any[]) {
              const comps: Record<string, Record<string, unknown>> = {};
              if (npc.facing) comps.Facing = { direction: npc.facing };
              if (npc.waypoints?.length) comps.Patrol = { speed: npc.patrol_speed, waypoints: npc.waypoints, pause: npc.waypoint_pause };
              if (npc.character_id) comps.CharacterModel = { character_id: npc.character_id };
              gameObjects.push({
                id: `npc_${npc.name || Date.now()}`,
                name: npc.name || 'NPC',
                position: npc.position,
                rotation: [0, 0, 0],
                scale: 1,
                ply_file: '',
                components: comps,
              });
            }
          }
        }
        return gameObjects;
      })(),
      gsParticleEmitters: data.scene.gsParticleEmitters ?? [],
      gsAnimations: data.scene.gsAnimations ?? [],
      vfxInstances: (data.scene.vfxInstances ?? []).map((v: any, i: number) => ({
        ...v,
        id: v.id || `vfx_${i}_${Date.now().toString(36)}`,
        name: v.name || v.vfx_file?.replace(/^.*\//, '').replace(/\.vfx\.json$/, '') || `VFX ${i}`,
      })),
      cameraVolumes: data.scene.cameraVolumes ?? [],
      cameraTriggers: data.scene.cameraTriggers ?? [],
      cameraRails: data.scene.cameraRails ?? [],
      cameraDefaultParams: data.scene.cameraDefaultParams ?? {},
      cameraShowDebugVolumes: data.scene.cameraShowDebugVolumes ?? false,
      audioZones: data.scene.audioZones ?? [],
      savedEditorCamera: null,
      player: data.scene.player,
      backgroundLayers: data.scene.backgroundLayers,
      torchEmitter: data.scene.torchEmitter,
      torchPositions: data.scene.torchPositions,
      footstepEmitter: data.scene.footstepEmitter,
      npcAuraEmitter: data.scene.npcAuraEmitter,
      weather: data.scene.weather,
      dayNight: data.scene.dayNight,
      // Merge with defaults so older v2 files (saved before the Morph Pair
      // fields were added) still produce a fully-populated config.
      gaussianSplat: { ...defaultGaussianSplat(), ...data.scene.gaussianSplat },
    });
  },
}));
