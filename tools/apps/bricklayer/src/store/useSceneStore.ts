import { create } from 'zustand';
import type {
  Voxel,
  VoxelKey,
  StaticLight,
  NpcData,
  PortalData,
  EmitterConfig,
  BackgroundLayer,
  WeatherData,
  DayNightData,
  GaussianSplatConfig,
  PlayerData,
  ToolType,
  InspectorTab,
  SelectedEntity,
  Snapshot,
  BricklayerFile,
} from './types.js';
import { voxelKey, parseKey, floodFill3D, brushPositions } from '../lib/voxelUtils.js';

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

function makeSnapshot(voxels: Map<VoxelKey, Voxel>, collisionGrid: Set<string>): Snapshot {
  return {
    voxels: Array.from(voxels.entries()),
    collisionGrid: Array.from(collisionGrid),
  };
}

function restoreSnapshot(snapshot: Snapshot): { voxels: Map<VoxelKey, Voxel>; collisionGrid: Set<string> } {
  return {
    voxels: new Map(snapshot.voxels),
    collisionGrid: new Set(snapshot.collisionGrid),
  };
}

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

export interface SceneStoreState {
  // Voxels
  voxels: Map<VoxelKey, Voxel>;
  gridWidth: number;
  gridDepth: number;

  // Voxel tools
  activeTool: ToolType;
  activeColor: [number, number, number, number];
  brushSize: number;
  yLevelLock: number | null;

  // Scene elements
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
  collisionGrid: Set<string>;

  // Editor state
  selectedEntity: SelectedEntity | null;
  inspectorTab: InspectorTab;
  showGrid: boolean;
  showCollision: boolean;
  showGizmos: boolean;

  // Undo/redo
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  // Actions – voxels
  pushUndo: () => void;
  placeVoxel: (x: number, y: number, z: number) => void;
  placeVoxels: (positions: [number, number, number][]) => void;
  paintVoxel: (x: number, y: number, z: number) => void;
  eraseVoxel: (x: number, y: number, z: number) => void;
  eraseVoxels: (positions: [number, number, number][]) => void;
  fillVoxels: (x: number, y: number, z: number) => void;
  extrudeVoxels: (positions: [number, number, number][], direction: 'up' | 'down') => void;
  eyedrop: (x: number, y: number, z: number) => void;

  // Actions – tools
  setTool: (tool: ToolType) => void;
  setActiveColor: (color: [number, number, number, number]) => void;
  setBrushSize: (size: number) => void;
  setYLevelLock: (y: number | null) => void;

  // Actions – scene
  setAmbientColor: (c: [number, number, number, number]) => void;
  addLight: () => void;
  updateLight: (id: string, patch: Partial<StaticLight>) => void;
  removeLight: (id: string) => void;
  addNpc: () => void;
  updateNpc: (id: string, patch: Partial<NpcData>) => void;
  removeNpc: (id: string) => void;
  addPortal: () => void;
  updatePortal: (id: string, patch: Partial<PortalData>) => void;
  removePortal: (id: string) => void;
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
  toggleCollision: (x: number, z: number) => void;
  autoGenerateCollision: () => void;

  // Actions – editor
  setSelectedEntity: (e: SelectedEntity | null) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setShowGrid: (v: boolean) => void;
  setShowCollision: (v: boolean) => void;
  setShowGizmos: (v: boolean) => void;

  // Actions – undo/redo
  undo: () => void;
  redo: () => void;

  // Actions – file
  newScene: (width: number, depth: number) => void;
  importImage: (imageData: ImageData, mode: 'flat' | 'luminance' | 'depth', maxHeight: number, depthMap?: Float32Array) => void;
  saveProject: () => BricklayerFile;
  loadProject: (data: BricklayerFile) => void;
}

export const useSceneStore = create<SceneStoreState>((set, get) => ({
  voxels: new Map(),
  gridWidth: 128,
  gridDepth: 96,

  activeTool: 'place',
  activeColor: [34, 139, 34, 255],
  brushSize: 1,
  yLevelLock: null,

  ambientColor: [0.25, 0.28, 0.45, 1],
  staticLights: [],
  npcs: [],
  portals: [],
  player: defaultPlayer(),
  backgroundLayers: [],
  torchEmitter: defaultEmitter(),
  torchPositions: [],
  footstepEmitter: defaultEmitter(),
  npcAuraEmitter: defaultEmitter(),
  weather: defaultWeather(),
  dayNight: defaultDayNight(),
  gaussianSplat: defaultGaussianSplat(),
  collisionGrid: new Set(),

  selectedEntity: null,
  inspectorTab: 'scene',
  showGrid: true,
  showCollision: false,
  showGizmos: true,

  undoStack: [],
  redoStack: [],

  // ── Undo ──
  pushUndo: () => {
    const { voxels, collisionGrid, undoStack } = get();
    const snap = makeSnapshot(voxels, collisionGrid);
    set({ undoStack: [...undoStack.slice(-49), snap], redoStack: [] });
  },

  undo: () => {
    const { undoStack, voxels, collisionGrid } = get();
    if (undoStack.length === 0) return;
    const current = makeSnapshot(voxels, collisionGrid);
    const prev = undoStack[undoStack.length - 1];
    const restored = restoreSnapshot(prev);
    set({
      ...restored,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, current],
    });
  },

  redo: () => {
    const { redoStack, voxels, collisionGrid } = get();
    if (redoStack.length === 0) return;
    const current = makeSnapshot(voxels, collisionGrid);
    const next = redoStack[redoStack.length - 1];
    const restored = restoreSnapshot(next);
    set({
      ...restored,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, current],
    });
  },

  // ── Voxel actions ──
  placeVoxel: (x, y, z) => {
    const { voxels, activeColor } = get();
    const next = new Map(voxels);
    next.set(voxelKey(x, y, z), { color: [...activeColor] });
    set({ voxels: next });
  },

  placeVoxels: (positions) => {
    const { voxels, activeColor } = get();
    const next = new Map(voxels);
    for (const [x, y, z] of positions) {
      next.set(voxelKey(x, y, z), { color: [...activeColor] });
    }
    set({ voxels: next });
  },

  paintVoxel: (x, y, z) => {
    const { voxels, activeColor } = get();
    const key = voxelKey(x, y, z);
    if (!voxels.has(key)) return;
    const next = new Map(voxels);
    next.set(key, { color: [...activeColor] });
    set({ voxels: next });
  },

  eraseVoxel: (x, y, z) => {
    const { voxels } = get();
    const key = voxelKey(x, y, z);
    if (!voxels.has(key)) return;
    const next = new Map(voxels);
    next.delete(key);
    set({ voxels: next });
  },

  eraseVoxels: (positions) => {
    const { voxels } = get();
    const next = new Map(voxels);
    for (const [x, y, z] of positions) {
      next.delete(voxelKey(x, y, z));
    }
    set({ voxels: next });
  },

  fillVoxels: (x, y, z) => {
    const { voxels, activeColor, gridWidth, gridDepth } = get();
    const existing = voxels.get(voxelKey(x, y, z));
    const targetColor: [number, number, number, number] = existing
      ? existing.color
      : [0, 0, 0, 0];
    const keys = floodFill3D(voxels, x, y, z, targetColor, activeColor, {
      minX: 0, maxX: gridWidth - 1,
      minY: 0, maxY: 64,
      minZ: 0, maxZ: gridDepth - 1,
    });
    if (keys.length === 0) return;
    const next = new Map(voxels);
    for (const k of keys) {
      next.set(k, { color: [...activeColor] });
    }
    set({ voxels: next });
  },

  extrudeVoxels: (positions, direction) => {
    const { voxels, activeColor } = get();
    const next = new Map(voxels);
    for (const [x, y, z] of positions) {
      const existing = voxels.get(voxelKey(x, y, z));
      if (!existing) continue;
      const ny = direction === 'up' ? y + 1 : y - 1;
      if (ny < 0) continue;
      next.set(voxelKey(x, ny, z), { color: existing.color });
    }
    set({ voxels: next });
  },

  eyedrop: (x, y, z) => {
    const { voxels } = get();
    const v = voxels.get(voxelKey(x, y, z));
    if (v) set({ activeColor: [...v.color] });
  },

  // ── Tool actions ──
  setTool: (tool) => set({ activeTool: tool }),
  setActiveColor: (color) => set({ activeColor: color }),
  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(8, size)) }),
  setYLevelLock: (y) => set({ yLevelLock: y }),

  // ── Scene actions ──
  setAmbientColor: (c) => set({ ambientColor: c }),

  addLight: () => {
    const light: StaticLight = {
      id: genId('light'),
      position: [0, 0],
      radius: 5,
      height: 2,
      color: [1, 0.9, 0.7],
      intensity: 1,
    };
    set({ staticLights: [...get().staticLights, light] });
  },
  updateLight: (id, patch) => set({
    staticLights: get().staticLights.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }),
  removeLight: (id) => set({
    staticLights: get().staticLights.filter((l) => l.id !== id),
  }),

  addNpc: () => {
    const npc: NpcData = {
      id: genId('npc'),
      name: 'New NPC',
      position: [0, 0, 0],
      tint: [1, 1, 1, 1],
      facing: 'down',
      reverse_facing: 'up',
      patrol_interval: 0,
      patrol_speed: 1,
      waypoints: [],
      waypoint_pause: 1,
      dialog: [],
      light_color: [0, 0, 0, 0],
      light_radius: 0,
      aura_color_start: [0, 0, 0, 0],
      aura_color_end: [0, 0, 0, 0],
      character_id: '',
      script_module: '',
      script_class: '',
    };
    set({ npcs: [...get().npcs, npc] });
  },
  updateNpc: (id, patch) => set({
    npcs: get().npcs.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  }),
  removeNpc: (id) => set({
    npcs: get().npcs.filter((n) => n.id !== id),
  }),

  addPortal: () => {
    const portal: PortalData = {
      id: genId('portal'),
      position: [0, 0],
      size: [2, 2],
      target_scene: '',
      spawn_position: [0, 0, 0],
      spawn_facing: 'down',
    };
    set({ portals: [...get().portals, portal] });
  },
  updatePortal: (id, patch) => set({
    portals: get().portals.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }),
  removePortal: (id) => set({
    portals: get().portals.filter((p) => p.id !== id),
  }),

  updatePlayer: (patch) => set({ player: { ...get().player, ...patch } }),

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

  toggleCollision: (x, z) => {
    const { collisionGrid } = get();
    const next = new Set(collisionGrid);
    const key = `${x},${z}`;
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    set({ collisionGrid: next });
  },

  autoGenerateCollision: () => {
    const { voxels } = get();
    const occupied = new Set<string>();
    for (const key of voxels.keys()) {
      const [x, , z] = parseKey(key);
      occupied.add(`${x},${z}`);
    }
    set({ collisionGrid: occupied });
  },

  // ── Editor actions ──
  setSelectedEntity: (e) => set({ selectedEntity: e }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowCollision: (v) => set({ showCollision: v }),
  setShowGizmos: (v) => set({ showGizmos: v }),

  // ── File actions ──
  newScene: (width, depth) => set({
    voxels: new Map(),
    gridWidth: width,
    gridDepth: depth,
    collisionGrid: new Set(),
    staticLights: [],
    npcs: [],
    portals: [],
    player: defaultPlayer(),
    backgroundLayers: [],
    torchPositions: [],
    weather: defaultWeather(),
    dayNight: defaultDayNight(),
    gaussianSplat: defaultGaussianSplat(),
    undoStack: [],
    redoStack: [],
  }),

  importImage: (imageData, mode, maxHeight, depthMap?) => {
    const next = new Map<VoxelKey, Voxel>();
    const w = imageData.width;
    const h = imageData.height;

    for (let iz = 0; iz < h; iz++) {
      for (let ix = 0; ix < w; ix++) {
        const idx = (iz * imageData.width + ix) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const a = imageData.data[idx + 3];
        if (a < 10) continue;

        if (mode === 'flat') {
          next.set(voxelKey(ix, 0, iz), { color: [r, g, b, a] });
        } else if (mode === 'depth' && depthMap) {
          // Depth map: higher value = closer to camera = taller column
          const depthIdx = iz * imageData.width + ix;
          const depth = depthMap[depthIdx] ?? 0;
          const colHeight = Math.max(1, Math.round(depth * maxHeight));
          for (let iy = 0; iy < colHeight; iy++) {
            next.set(voxelKey(ix, iy, iz), { color: [r, g, b, a] });
          }
        } else {
          // luminance mode
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const colHeight = Math.max(1, Math.round((lum / 255) * maxHeight));
          for (let iy = 0; iy < colHeight; iy++) {
            next.set(voxelKey(ix, iy, iz), { color: [r, g, b, a] });
          }
        }
      }
    }

    set({ voxels: next, gridWidth: w, gridDepth: h });
  },

  saveProject: () => {
    const s = get();
    const voxelArr: BricklayerFile['voxels'] = [];
    for (const [key, vox] of s.voxels) {
      const [x, y, z] = parseKey(key);
      voxelArr.push({ x, y, z, r: vox.color[0], g: vox.color[1], b: vox.color[2], a: vox.color[3] });
    }
    return {
      version: 1,
      gridWidth: s.gridWidth,
      gridDepth: s.gridDepth,
      voxels: voxelArr,
      collision: Array.from(s.collisionGrid),
      scene: {
        ambientColor: s.ambientColor,
        staticLights: s.staticLights,
        npcs: s.npcs,
        portals: s.portals,
        player: s.player,
        backgroundLayers: s.backgroundLayers,
        torchEmitter: s.torchEmitter,
        torchPositions: s.torchPositions,
        footstepEmitter: s.footstepEmitter,
        npcAuraEmitter: s.npcAuraEmitter,
        weather: s.weather,
        dayNight: s.dayNight,
        gaussianSplat: s.gaussianSplat,
      },
    };
  },

  loadProject: (data) => {
    const voxels = new Map<VoxelKey, Voxel>();
    for (const v of data.voxels) {
      voxels.set(voxelKey(v.x, v.y, v.z), { color: [v.r, v.g, v.b, v.a] });
    }
    set({
      voxels,
      gridWidth: data.gridWidth,
      gridDepth: data.gridDepth,
      collisionGrid: new Set(data.collision),
      ambientColor: data.scene.ambientColor,
      staticLights: data.scene.staticLights,
      npcs: data.scene.npcs,
      portals: data.scene.portals,
      player: data.scene.player,
      backgroundLayers: data.scene.backgroundLayers,
      torchEmitter: data.scene.torchEmitter,
      torchPositions: data.scene.torchPositions,
      footstepEmitter: data.scene.footstepEmitter,
      npcAuraEmitter: data.scene.npcAuraEmitter,
      weather: data.scene.weather,
      dayNight: data.scene.dayNight,
      gaussianSplat: data.scene.gaussianSplat,
      undoStack: [],
      redoStack: [],
    });
  },
}));
