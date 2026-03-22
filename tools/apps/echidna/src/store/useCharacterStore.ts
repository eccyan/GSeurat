import { create } from 'zustand';
import type {
  Voxel,
  VoxelKey,
  BodyPart,
  PoseData,
  ToolType,
  Snapshot,
  EchidnaFile,
} from './types.js';
import { voxelKey, parseKey } from '../lib/voxelUtils.js';

function makeSnapshot(voxels: Map<VoxelKey, Voxel>, parts: BodyPart[]): Snapshot {
  return {
    voxels: Array.from(voxels.entries()),
    parts: parts.map((p) => ({ ...p, voxelKeys: [...p.voxelKeys] })),
  };
}

function restoreSnapshot(snapshot: Snapshot): { voxels: Map<VoxelKey, Voxel>; characterParts: BodyPart[] } {
  return {
    voxels: new Map(snapshot.voxels),
    characterParts: snapshot.parts.map((p) => ({ ...p, voxelKeys: [...p.voxelKeys] })),
  };
}

export interface CharacterStoreState {
  // Voxels
  voxels: Map<VoxelKey, Voxel>;
  gridWidth: number;
  gridDepth: number;

  // Tools
  activeTool: ToolType;
  activeColor: [number, number, number, number];
  brushSize: number;

  // Character
  characterName: string;
  characterParts: BodyPart[];
  characterPoses: Record<string, PoseData>;
  selectedPart: string | null;
  selectedPose: string | null;
  previewPose: boolean;

  // View
  showGrid: boolean;
  showGizmos: boolean;
  yClip: number | null;  // null = no clipping

  // Undo / redo
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  // Actions – voxels
  pushUndo: () => void;
  placeVoxel: (x: number, y: number, z: number) => void;
  placeVoxels: (positions: [number, number, number][]) => void;
  paintVoxel: (x: number, y: number, z: number) => void;
  eraseVoxel: (x: number, y: number, z: number) => void;
  eraseVoxels: (positions: [number, number, number][]) => void;
  eyedrop: (x: number, y: number, z: number) => void;

  // Actions – tools
  setTool: (tool: ToolType) => void;
  setActiveColor: (color: [number, number, number, number]) => void;
  setBrushSize: (size: number) => void;

  // Actions – view
  setShowGrid: (v: boolean) => void;
  setShowGizmos: (v: boolean) => void;
  setYClip: (v: number | null) => void;

  // Actions – undo/redo
  undo: () => void;
  redo: () => void;

  // Actions – character
  setCharacterName: (name: string) => void;
  addPart: (name: string) => void;
  removePart: (id: string) => void;
  updatePartJoint: (id: string, joint: [number, number, number]) => void;
  setPartParent: (id: string, parentId: string | null) => void;
  assignVoxelsToPart: (keys: VoxelKey[], partId: string) => void;
  setSelectedPart: (id: string | null) => void;
  addPose: (name: string) => void;
  removePose: (name: string) => void;
  setSelectedPose: (name: string | null) => void;
  updatePoseRotation: (poseName: string, partId: string, rotation: [number, number, number]) => void;
  setPreviewPose: (on: boolean) => void;
  importVoxModels: (models: { name: string; voxels: Map<VoxelKey, Voxel> }[]) => void;

  // Actions – file
  newCharacter: () => void;
  saveProject: () => EchidnaFile;
  loadProject: (data: EchidnaFile) => void;
}

export const useCharacterStore = create<CharacterStoreState>((set, get) => ({
  voxels: new Map(),
  gridWidth: 32,
  gridDepth: 32,

  activeTool: 'place',
  activeColor: [180, 130, 90, 255],
  brushSize: 1,

  characterName: 'Untitled',
  characterParts: [],
  characterPoses: {},
  selectedPart: null,
  selectedPose: null,
  previewPose: false,

  showGrid: true,
  showGizmos: true,
  yClip: null,

  undoStack: [],
  redoStack: [],

  // ── Undo ──
  pushUndo: () => {
    const { voxels, characterParts, undoStack } = get();
    const snap = makeSnapshot(voxels, characterParts);
    set({ undoStack: [...undoStack.slice(-49), snap], redoStack: [] });
  },

  undo: () => {
    const { undoStack, voxels, characterParts } = get();
    if (undoStack.length === 0) return;
    const current = makeSnapshot(voxels, characterParts);
    const prev = undoStack[undoStack.length - 1];
    const restored = restoreSnapshot(prev);
    set({
      ...restored,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, current],
    });
  },

  redo: () => {
    const { redoStack, voxels, characterParts } = get();
    if (redoStack.length === 0) return;
    const current = makeSnapshot(voxels, characterParts);
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

  eyedrop: (x, y, z) => {
    const { voxels } = get();
    const v = voxels.get(voxelKey(x, y, z));
    if (v) set({ activeColor: [...v.color] });
  },

  // ── Tool actions ──
  setTool: (tool) => set({ activeTool: tool }),
  setActiveColor: (color) => set({ activeColor: color }),
  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(8, size)) }),

  // ── View actions ──
  setShowGrid: (v) => set({ showGrid: v }),
  setShowGizmos: (v) => set({ showGizmos: v }),
  setYClip: (v: number | null) => set({ yClip: v }),

  // ── Character actions ──
  setCharacterName: (name) => set({ characterName: name }),

  addPart: (name) => {
    const parts = get().characterParts;
    if (parts.some((p) => p.id === name)) return;
    const part: BodyPart = {
      id: name,
      parent: parts.length > 0 ? parts[0].id : null,
      joint: [0, 0, 0],
      voxelKeys: [],
    };
    set({ characterParts: [...parts, part], selectedPart: name });
  },

  removePart: (id) => {
    const parts = get().characterParts.filter((p) => p.id !== id);
    // Unparent children of removed part
    const updated = parts.map((p) => (p.parent === id ? { ...p, parent: null } : p));
    const poses = { ...get().characterPoses };
    for (const name of Object.keys(poses)) {
      const rotations = { ...poses[name].rotations };
      delete rotations[id];
      poses[name] = { rotations };
    }
    set({
      characterParts: updated,
      characterPoses: poses,
      selectedPart: get().selectedPart === id ? null : get().selectedPart,
    });
  },

  updatePartJoint: (id, joint) => {
    set({
      characterParts: get().characterParts.map((p) =>
        p.id === id ? { ...p, joint } : p,
      ),
    });
  },

  setPartParent: (id, parentId) => {
    set({
      characterParts: get().characterParts.map((p) =>
        p.id === id ? { ...p, parent: parentId } : p,
      ),
    });
  },

  assignVoxelsToPart: (keys, partId) => {
    const keySet = new Set(keys);
    set({
      characterParts: get().characterParts.map((p) => {
        if (p.id === partId) {
          // Add keys not already assigned
          const existing = new Set(p.voxelKeys);
          const merged = [...p.voxelKeys, ...keys.filter((k) => !existing.has(k))];
          return { ...p, voxelKeys: merged };
        }
        // Remove these keys from other parts
        const filtered = p.voxelKeys.filter((k) => !keySet.has(k));
        return filtered.length !== p.voxelKeys.length ? { ...p, voxelKeys: filtered } : p;
      }),
    });
  },

  setSelectedPart: (id) => set({ selectedPart: id }),

  addPose: (name) => {
    const poses = { ...get().characterPoses };
    if (!poses[name]) {
      poses[name] = { rotations: {} };
    }
    set({ characterPoses: poses, selectedPose: name });
  },

  removePose: (name) => {
    const poses = { ...get().characterPoses };
    delete poses[name];
    set({
      characterPoses: poses,
      selectedPose: get().selectedPose === name ? null : get().selectedPose,
    });
  },

  setSelectedPose: (name) => set({ selectedPose: name }),

  updatePoseRotation: (poseName, partId, rotation) => {
    const poses = { ...get().characterPoses };
    const pose = poses[poseName] ?? { rotations: {} };
    poses[poseName] = { rotations: { ...pose.rotations, [partId]: rotation } };
    set({ characterPoses: poses });
  },

  setPreviewPose: (on) => set({ previewPose: on }),

  importVoxModels: (models) => {
    const voxels = new Map(get().voxels);
    const parts: BodyPart[] = [...get().characterParts];

    for (const model of models) {
      // Merge voxels into the main voxel map
      const keys: VoxelKey[] = [];
      for (const [key, voxel] of model.voxels) {
        voxels.set(key, voxel);
        keys.push(key);
      }
      // Create a body part for each model
      parts.push({
        id: model.name,
        parent: parts.length > 0 ? parts[0].id : null,
        joint: [0, 0, 0],
        voxelKeys: keys,
      });
    }

    set({ voxels, characterParts: parts });
  },

  // ── File actions ──
  newCharacter: () => set({
    voxels: new Map(),
    gridWidth: 32,
    gridDepth: 32,
    characterName: 'Untitled',
    characterParts: [],
    characterPoses: {},
    selectedPart: null,
    selectedPose: null,
    previewPose: false,
    undoStack: [],
    redoStack: [],
  }),

  saveProject: () => {
    const s = get();
    const voxelArr: EchidnaFile['voxels'] = [];
    for (const [key, vox] of s.voxels) {
      const [x, y, z] = parseKey(key);
      voxelArr.push({ x, y, z, r: vox.color[0], g: vox.color[1], b: vox.color[2], a: vox.color[3] });
    }
    return {
      version: 1,
      characterName: s.characterName,
      gridWidth: s.gridWidth,
      gridDepth: s.gridDepth,
      voxels: voxelArr,
      parts: s.characterParts,
      poses: s.characterPoses,
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
      characterName: data.characterName,
      characterParts: data.parts,
      characterPoses: data.poses,
      selectedPart: null,
      selectedPose: null,
      previewPose: false,
      undoStack: [],
      redoStack: [],
    });
  },
}));
