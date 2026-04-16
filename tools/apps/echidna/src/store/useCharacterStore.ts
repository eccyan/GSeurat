import { create } from 'zustand';
import type {
  Voxel,
  VoxelKey,
  BodyPart,
  PoseData,
  ToolType,
  Snapshot,
  EchidnaFile,
  AppMode,
  AnimationClip,
  AnimationKeyframe,
  ClipboardEntry,
  PlaybackMode,
  Asset,
  AssetListEntry,
  EchidnaAssetKind,
} from './types.js';
import { migrateEchidnaFile, slugifyAssetId, ECHIDNA_FILE_VERSION } from './types.js';
import { voxelKey, parseKey, floodFill3D, extrudeLayer } from '../lib/voxelUtils.js';
import { listEchidnaProjects, loadEchidnaProject, saveEchidnaProject, exportCharacterToProject, exportMapToProject, exportObjectToProject, deleteEchidnaProject, renameEchidnaProject, duplicateEchidnaProject } from '../lib/projectFs.js';
import { exportPly } from '../lib/plyExport.js';
import { buildManifest } from '../lib/manifestExport.js';

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

/** Compute mirrored position for a given axis. */
function mirrorPos(
  x: number, y: number, z: number,
  axis: 'x' | 'z' | null,
  gridWidth: number,
): [number, number, number] | null {
  if (!axis) return null;
  if (axis === 'x') return [gridWidth - 1 - x, y, z];
  return [x, y, gridWidth - 1 - z];
}

/** Auto-generate part colors from HSL hue wheel. */
function generatePartColors(parts: BodyPart[]): Record<string, [number, number, number]> {
  const colors: Record<string, [number, number, number]> = {};
  const total = parts.length;
  for (let i = 0; i < total; i++) {
    const hue = (i / total) * 360;
    const s = 0.7, l = 0.55;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (hue < 60) { r = c; g = x; }
    else if (hue < 120) { r = x; g = c; }
    else if (hue < 180) { g = c; b = x; }
    else if (hue < 240) { g = x; b = c; }
    else if (hue < 300) { r = x; b = c; }
    else { r = c; b = x; }
    colors[parts[i].id] = [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }
  return colors;
}

/** Convert the flat voxel-DTO array stored in .echidna files to the in-memory Map. */
function voxelArrayToMap(
  arr: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[],
): Map<VoxelKey, Voxel> {
  const map = new Map<VoxelKey, Voxel>();
  for (const v of arr) {
    map.set(voxelKey(v.x, v.y, v.z), { color: [v.r, v.g, v.b, v.a] });
  }
  return map;
}

const DEFAULT_ASSET: Asset = {
  id: '',
  kind: 'character',
  characterName: 'Untitled',
  gridWidth: 32,
  gridDepth: 32,
  voxels: new Map(),
  characterParts: [],
  characterPoses: {},
  animations: {},
  tags: [],
  currentFilename: null,
};

export type SwitchDecision = 'save' | 'discard' | 'cancel';
export type ConfirmSwitch = (info: {
  currentName: string;
  targetName: string;
  undoDepth: number;
}) => Promise<SwitchDecision>;

export interface CharacterStoreState {
  // Per-asset slice (nullable — null when no asset is loaded)
  asset: Asset | null;

  // Global project state
  projectRootHandle: FileSystemDirectoryHandle | null;
  knownAssets: AssetListEntry[];
  dirty: boolean;

  // App mode
  mode: AppMode;

  // Tools
  activeTool: ToolType;
  activeColor: [number, number, number, number];
  brushSize: number;

  // Selection (per-character UI state, but stays global for Phase 0.2)
  selectedPart: string | null;
  selectedPose: string | null;
  previewPose: boolean;

  // View
  showGrid: boolean;
  showGizmos: boolean;
  yClip: number | null;

  // Mirror
  mirrorAxis: 'x' | 'z' | null;

  // Part color coding
  colorByPart: boolean;
  partColors: Record<string, [number, number, number]>;

  // Box selection
  boxSelection: VoxelKey[] | null;

  // Animation playback (global UI state)
  selectedAnimation: string | null;
  playbackTime: number;
  isPlaying: boolean;
  playbackSpeed: number;

  // Undo / redo
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  // New tool state
  xrayMode: boolean;
  yLevelLock: number | null;
  clipboard: ClipboardEntry[] | null;
  lassoSelection: VoxelKey[] | null;
  playbackMode: PlaybackMode;
  onionSkinning: boolean;

  // Actions – mode
  setMode: (mode: AppMode) => void;

  // Actions – dirty tracking
  markDirty: () => void;
  markClean: () => void;

  // Actions – voxels
  pushUndo: () => void;
  addVoxel: (key: VoxelKey, voxel: Voxel) => void;
  placeVoxel: (x: number, y: number, z: number) => void;
  placeVoxels: (positions: [number, number, number][]) => void;
  batchPlaceVoxels: (voxels: Array<{ x: number; y: number; z: number; color?: [number, number, number, number] }>) => void;
  paintVoxel: (x: number, y: number, z: number) => void;
  eraseVoxel: (x: number, y: number, z: number) => void;
  eraseVoxels: (positions: [number, number, number][]) => void;
  eyedrop: (x: number, y: number, z: number) => void;

  // Actions – tools
  setTool: (tool: ToolType) => void;
  setActiveColor: (color: [number, number, number, number] | [number, number, number] | string) => void;
  setBrushSize: (size: number) => void;

  // Actions – view
  setShowGrid: (v: boolean) => void;
  setShowGizmos: (v: boolean) => void;
  setYClip: (v: number | null) => void;

  // Actions – mirror
  setMirrorAxis: (axis: 'x' | 'z' | null) => void;

  // Actions – part color coding
  setColorByPart: (v: boolean) => void;

  // Actions – box selection
  setBoxSelection: (keys: VoxelKey[] | null) => void;

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
  updatePoseRootPosition: (poseName: string, position: [number, number, number]) => void;
  setPreviewPose: (on: boolean) => void;
  importVoxModels: (models: { name: string; voxels: Map<VoxelKey, Voxel> }[]) => void;
  importFromPly: (voxels: Map<VoxelKey, Voxel>, parts: BodyPart[], gridSize: number) => void;
  importFromObj: (voxels: Map<VoxelKey, Voxel>, parts: BodyPart[], gridSize: number) => void;
  importFromImage: (voxels: Map<VoxelKey, Voxel>, parts: BodyPart[], gridWidth: number, gridDepth: number) => void;

  // Actions – animation
  addAnimation: (name: string) => void;
  removeAnimation: (name: string) => void;
  selectAnimation: (name: string | null) => void;
  addKeyframe: (animName: string, keyframe: AnimationKeyframe) => void;
  removeKeyframe: (animName: string, index: number) => void;
  updateKeyframeEasing: (animName: string, index: number, easing: import('./types.js').EasingType) => void;
  updateAnimationDuration: (animName: string, duration: number) => void;
  updateAnimationPlaybackMode: (animName: string, mode: import('./types.js').PlaybackMode) => void;
  updateAnimationRootMotion: (animName: string, enabled: boolean) => void;
  autoCenterJoint: (partId: string) => void;
  setPlaybackTime: (time: number) => void;
  togglePlayback: () => void;
  setPlaybackSpeed: (speed: number) => void;

  // Actions – file
  newAsset: (kind: EchidnaAssetKind, gridSize?: number, name?: string) => void;
  resizeGrid: (size: number) => void;
  saveProject: () => EchidnaFile;
  loadProject: (raw: any) => void;
  setCurrentFilename: (name: string | null) => void;
  setProjectRootHandle: (h: FileSystemDirectoryHandle | null) => void;
  ensureAssetId: () => string;
  _saving: boolean;              // race guard — internal, not subscribed by consumers
  save: () => Promise<boolean>;
  listAssets: () => Promise<void>;
  openAsset: (id: string) => Promise<void>;
  requestOpenAsset: (id: string, confirm: ConfirmSwitch) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;
  renameAsset: (id: string, newName: string) => Promise<void>;
  duplicateAsset: (sourceId: string, newName: string) => Promise<void>;

  // Actions – new tools and clipboard
  setXrayMode: (v: boolean) => void;
  setYLevelLock: (y: number | null) => void;
  fillVoxels: (startKey: VoxelKey) => void;
  extrudeSelection: (dy: number) => void;
  copySelection: () => void;
  pasteClipboard: (cx: number, cy: number, cz: number) => void;
  deleteSelection: () => void;
  recolorSelection: () => void;
  setLassoSelection: (keys: VoxelKey[] | null) => void;
  setPlaybackMode: (mode: PlaybackMode) => void;
  setOnionSkinning: (v: boolean) => void;
}

export const useCharacterStore = create<CharacterStoreState>((set, get) => ({
  asset: null,

  projectRootHandle: null,
  knownAssets: [],
  dirty: false,

  mode: 'build',

  activeTool: 'place',
  activeColor: [180, 130, 90, 255],
  brushSize: 1,

  selectedPart: null,
  selectedPose: null,
  previewPose: false,

  showGrid: true,
  showGizmos: true,
  yClip: null,

  mirrorAxis: null,

  colorByPart: false,
  partColors: {},

  boxSelection: null,

  selectedAnimation: null,
  playbackTime: 0,
  isPlaying: false,
  playbackSpeed: 1,

  undoStack: [],
  redoStack: [],

  xrayMode: false,
  yLevelLock: null,
  clipboard: null,
  lassoSelection: null,
  playbackMode: 'loop',
  onionSkinning: false,

  _saving: false,

  // ── Dirty tracking ──
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),

  // ── Mode ──
  setMode: (mode) => set({ mode }),

  // ── Undo ──
  pushUndo: () => {
    const s = get();
    if (!s.asset) return;
    const snap = makeSnapshot(s.asset.voxels, s.asset.characterParts);
    set({ undoStack: [...s.undoStack.slice(-49), snap], redoStack: [] });
  },

  undo: () => {
    const s = get();
    if (!s.asset) return;
    if (s.undoStack.length === 0) return;
    const current = makeSnapshot(s.asset.voxels, s.asset.characterParts);
    const prev = s.undoStack[s.undoStack.length - 1];
    const restored = restoreSnapshot(prev);
    set({
      asset: {
        ...s.asset,
        voxels: restored.voxels,
        characterParts: restored.characterParts,
      },
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...get().redoStack, current],
    });
  },

  redo: () => {
    const s = get();
    if (!s.asset) return;
    if (s.redoStack.length === 0) return;
    const current = makeSnapshot(s.asset.voxels, s.asset.characterParts);
    const next = s.redoStack[s.redoStack.length - 1];
    const restored = restoreSnapshot(next);
    set({
      asset: {
        ...s.asset,
        voxels: restored.voxels,
        characterParts: restored.characterParts,
      },
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...get().undoStack, current],
    });
  },

  // ── Voxel actions (with mirror support) ──
  /**
   * Raw voxel setter by pre-computed key. Used by programmatic/test code;
   * bypasses mirror axis and activeColor. Prefer placeVoxel for tool-driven input.
   */
  addVoxel: (key, voxel) => {
    const s = get();
    if (!s.asset) return;
    set({
      asset: {
        ...s.asset,
        voxels: new Map(s.asset.voxels).set(key, voxel),
      },
      dirty: true,
    });
  },

  placeVoxel: (x, y, z) => {
    const s = get();
    if (!s.asset) return;
    const next = new Map(s.asset.voxels);
    next.set(voxelKey(x, y, z), { color: [...s.activeColor] });
    const m = mirrorPos(x, y, z, s.mirrorAxis, s.asset.gridWidth);
    if (m) next.set(voxelKey(m[0], m[1], m[2]), { color: [...s.activeColor] });
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  placeVoxels: (positions) => {
    const s = get();
    if (!s.asset) return;
    const next = new Map(s.asset.voxels);
    for (const [x, y, z] of positions) {
      next.set(voxelKey(x, y, z), { color: [...s.activeColor] });
      const m = mirrorPos(x, y, z, s.mirrorAxis, s.asset.gridWidth);
      if (m) next.set(voxelKey(m[0], m[1], m[2]), { color: [...s.activeColor] });
    }
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  /** Batch-place voxels in a single state update. Programmatic API — does not apply mirror axis. */
  batchPlaceVoxels: (batch) => {
    const s = get();
    if (!s.asset) return;
    const newVoxels = new Map(s.asset.voxels);
    for (const { x, y, z, color } of batch) {
      const key = voxelKey(x, y, z);
      newVoxels.set(key, { color: color ? [...color] : [...s.activeColor] });
    }
    set({ asset: { ...s.asset, voxels: newVoxels }, dirty: true });
  },

  paintVoxel: (x, y, z) => {
    const s = get();
    if (!s.asset) return;
    const key = voxelKey(x, y, z);
    if (!s.asset.voxels.has(key)) return;
    const next = new Map(s.asset.voxels);
    next.set(key, { color: [...s.activeColor] });
    const m = mirrorPos(x, y, z, s.mirrorAxis, s.asset.gridWidth);
    if (m) {
      const mk = voxelKey(m[0], m[1], m[2]);
      if (next.has(mk)) next.set(mk, { color: [...s.activeColor] });
    }
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  eraseVoxel: (x, y, z) => {
    const s = get();
    if (!s.asset) return;
    const key = voxelKey(x, y, z);
    if (!s.asset.voxels.has(key)) return;
    const next = new Map(s.asset.voxels);
    next.delete(key);
    const m = mirrorPos(x, y, z, s.mirrorAxis, s.asset.gridWidth);
    if (m) next.delete(voxelKey(m[0], m[1], m[2]));
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  eraseVoxels: (positions) => {
    const s = get();
    if (!s.asset) return;
    const next = new Map(s.asset.voxels);
    for (const [x, y, z] of positions) {
      next.delete(voxelKey(x, y, z));
      const m = mirrorPos(x, y, z, s.mirrorAxis, s.asset.gridWidth);
      if (m) next.delete(voxelKey(m[0], m[1], m[2]));
    }
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  eyedrop: (x, y, z) => {
    const s = get();
    if (!s.asset) return;
    const v = s.asset.voxels.get(voxelKey(x, y, z));
    if (v) set({ activeColor: [...v.color] });
  },

  // ── Tool actions ──
  setTool: (tool) => set({ activeTool: tool }),
  setActiveColor: (color) => {
    if (typeof color === 'string') {
      // Convert hex string like "#E8B89D" or "E8B89D" to [r, g, b, a]
      const hex = color.replace(/^#/, '');
      const r = parseInt(hex.substring(0, 2), 16) || 0;
      const g = parseInt(hex.substring(2, 4), 16) || 0;
      const b = parseInt(hex.substring(4, 6), 16) || 0;
      const a = hex.length >= 8 ? (parseInt(hex.substring(6, 8), 16) || 255) : get().activeColor[3];
      set({ activeColor: [r, g, b, a] });
    } else if (Array.isArray(color) && color.length === 3) {
      set({ activeColor: [color[0], color[1], color[2], get().activeColor[3]] });
    } else if (Array.isArray(color) && color.length >= 4) {
      set({ activeColor: [color[0], color[1], color[2], color[3]] });
    }
  },
  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(8, size)) }),

  // ── View actions ──
  setShowGrid: (v) => set({ showGrid: v }),
  setShowGizmos: (v) => set({ showGizmos: v }),
  setYClip: (v: number | null) => set({ yClip: v }),

  // ── Mirror ──
  setMirrorAxis: (axis) => set({ mirrorAxis: axis }),

  // ── Part color coding ──
  setColorByPart: (v) => {
    const parts = get().asset?.characterParts ?? [];
    const colors = v ? generatePartColors(parts) : {};
    set({ colorByPart: v, partColors: colors });
  },

  // ── Box selection ──
  setBoxSelection: (keys) => set({ boxSelection: keys }),

  // ── Character actions ──
  setCharacterName: (name) => {
    const s = get();
    if (!s.asset) return;
    set({ asset: { ...s.asset, characterName: name }, dirty: true });
  },

  addPart: (name) => {
    const s = get();
    if (!s.asset) return;
    const parts = s.asset.characterParts;
    if (parts.some((p) => p.id === name)) return;
    const part: BodyPart = {
      id: name,
      name: name,
      parent: s.selectedPart ?? (parts.length > 0 ? parts[0].id : null),
      joint: [0, 0, 0],
      voxelKeys: [],
    };
    const newParts = [...parts, part];
    set({
      asset: { ...s.asset, characterParts: newParts },
      selectedPart: name,
      partColors: s.colorByPart ? generatePartColors(newParts) : s.partColors,
      dirty: true,
    });
  },

  removePart: (id) => {
    const s = get();
    if (!s.asset) return;
    const parts = s.asset.characterParts.filter((p) => p.id !== id);
    const updated = parts.map((p) => (p.parent === id ? { ...p, parent: null } : p));
    const poses = { ...s.asset.characterPoses };
    for (const name of Object.keys(poses)) {
      const rotations = { ...poses[name].rotations };
      delete rotations[id];
      poses[name] = { rotations };
    }
    set({
      asset: { ...s.asset, characterParts: updated, characterPoses: poses },
      selectedPart: s.selectedPart === id ? null : s.selectedPart,
      partColors: s.colorByPart ? generatePartColors(updated) : s.partColors,
      dirty: true,
    });
  },

  updatePartJoint: (id, joint) => {
    const s = get();
    if (!s.asset) return;
    set({
      asset: {
        ...s.asset,
        characterParts: s.asset.characterParts.map((p) =>
          p.id === id ? { ...p, joint } : p,
        ),
      },
      dirty: true,
    });
  },

  setPartParent: (id, parentId) => {
    const s = get();
    if (!s.asset) return;
    set({
      asset: {
        ...s.asset,
        characterParts: s.asset.characterParts.map((p) =>
          p.id === id ? { ...p, parent: parentId } : p,
        ),
      },
      dirty: true,
    });
  },

  assignVoxelsToPart: (keys, partId) => {
    const s = get();
    if (!s.asset) return;
    const { mirrorAxis } = s;
    const { voxels: voxelMap, gridWidth, characterParts } = s.asset;
    const allKeys = [...keys];
    if (mirrorAxis) {
      for (const k of keys) {
        const [x, y, z] = parseKey(k);
        const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
        if (m) {
          const mk = voxelKey(m[0], m[1], m[2]);
          if (voxelMap.has(mk) && !allKeys.includes(mk)) allKeys.push(mk);
        }
      }
    }
    const keySet = new Set(allKeys);
    set({
      asset: {
        ...s.asset,
        characterParts: characterParts.map((p) => {
          if (p.id === partId) {
            const existing = new Set(p.voxelKeys);
            const merged = [...p.voxelKeys, ...allKeys.filter((k) => !existing.has(k))];
            return { ...p, voxelKeys: merged };
          }
          const filtered = p.voxelKeys.filter((k) => !keySet.has(k));
          return filtered.length !== p.voxelKeys.length ? { ...p, voxelKeys: filtered } : p;
        }),
      },
      dirty: true,
    });
  },

  setSelectedPart: (id) => set({ selectedPart: id }),

  addPose: (name) => {
    const s = get();
    if (!s.asset) return;
    const poses = { ...s.asset.characterPoses };
    if (!poses[name]) {
      poses[name] = { rotations: {} };
    }
    set({ asset: { ...s.asset, characterPoses: poses }, selectedPose: name, dirty: true });
  },

  removePose: (name) => {
    const s = get();
    if (!s.asset) return;
    const poses = { ...s.asset.characterPoses };
    delete poses[name];
    set({
      asset: { ...s.asset, characterPoses: poses },
      selectedPose: s.selectedPose === name ? null : s.selectedPose,
      dirty: true,
    });
  },

  setSelectedPose: (name) => set({ selectedPose: name }),

  updatePoseRotation: (poseName, partId, rotation) => {
    const s = get();
    if (!s.asset) return;
    const poses = { ...s.asset.characterPoses };
    const pose = poses[poseName] ?? { rotations: {} };
    poses[poseName] = { rotations: { ...pose.rotations, [partId]: rotation } };
    set({ asset: { ...s.asset, characterPoses: poses }, dirty: true });
  },

  updatePoseRootPosition: (poseName, position) => {
    const s = get();
    if (!s.asset) return;
    const poses = { ...s.asset.characterPoses };
    const pose = poses[poseName];
    if (pose) {
      poses[poseName] = { ...pose, rootPosition: position };
    }
    set({ asset: { ...s.asset, characterPoses: poses }, dirty: true });
  },

  setPreviewPose: (on) => set({ previewPose: on }),

  importVoxModels: (models) => {
    const s = get();
    // When character is null, fall back to DEFAULT_ASSET as the base.
    // Importing creates a new in-memory character implicitly — the user hits
    // ⌘S to save it to the project. This matches pre-Phase-0.2 behavior (I1).
    const base = s.asset ?? DEFAULT_ASSET;
    const voxels = new Map(base.voxels);
    const parts: BodyPart[] = [...base.characterParts];

    for (const model of models) {
      const keys: VoxelKey[] = [];
      for (const [key, voxel] of model.voxels) {
        voxels.set(key, voxel);
        keys.push(key);
      }
      parts.push({
        id: model.name,
        name: model.name,
        parent: parts.length > 0 ? parts[0].id : null,
        joint: [0, 0, 0],
        voxelKeys: keys,
      });
    }

    set({ asset: { ...base, voxels, characterParts: parts }, dirty: true });
  },

  importFromPly: (voxels, parts, gridSize) => {
    const s = get();
    // When character is null, fall back to DEFAULT_ASSET as the base.
    // Importing creates a new in-memory character implicitly — the user hits
    // ⌘S to save it to the project. This matches pre-Phase-0.2 behavior (I1).
    set({
      asset: {
        ...(s.asset ?? DEFAULT_ASSET),
        voxels,
        characterParts: parts,
        gridWidth: gridSize,
        gridDepth: gridSize,
        characterPoses: {},
        animations: {},
      },
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      undoStack: [],
      redoStack: [],
      boxSelection: null,
      lassoSelection: null,
      dirty: true,
    });
  },

  importFromObj: (voxels, parts, gridSize) => {
    const s = get();
    // When character is null, fall back to DEFAULT_ASSET as the base.
    // Importing creates a new in-memory character implicitly — the user hits
    // ⌘S to save it to the project. This matches pre-Phase-0.2 behavior (I1).
    set({
      asset: {
        ...(s.asset ?? DEFAULT_ASSET),
        voxels,
        characterParts: parts,
        gridWidth: gridSize,
        gridDepth: gridSize,
        characterPoses: {},
        animations: {},
      },
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      undoStack: [],
      redoStack: [],
      boxSelection: null,
      lassoSelection: null,
      dirty: true,
    });
  },

  importFromImage: (voxels, parts, gridWidth, gridDepth) => {
    const s = get();
    set({
      asset: {
        ...(s.asset ?? DEFAULT_ASSET),
        kind: 'map',
        voxels,
        characterParts: parts,
        gridWidth,
        gridDepth,
        characterPoses: {},
        animations: {},
      },
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      undoStack: [],
      redoStack: [],
      boxSelection: null,
      lassoSelection: null,
      dirty: true,
    });
  },

  // ── Animation actions ──
  addAnimation: (name) => {
    const s = get();
    if (!s.asset) return;
    const anims = { ...s.asset.animations };
    if (!anims[name]) {
      anims[name] = { name, keyframes: [], duration: 1, playbackMode: 'loop' };
    }
    set({ asset: { ...s.asset, animations: anims }, selectedAnimation: name, dirty: true });
  },

  removeAnimation: (name) => {
    const s = get();
    if (!s.asset) return;
    const anims = { ...s.asset.animations };
    delete anims[name];
    set({
      asset: { ...s.asset, animations: anims },
      selectedAnimation: s.selectedAnimation === name ? null : s.selectedAnimation,
      dirty: true,
    });
  },

  selectAnimation: (name) => {
    const s = get();
    const clip = name ? (s.asset?.animations[name] ?? null) : null;
    set({
      selectedAnimation: name,
      playbackTime: 0,
      isPlaying: false,
      playbackMode: clip?.playbackMode ?? 'loop',
    });
  },

  addKeyframe: (animName, keyframe) => {
    const s = get();
    if (!s.asset) return;
    const anims = { ...s.asset.animations };
    const clip = anims[animName];
    if (!clip) return;
    const kf = { ...keyframe, easing: keyframe.easing ?? ('step' as const) };
    const keyframes = [...clip.keyframes, kf].sort((a, b) => a.time - b.time);
    anims[animName] = { ...clip, keyframes };
    set({ asset: { ...s.asset, animations: anims }, dirty: true });
  },

  removeKeyframe: (animName, index) => {
    const s = get();
    if (!s.asset) return;
    const anims = { ...s.asset.animations };
    const clip = anims[animName];
    if (!clip) return;
    const keyframes = clip.keyframes.filter((_, i) => i !== index);
    anims[animName] = { ...clip, keyframes };
    set({ asset: { ...s.asset, animations: anims }, dirty: true });
  },

  updateKeyframeEasing: (animName, index, easing) => {
    const s = get();
    if (!s.asset) return;
    const anims = { ...s.asset.animations };
    const clip = anims[animName];
    if (!clip) return;
    const keyframes = clip.keyframes.map((kf, i) => i === index ? { ...kf, easing } : kf);
    anims[animName] = { ...clip, keyframes };
    set({ asset: { ...s.asset, animations: anims }, dirty: true });
  },

  updateAnimationDuration: (animName, duration) => {
    const s = get();
    if (!s.asset) return;
    const anims = { ...s.asset.animations };
    const clip = anims[animName];
    if (!clip) return;
    anims[animName] = { ...clip, duration };
    set({ asset: { ...s.asset, animations: anims }, dirty: true });
  },

  updateAnimationPlaybackMode: (animName, mode) => {
    const s = get();
    if (!s.asset) return;
    const anims = { ...s.asset.animations };
    const clip = anims[animName];
    if (!clip) return;
    anims[animName] = { ...clip, playbackMode: mode };
    set({ asset: { ...s.asset, animations: anims }, dirty: true });
  },

  updateAnimationRootMotion: (animName, enabled) => {
    const s = get();
    if (!s.asset) return;
    const anims = { ...s.asset.animations };
    const clip = anims[animName];
    if (!clip) return;
    anims[animName] = { ...clip, rootMotion: enabled };
    set({ asset: { ...s.asset, animations: anims }, dirty: true });
  },

  autoCenterJoint: (partId) => {
    const s = get();
    if (!s.asset) return;
    const { characterParts, voxels } = s.asset;
    const part = characterParts.find((p) => p.id === partId);
    if (!part || part.voxelKeys.length === 0) return;
    let jx = 0, jy = 0, jz = 0;
    for (const key of part.voxelKeys) {
      const [x, y, z] = parseKey(key);
      jx += x; jy += y; jz += z;
    }
    const n = part.voxelKeys.length;
    const joint: [number, number, number] = [Math.round(jx / n), Math.round(jy / n), Math.round(jz / n)];
    const parts = characterParts.map((p) => p.id === partId ? { ...p, joint } : p);
    set({ asset: { ...s.asset, characterParts: parts }, dirty: true });
  },

  setPlaybackTime: (time) => set({ playbackTime: time }),
  togglePlayback: () => set({ isPlaying: !get().isPlaying }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  // ── File actions ──
  setCurrentFilename: (name) => {
    const s = get();
    if (!s.asset) return;
    set({ asset: { ...s.asset, currentFilename: name }, dirty: true });
  },
  setProjectRootHandle: (h) => set({ projectRootHandle: h }),
  listAssets: async () => {
    const handle = get().projectRootHandle;
    if (!handle) return;
    try {
      const entries = await listEchidnaProjects(handle);
      set({ knownAssets: entries });
    } catch (e) {
      console.error('[echidna] listAssets failed:', e);
      // Do not clobber existing list on transient failure
    }
  },
  openAsset: async (id) => {
    const handle = get().projectRootHandle;
    if (!handle) {
      console.warn('[echidna] openAsset called with no projectRootHandle');
      return;
    }
    try {
      const data = await loadEchidnaProject(handle, id);
      // Migrate parts: add name field if missing (same as loadProject)
      const parts = data.parts.map((p) => ({
        ...p,
        name: (p as any).name ?? p.id,
      }));
      // Migrate animations: add easing + playbackMode defaults (same as loadProject)
      const animations: Record<string, AnimationClip> = {};
      if (data.animations) {
        for (const [key, clip] of Object.entries(data.animations)) {
          animations[key] = {
            ...clip,
            playbackMode: (clip as any).playbackMode ?? 'loop',
            keyframes: clip.keyframes.map((kf) => ({
              ...kf,
              easing: (kf as any).easing ?? 'step',
            })),
          };
        }
      }
      const char: Asset = {
        id: data.id,
        kind: data.kind ?? 'character',
        characterName: data.characterName,
        gridWidth: data.gridWidth,
        gridDepth: data.gridDepth,
        voxels: voxelArrayToMap(data.voxels),
        characterParts: parts,
        characterPoses: data.poses,
        animations,
        tags: data.tags ?? [],
        currentFilename: null,
      };
      set({
        asset: char,
        dirty: false,
        undoStack: [],
        redoStack: [],
        boxSelection: null,
        lassoSelection: null,
        clipboard: null,
        selectedPart: null,
        selectedPose: null,
        selectedAnimation: null,
        previewPose: false,
        playbackTime: 0,
        isPlaying: false,
        ...(char.kind !== 'character' ? { mode: 'build' as const } : {}),
      });
    } catch (e) {
      if ((e as Error).name === 'NotFoundError') {
        console.warn(`[echidna] openAsset: file missing for ${id}, refreshing list`);
        await get().listAssets();
        return;
      }
      console.error(`[echidna] openAsset failed for ${id}:`, e);
    }
  },

  requestOpenAsset: async (id, confirm) => {
    const s = get();
    // Clicking the already-current row is a no-op.
    if (s.asset?.id === id) return;

    const currentHasWork = s.dirty || s.undoStack.length > 0 || s.redoStack.length > 0;
    if (currentHasWork && s.asset) {
      const target = s.knownAssets.find((c) => c.id === id);
      const decision = await confirm({
        currentName: s.asset.characterName,
        targetName: target?.name ?? id,
        undoDepth: s.undoStack.length,
      });
      if (decision === 'cancel') return;
      if (decision === 'save') {
        const ok = await s.save();
        if (!ok) {
          console.error('[echidna] requestOpenAsset: save() failed, aborting switch');
          return;
        }
      }
      // 'discard' falls through to openAsset (losing the dirty work)
    }
    await get().openAsset(id);
  },

  deleteAsset: async (id: string) => {
    const s = get();
    const handle = s.projectRootHandle;
    if (!handle) return;
    try {
      await deleteEchidnaProject(handle, id);
    } catch (e) {
      console.error(`[echidna] deleteAsset failed for ${id}:`, e);
      return;
    }
    set((state) => ({
      knownAssets: state.knownAssets.filter((c) => c.id !== id),
      ...(state.asset?.id === id
        ? {
            asset: null,
            dirty: false,
            undoStack: [],
            redoStack: [],
            boxSelection: null,
            lassoSelection: null,
            clipboard: null,
          }
        : {}),
    }));
  },

  renameAsset: async (id, newName) => {
    const s = get();
    const handle = s.projectRootHandle;
    if (!handle) return;

    // Always persist to disk — no asymmetry between current and non-current
    try {
      await renameEchidnaProject(handle, id, newName);
    } catch (e) {
      console.error(`[echidna] renameAsset failed for ${id}:`, e);
      return;
    }

    if (s.asset?.id === id) {
      // Current character — also update in-memory state
      set((state) => ({
        asset: state.asset ? { ...state.asset, characterName: newName } : null,
        knownAssets: state.knownAssets.map((c) =>
          c.id === id ? { ...c, name: newName } : c,
        ),
      }));
    } else {
      // Non-current — refresh list from disk
      await get().listAssets();
    }
  },

  duplicateAsset: async (sourceId, newName) => {
    const s = get();
    const handle = s.projectRootHandle;
    if (!handle) return;

    // Mint a non-colliding id
    const MAX_DUPLICATE_SUFFIX = 1000;
    const baseId = slugifyAssetId(newName);
    if (baseId.length === 0) {
      console.error(`[echidna] duplicateAsset: slugifyAssetId returned empty for "${newName}"`);
      return;
    }
    const existingIds = new Set(s.knownAssets.map((c) => c.id));
    let newId = baseId;
    let counter = 2;
    while (existingIds.has(newId)) {
      if (counter > MAX_DUPLICATE_SUFFIX) {
        console.error(`[echidna] duplicateAsset: > ${MAX_DUPLICATE_SUFFIX} collisions for base id "${baseId}"`);
        return;
      }
      newId = `${baseId}_${counter}`;
      counter += 1;
    }

    try {
      await duplicateEchidnaProject(handle, sourceId, newId, newName);
      await get().listAssets();
    } catch (e) {
      console.error(`[echidna] duplicateAsset failed:`, e);
    }
  },

  save: async () => {
    // Race guard: prevent concurrent saves from the same user. If a save is
    // already in flight, the second call returns immediately. This matters
    // because the switch-during-save race (user hits ⌘S then clicks another
    // character row) could otherwise double-trigger the write pipeline.
    if (get()._saving) return false;
    set({ _saving: true });
    try {
      const handleCheck = get();
      const handle = handleCheck.projectRootHandle;
      if (!handle) {
        console.warn('[echidna] save called with no projectRootHandle');
        return false;
      }
      if (!handleCheck.asset) return false;

      // ensureCharacterId may replace state.asset (via set()), so recapture
      // get() after it runs so downstream reads use a fresh snapshot.
      const id = get().ensureAssetId();
      const s = get();
      if (!s.asset) return false; // guard: ensureCharacterId should never null character, but be safe

      // 1. Write the .echidna source via Phase 0.0 helper
      const file = s.saveProject();   // returns EchidnaFile DTO, does NOT write to disk
      try {
        await saveEchidnaProject(handle, file);
      } catch (e) {
        console.error('[echidna] save: .echidna write failed:', e);
        return false;
      }

      // 2. Build PLY + manifest and write engine-ready files (kind-branched)
      try {
        if (s.asset.kind === 'character') {
          const ply = exportPly(
            s.asset.voxels,
            s.asset.gridWidth,
            s.asset.gridDepth,
            s.asset.characterParts,
          );
          const manifest = buildManifest(
            id,
            `${id}.ply`,
            1.0,
            s.asset.characterParts,
            s.asset.characterPoses,
            s.asset.animations,
          );
          await exportCharacterToProject(handle, id, ply, JSON.stringify(manifest, null, 2));
        } else if (s.asset.kind === 'map') {
          const ply = exportPly(
            s.asset.voxels,
            s.asset.gridWidth,
            s.asset.gridDepth,
            s.asset.characterParts,
          );
          await exportMapToProject(handle, id, ply);
        } else if (s.asset.kind === 'object') {
          const ply = exportPly(
            s.asset.voxels,
            s.asset.gridWidth,
            s.asset.gridDepth,
            s.asset.characterParts,
          );
          await exportObjectToProject(handle, id, ply);
        }
      } catch (e) {
        console.error('[echidna] save: partial write — engine files may be stale:', e);
        // .echidna is on disk so dirty COULD clear, but partial-fail means
        // the user should retry. Leave dirty true so the next ⌘S rebuilds.
        return false;
      }

      set((state) => ({
        dirty: false,
        // Update the saved asset's mtime in-place rather than calling
        // listAssets() which would re-read disk and wipe optimistic
        // entries for assets that haven't been saved yet. The full
        // listAssets() refresh happens on project-root restore and
        // after rename/duplicate/delete — save() just needs the mtime.
        knownAssets: state.knownAssets.map((c) =>
          c.id === id ? { ...c, lastModified: Date.now() } : c,
        ),
      }));
      return true;
    } finally {
      set({ _saving: false });
    }
  },

  ensureAssetId: () => {
    const s = get();
    const char = s.asset;
    if (!char) return 'asset';
    if (char.id.length > 0) return char.id;
    const id = slugifyAssetId(char.characterName);
    set({ asset: { ...char, id }, dirty: true });
    return id;
  },

  newAsset: (kind: EchidnaAssetKind, gridSize?: number, name?: string) => {
    const size = gridSize ?? 32;
    const s = get();
    const charName = (name && name.trim().length > 0) ? name.trim() : 'Untitled';

    // Mint a non-colliding id from the provided name. Without this,
    // creating two new characters in a row would give them both the same id
    // and the second save would silently overwrite the first. Matches the
    // collision-suffix pattern used by duplicateAsset.
    const MAX_NEW_SUFFIX = 1000;
    const baseId = slugifyAssetId(charName);
    const existingIds = new Set(s.knownAssets.map((c) => c.id));
    let newId = baseId;
    let counter = 2;
    while (existingIds.has(newId)) {
      if (counter > MAX_NEW_SUFFIX) {
        console.error(`[echidna] newAsset: > ${MAX_NEW_SUFFIX} collisions for base id "${baseId}"`);
        return;
      }
      newId = `${baseId}_${counter}`;
      counter += 1;
    }

    set({
      asset: {
        id: newId,
        kind,
        voxels: new Map(),
        gridWidth: size,
        gridDepth: size,
        characterName: charName,
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
      // Optimistic panel entry: add to knownAssets immediately so the new
      // asset is visible before first save. Phase 0.2 save() later calls
      // listAssets() which re-reads from disk and reconciles the entry.
      knownAssets: [
        ...s.knownAssets,
        { id: newId, kind, name: charName, lastModified: Date.now() },
      ],
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      previewPose: false,
      undoStack: [],
      redoStack: [],
      playbackTime: 0,
      isPlaying: false,
      boxSelection: null,
      colorByPart: false,
      partColors: {},
      // A freshly-created asset has unsaved state (the creation itself).
      // Setting dirty=true ensures requestOpenAsset's switch guard protects
      // the new asset from silent loss if the user clicks away before
      // editing or saving.
      dirty: true,
    });
  },

  resizeGrid: (size: number) => {
    const s = get();
    if (!s.asset) return;
    const { voxels, characterParts, gridWidth } = s.asset;
    if (size === gridWidth) return;
    const next = new Map<VoxelKey, Voxel>();
    for (const [key, vox] of voxels) {
      const [x, , z] = parseKey(key);
      if (x >= 0 && x < size && z >= 0 && z < size) {
        next.set(key, vox);
      }
    }
    const nextParts = characterParts.map((p) => ({
      ...p,
      voxelKeys: p.voxelKeys.filter((k) => {
        const [x, , z] = parseKey(k);
        return x >= 0 && x < size && z >= 0 && z < size;
      }),
    }));
    set({ asset: { ...s.asset, voxels: next, gridWidth: size, gridDepth: size, characterParts: nextParts }, dirty: true });
  },

  saveProject: () => {
    const id = get().ensureAssetId();
    const s = get();
    if (!s.asset) {
      throw new Error('[echidna] saveProject called with null character');
    }
    const char = s.asset;
    const voxelArr: EchidnaFile['voxels'] = [];
    for (const [key, vox] of char.voxels) {
      const [x, y, z] = parseKey(key);
      voxelArr.push({ x, y, z, r: vox.color[0], g: vox.color[1], b: vox.color[2], a: vox.color[3] });
    }
    return {
      version: ECHIDNA_FILE_VERSION,
      id,
      kind: char.kind ?? 'character',
      characterName: char.characterName,
      gridWidth: char.gridWidth,
      gridDepth: char.gridDepth,
      voxels: voxelArr,
      parts: char.characterParts,
      poses: char.characterPoses,
      animations: Object.keys(char.animations).length > 0 ? char.animations : undefined,
      tags: char.tags ?? [],
    };
  },

  loadProject: (raw) => {
    const data = migrateEchidnaFile(raw);
    const wasLegacy = (raw?.version ?? 0) < ECHIDNA_FILE_VERSION;
    if (wasLegacy) {
      console.warn(`[echidna] Loaded legacy v${raw?.version} file "${data.characterName}" (id: ${data.id}); migrated to v${ECHIDNA_FILE_VERSION}`);
    }
    const voxels = voxelArrayToMap(data.voxels);
    // Migrate v1 parts: add name field if missing
    const parts = data.parts.map((p) => ({
      ...p,
      name: (p as any).name ?? p.id,
    }));
    // Migrate v1 animations: add easing + playbackMode defaults
    const animations: Record<string, AnimationClip> = {};
    if (data.animations) {
      for (const [key, clip] of Object.entries(data.animations)) {
        animations[key] = {
          ...clip,
          playbackMode: (clip as any).playbackMode ?? 'loop',
          keyframes: clip.keyframes.map((kf) => ({
            ...kf,
            easing: (kf as any).easing ?? 'step',
          })),
        };
      }
    }
    set({
      asset: {
        id: data.id,
        kind: data.kind ?? 'character',
        voxels,
        gridWidth: data.gridWidth,
        gridDepth: data.gridDepth,
        characterName: data.characterName,
        characterParts: parts,
        characterPoses: data.poses,
        animations,
        tags: data.tags ?? [],
        currentFilename: get().asset?.currentFilename ?? null,
      },
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      previewPose: false,
      undoStack: [],
      redoStack: [],
      playbackTime: 0,
      isPlaying: false,
      boxSelection: null,
      dirty: false,
    });
  },

  // ── New tools and clipboard ──
  setXrayMode: (v) => set({ xrayMode: v }),
  setYLevelLock: (y) => set({ yLevelLock: y }),

  fillVoxels: (startKey) => {
    const s = get();
    if (!s.asset) return;
    const { voxels, gridWidth } = s.asset;
    const keys = floodFill3D(voxels, startKey);
    if (keys.length === 0) return;
    const next = new Map(voxels);
    for (const key of keys) {
      next.set(key, { color: [...s.activeColor] });
      const [x, y, z] = parseKey(key);
      const m = mirrorPos(x, y, z, s.mirrorAxis, gridWidth);
      if (m) {
        const mk = voxelKey(m[0], m[1], m[2]);
        if (next.has(mk)) next.set(mk, { color: [...s.activeColor] });
      }
    }
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  extrudeSelection: (dy) => {
    const s = get();
    if (!s.asset) return;
    const { voxels, gridWidth } = s.asset;
    const sel = s.boxSelection ?? s.lassoSelection;
    if (!sel || sel.length === 0) return;
    const results = extrudeLayer(voxels, sel, dy);
    if (results.length === 0) return;
    const next = new Map(voxels);
    for (const { x, y, z, color } of results) {
      next.set(voxelKey(x, y, z), { color });
      const m = mirrorPos(x, y, z, s.mirrorAxis, gridWidth);
      if (m) next.set(voxelKey(m[0], m[1], m[2]), { color });
    }
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  copySelection: () => {
    const s = get();
    if (!s.asset) return;
    const { voxels } = s.asset;
    const sel = s.boxSelection ?? s.lassoSelection;
    if (!sel || sel.length === 0) return;
    let cx = 0, cy = 0, cz = 0;
    for (const key of sel) {
      const [x, y, z] = parseKey(key);
      cx += x; cy += y; cz += z;
    }
    cx = Math.round(cx / sel.length);
    cy = Math.round(cy / sel.length);
    cz = Math.round(cz / sel.length);
    const entries: ClipboardEntry[] = [];
    for (const key of sel) {
      const voxel = voxels.get(key);
      if (!voxel) continue;
      const [x, y, z] = parseKey(key);
      entries.push({ dx: x - cx, dy: y - cy, dz: z - cz, color: [...voxel.color] });
    }
    set({ clipboard: entries });
  },

  pasteClipboard: (cx, cy, cz) => {
    const s = get();
    if (!s.asset) return;
    const { clipboard } = s;
    if (!clipboard || clipboard.length === 0) return;
    const next = new Map(s.asset.voxels);
    for (const { dx, dy, dz, color } of clipboard) {
      const x = cx + dx, y = cy + dy, z = cz + dz;
      next.set(voxelKey(x, y, z), { color: [...color] });
      const m = mirrorPos(x, y, z, s.mirrorAxis, s.asset.gridWidth);
      if (m) next.set(voxelKey(m[0], m[1], m[2]), { color: [...color] });
    }
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  deleteSelection: () => {
    const s = get();
    if (!s.asset) return;
    const sel = s.boxSelection ?? s.lassoSelection;
    if (!sel || sel.length === 0) return;
    const next = new Map(s.asset.voxels);
    for (const key of sel) {
      next.delete(key);
      const [x, y, z] = parseKey(key);
      const m = mirrorPos(x, y, z, s.mirrorAxis, s.asset.gridWidth);
      if (m) next.delete(voxelKey(m[0], m[1], m[2]));
    }
    set({ asset: { ...s.asset, voxels: next }, boxSelection: null, lassoSelection: null, dirty: true });
  },

  recolorSelection: () => {
    const s = get();
    if (!s.asset) return;
    const sel = s.boxSelection ?? s.lassoSelection;
    if (!sel || sel.length === 0) return;
    const next = new Map(s.asset.voxels);
    for (const key of sel) {
      if (!next.has(key)) continue;
      next.set(key, { color: [...s.activeColor] });
      const [x, y, z] = parseKey(key);
      const m = mirrorPos(x, y, z, s.mirrorAxis, s.asset.gridWidth);
      if (m) {
        const mk = voxelKey(m[0], m[1], m[2]);
        if (next.has(mk)) next.set(mk, { color: [...s.activeColor] });
      }
    }
    set({ asset: { ...s.asset, voxels: next }, dirty: true });
  },

  setLassoSelection: (keys) => set({ lassoSelection: keys }),
  setPlaybackMode: (mode) => set({ playbackMode: mode }),
  setOnionSkinning: (v) => set({ onionSkinning: v }),
}));

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__debugStore = useCharacterStore;
}
