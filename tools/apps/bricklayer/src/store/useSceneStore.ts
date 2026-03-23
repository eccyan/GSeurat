import { create } from 'zustand';
import type {
  Voxel,
  VoxelKey,
  StaticLight,
  NpcData,
  PortalData,
  PlacedObjectData,
  EmitterConfig,
  BackgroundLayer,
  WeatherData,
  DayNightData,
  GaussianSplatConfig,
  PlayerData,
  ToolType,
  InspectorTab,
  BricklayerMode,
  CollisionLayer,
  SettingsCategory,
  SelectedEntity,
  Snapshot,
  BricklayerFile,
  CollisionGridData,
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

function cloneCollisionGrid(g: CollisionGridData | null): CollisionGridData | null {
  if (!g) return null;
  return {
    width: g.width,
    height: g.height,
    cell_size: g.cell_size,
    solid: [...g.solid],
    elevation: [...g.elevation],
    nav_zone: [...g.nav_zone],
  };
}

function makeSnapshot(voxels: Map<VoxelKey, Voxel>, collisionGridData: CollisionGridData | null): Snapshot {
  return {
    voxels: Array.from(voxels.entries()),
    collisionGridData: cloneCollisionGrid(collisionGridData),
  };
}

function restoreSnapshot(snapshot: Snapshot): { voxels: Map<VoxelKey, Voxel>; collisionGridData: CollisionGridData | null } {
  return {
    voxels: new Map(snapshot.voxels),
    collisionGridData: cloneCollisionGrid(snapshot.collisionGridData),
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
  placedObjects: PlacedObjectData[];
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

  // Editor state
  mode: BricklayerMode;
  selectedEntity: SelectedEntity | null;
  inspectorTab: InspectorTab;
  showGrid: boolean;
  showCollision: boolean;
  showGizmos: boolean;
  collisionLayer: CollisionLayer;
  collisionHeight: number;
  activeNavZone: number;
  selectedSettingsCategory: SettingsCategory;
  collisionBoxFill: boolean;
  collisionBoxStart: [number, number] | null;
  grabMode: boolean;
  grabOriginalPosition: [number, number, number] | [number, number] | null;

  // Palettes
  colorPalettes: [number, number, number, number][][];
  activePaletteIndex: number;

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
  addPlacedObject: (plyFile: string) => void;
  updatePlacedObject: (id: string, patch: Partial<PlacedObjectData>) => void;
  removePlacedObject: (id: string) => void;
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
  initCollisionGrid: (width: number, height: number, cellSize: number) => void;
  toggleCellSolid: (x: number, z: number) => void;
  setCellSolid: (x: number, z: number, solid: boolean) => void;
  setCellElevation: (x: number, z: number, value: number) => void;
  setCellNavZone: (x: number, z: number, zone: number) => void;
  addNavZoneName: (name: string) => void;
  removeNavZoneName: (index: number) => void;
  autoGenerateCollision: (slopeThreshold: number) => void;

  // Actions – editor
  setMode: (mode: BricklayerMode) => void;
  setSelectedEntity: (e: SelectedEntity | null) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setShowGrid: (v: boolean) => void;
  setShowCollision: (v: boolean) => void;
  setShowGizmos: (v: boolean) => void;
  setCollisionLayer: (layer: CollisionLayer) => void;
  setCollisionHeight: (h: number) => void;
  setActiveNavZone: (zone: number) => void;
  setSelectedSettingsCategory: (cat: SettingsCategory) => void;
  setCollisionBoxFill: (on: boolean) => void;
  setCollisionBoxStart: (start: [number, number] | null) => void;
  setGrabMode: (on: boolean) => void;
  setGrabOriginalPosition: (pos: [number, number, number] | [number, number] | null) => void;

  // Actions – palettes
  addPalette: () => void;
  removePalette: (index: number) => void;
  setActivePalette: (index: number) => void;
  setPaletteColor: (paletteIdx: number, colorIdx: number, color: [number, number, number, number]) => void;
  addColorToPalette: (paletteIdx: number, color: [number, number, number, number]) => void;
  extractColorsFromImage: (imageData: ImageData, filename: string) => void;

  // Actions – undo/redo
  undo: () => void;
  redo: () => void;

  // Actions – file
  newScene: (width: number, depth: number) => void;
  importImage: (imageData: ImageData, mode: 'flat' | 'luminance' | 'depth', maxHeight: number, depthMap?: Float32Array, budget?: number) => void;
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
  placedObjects: [],
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

  mode: 'terrain',
  selectedEntity: null,
  inspectorTab: 'scene',
  showGrid: true,
  showCollision: false,
  showGizmos: true,
  collisionLayer: 'solid',
  collisionHeight: 0,
  activeNavZone: 0,
  selectedSettingsCategory: 'gs_camera',
  collisionBoxFill: false,
  collisionBoxStart: null,
  grabMode: false,
  grabOriginalPosition: null,

  colorPalettes: [],
  activePaletteIndex: -1,

  undoStack: [],
  redoStack: [],

  // ── Undo ──
  pushUndo: () => {
    const { voxels, collisionGridData, undoStack } = get();
    const snap = makeSnapshot(voxels, collisionGridData);
    set({ undoStack: [...undoStack.slice(-49), snap], redoStack: [] });
  },

  undo: () => {
    const { undoStack, voxels, collisionGridData } = get();
    if (undoStack.length === 0) return;
    const current = makeSnapshot(voxels, collisionGridData);
    const prev = undoStack[undoStack.length - 1];
    const restored = restoreSnapshot(prev);
    set({
      ...restored,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, current],
    });
  },

  redo: () => {
    const { redoStack, voxels, collisionGridData } = get();
    if (redoStack.length === 0) return;
    const current = makeSnapshot(voxels, collisionGridData);
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

  addPlacedObject: (plyFile) => {
    const obj: PlacedObjectData = {
      id: genId('obj'),
      ply_file: plyFile,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      is_static: true,
      character_manifest: '',
    };
    set({ placedObjects: [...get().placedObjects, obj] });
  },
  updatePlacedObject: (id, patch) => set({
    placedObjects: get().placedObjects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  }),
  removePlacedObject: (id) => set({
    placedObjects: get().placedObjects.filter((o) => o.id !== id),
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

  initCollisionGrid: (width, height, cellSize) => {
    const count = width * height;
    set({
      collisionGridData: {
        width,
        height,
        cell_size: cellSize,
        solid: new Array(count).fill(false),
        elevation: new Array(count).fill(0),
        nav_zone: new Array(count).fill(0),
      },
      showCollision: true,
    });
  },

  toggleCellSolid: (x, z) => {
    const { collisionGridData } = get();
    if (!collisionGridData) return;
    const idx = z * collisionGridData.width + x;
    if (idx < 0 || idx >= collisionGridData.solid.length) return;
    const solid = [...collisionGridData.solid];
    solid[idx] = !solid[idx];
    set({ collisionGridData: { ...collisionGridData, solid } });
  },

  setCellSolid: (x, z, value) => {
    const { collisionGridData } = get();
    if (!collisionGridData) return;
    const idx = z * collisionGridData.width + x;
    if (idx < 0 || idx >= collisionGridData.solid.length) return;
    const solid = [...collisionGridData.solid];
    solid[idx] = value;
    set({ collisionGridData: { ...collisionGridData, solid } });
  },

  setCellElevation: (x, z, value) => {
    const { collisionGridData } = get();
    if (!collisionGridData) return;
    const idx = z * collisionGridData.width + x;
    if (idx < 0 || idx >= collisionGridData.elevation.length) return;
    const elevation = [...collisionGridData.elevation];
    elevation[idx] = value;
    set({ collisionGridData: { ...collisionGridData, elevation } });
  },

  setCellNavZone: (x, z, zone) => {
    const { collisionGridData } = get();
    if (!collisionGridData) return;
    const idx = z * collisionGridData.width + x;
    if (idx < 0 || idx >= collisionGridData.nav_zone.length) return;
    const nav_zone = [...collisionGridData.nav_zone];
    nav_zone[idx] = zone;
    set({ collisionGridData: { ...collisionGridData, nav_zone } });
  },

  addNavZoneName: (name) => {
    set({ navZoneNames: [...get().navZoneNames, name] });
  },

  removeNavZoneName: (index) => {
    set({ navZoneNames: get().navZoneNames.filter((_, i) => i !== index) });
  },

  autoGenerateCollision: (slopeThreshold) => {
    const { voxels, collisionGridData } = get();
    if (!collisionGridData) return;
    const g = collisionGridData;

    // Find highest Y per XZ cell
    const highestY = new Map<string, number>();
    for (const key of voxels.keys()) {
      const [x, y, z] = parseKey(key);
      const cellX = Math.round(x / g.cell_size);
      const cellZ = Math.round(z / g.cell_size);
      if (cellX < 0 || cellX >= g.width || cellZ < 0 || cellZ >= g.height) continue;
      const ck = `${cellX},${cellZ}`;
      const prev = highestY.get(ck);
      if (prev === undefined || y > prev) highestY.set(ck, y);
    }

    const solid = [...g.solid];
    const elevation = [...g.elevation];

    for (let z = 0; z < g.height; z++) {
      for (let x = 0; x < g.width; x++) {
        const idx = z * g.width + x;
        const ck = `${x},${z}`;
        const h = highestY.get(ck);
        if (h === undefined) {
          // No voxels -> solid (unwalkable)
          solid[idx] = true;
          elevation[idx] = 0;
        } else {
          elevation[idx] = h;
          // Check slope: compare to neighbors
          let maxSlope = 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nx >= g.width || nz < 0 || nz >= g.height) continue;
            const nh = highestY.get(`${nx},${nz}`);
            if (nh !== undefined) {
              maxSlope = Math.max(maxSlope, Math.abs(h - nh));
            }
          }
          solid[idx] = maxSlope > slopeThreshold;
        }
      }
    }

    set({ collisionGridData: { ...g, solid, elevation } });
  },

  // ── Editor actions ──
  setMode: (mode) => set({ mode }),
  setSelectedEntity: (e) => set({ selectedEntity: e }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowCollision: (v) => set({ showCollision: v }),
  setShowGizmos: (v) => set({ showGizmos: v }),
  setCollisionLayer: (layer) => set({ collisionLayer: layer }),
  setCollisionHeight: (h) => set({ collisionHeight: h }),
  setActiveNavZone: (zone) => set({ activeNavZone: zone }),
  setSelectedSettingsCategory: (cat) => set({ selectedSettingsCategory: cat }),
  setCollisionBoxFill: (on) => set({ collisionBoxFill: on, collisionBoxStart: null }),
  setCollisionBoxStart: (start) => set({ collisionBoxStart: start }),
  setGrabMode: (on) => {
    if (on) {
      // Store original position for cancel
      const { selectedEntity, placedObjects, npcs, portals, staticLights, player } = get();
      let pos: [number, number, number] | [number, number] | null = null;
      if (selectedEntity) {
        if (selectedEntity.type === 'object') {
          const obj = placedObjects.find((o) => o.id === selectedEntity.id);
          if (obj) pos = [...obj.position];
        } else if (selectedEntity.type === 'npc') {
          const npc = npcs.find((n) => n.id === selectedEntity.id);
          if (npc) pos = [...npc.position];
        } else if (selectedEntity.type === 'portal') {
          const portal = portals.find((p) => p.id === selectedEntity.id);
          if (portal) pos = [...portal.position];
        } else if (selectedEntity.type === 'light') {
          const light = staticLights.find((l) => l.id === selectedEntity.id);
          if (light) pos = [...light.position];
        } else if (selectedEntity.type === 'player') {
          pos = [...player.position];
        }
      }
      set({ grabMode: true, grabOriginalPosition: pos });
    } else {
      set({ grabMode: false, grabOriginalPosition: null });
    }
  },
  setGrabOriginalPosition: (pos) => set({ grabOriginalPosition: pos }),

  // ── Palette actions ──
  addPalette: () => {
    const { colorPalettes } = get();
    set({ colorPalettes: [...colorPalettes, []], activePaletteIndex: colorPalettes.length });
  },
  removePalette: (index) => {
    const { colorPalettes, activePaletteIndex } = get();
    const next = colorPalettes.filter((_, i) => i !== index);
    const nextActive = activePaletteIndex >= next.length
      ? next.length - 1
      : (activePaletteIndex > index ? activePaletteIndex - 1 : activePaletteIndex);
    set({ colorPalettes: next, activePaletteIndex: nextActive });
  },
  setActivePalette: (index) => set({ activePaletteIndex: index }),
  setPaletteColor: (paletteIdx, colorIdx, color) => {
    const palettes = [...get().colorPalettes];
    if (!palettes[paletteIdx]) return;
    const palette = [...palettes[paletteIdx]];
    palette[colorIdx] = color;
    palettes[paletteIdx] = palette;
    set({ colorPalettes: palettes });
  },
  addColorToPalette: (paletteIdx, color) => {
    const palettes = [...get().colorPalettes];
    if (!palettes[paletteIdx]) return;
    palettes[paletteIdx] = [...palettes[paletteIdx], color];
    set({ colorPalettes: palettes });
  },
  extractColorsFromImage: (imageData, filename) => {
    // Bucket RGB into 4-bit per channel (4096 buckets)
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 10) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const rq = (r >> 4) & 0xf;
      const gq = (g >> 4) & 0xf;
      const bq = (b >> 4) & 0xf;
      const key = (rq << 8) | (gq << 4) | bq;
      const existing = buckets.get(key);
      if (existing) {
        existing.count++;
        // Accumulate for averaging
        existing.r += r;
        existing.g += g;
        existing.b += b;
      } else {
        buckets.set(key, { count: 1, r, g, b });
      }
    }

    // Sort by frequency, pick top 20
    const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
    const topColors: [number, number, number, number][] = sorted.slice(0, 20).map((b) => [
      Math.round(b.r / b.count),
      Math.round(b.g / b.count),
      Math.round(b.b / b.count),
      255,
    ]);

    const { colorPalettes } = get();
    const newPalettes = [...colorPalettes, topColors];
    set({ colorPalettes: newPalettes, activePaletteIndex: newPalettes.length - 1 });
  },

  // ── File actions ──
  newScene: (width, depth) => set({
    voxels: new Map(),
    gridWidth: width,
    gridDepth: depth,
    collisionGridData: null,
    navZoneNames: [],
    staticLights: [],
    npcs: [],
    portals: [],
    placedObjects: [],
    player: defaultPlayer(),
    backgroundLayers: [],
    torchPositions: [],
    weather: defaultWeather(),
    dayNight: defaultDayNight(),
    gaussianSplat: defaultGaussianSplat(),
    undoStack: [],
    redoStack: [],
  }),

  importImage: (imageData, mode, maxHeight, depthMap?, budget?) => {
    const next = new Map<VoxelKey, Voxel>();
    const w = imageData.width;
    const h = imageData.height;

    // Map image to X,Y plane (facing camera):
    //   ix → X (horizontal)
    //   iz (image row) → Y (flipped so top of image = high Y)
    //   depth columns extend along +Z (away from camera)
    for (let iz = 0; iz < h; iz++) {
      for (let ix = 0; ix < w; ix++) {
        const idx = (iz * imageData.width + ix) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const a = imageData.data[idx + 3];
        if (a < 10) continue;

        const vy = h - 1 - iz; // flip Y so image top = high Y

        if (mode === 'flat') {
          next.set(voxelKey(ix, vy, 0), { color: [r, g, b, a] });
        } else if (mode === 'depth' && depthMap) {
          const depthIdx = iz * imageData.width + ix;
          const depth = depthMap[depthIdx] ?? 0;
          const colDepth = Math.max(1, Math.round(depth * maxHeight));
          for (let d = 0; d < colDepth; d++) {
            next.set(voxelKey(ix, vy, d), { color: [r, g, b, a] });
          }
        } else {
          // luminance mode
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const colDepth = Math.max(1, Math.round((lum / 255) * maxHeight));
          for (let d = 0; d < colDepth; d++) {
            next.set(voxelKey(ix, vy, d), { color: [r, g, b, a] });
          }
        }
      }
    }

    // Surface culling: remove fully interior voxels (all 6 neighbors present)
    if (mode !== 'flat') {
      const NEIGHBORS: [number, number, number][] = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1],
      ];
      const toDelete: VoxelKey[] = [];
      for (const key of next.keys()) {
        const [x, y, z] = parseKey(key);
        const allEnclosed = NEIGHBORS.every(([dx, dy, dz]) =>
          next.has(voxelKey(x + dx, y + dy, z + dz))
        );
        if (allEnclosed) toDelete.push(key);
      }
      for (const key of toDelete) next.delete(key);
    }

    // Budget enforcement: stride-sample if still over budget
    if (budget && budget > 0 && next.size > budget) {
      const entries = Array.from(next.entries());
      const stride = Math.ceil(entries.length / budget);
      next.clear();
      for (let i = 0; i < entries.length; i += stride) {
        next.set(entries[i][0], entries[i][1]);
      }
    }

    set({ voxels: next, gridWidth: w, gridDepth: maxHeight });
  },

  // ── File ──

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
      collision: [],
      collisionGridData: s.collisionGridData ?? undefined,
      nav_zone_names: s.navZoneNames.length > 0 ? s.navZoneNames : undefined,
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
        placedObjects: s.placedObjects,
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
      collisionGridData: data.collisionGridData ?? null,
      navZoneNames: data.nav_zone_names ?? [],
      ambientColor: data.scene.ambientColor,
      staticLights: data.scene.staticLights,
      npcs: data.scene.npcs,
      portals: data.scene.portals,
      placedObjects: data.scene.placedObjects ?? [],
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
