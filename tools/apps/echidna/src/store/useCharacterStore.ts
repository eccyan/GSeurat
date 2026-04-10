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
} from './types.js';
import { migrateEchidnaFile, slugifyCharacterId, ECHIDNA_FILE_VERSION } from './types.js';
import { voxelKey, parseKey, floodFill3D, extrudeLayer } from '../lib/voxelUtils.js';

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

export interface CharacterStoreState {
  // App mode
  mode: AppMode;

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
  yClip: number | null;

  // Mirror
  mirrorAxis: 'x' | 'z' | null;

  // Part color coding
  colorByPart: boolean;
  partColors: Record<string, [number, number, number]>;

  // Box selection
  boxSelection: VoxelKey[] | null;

  // Animation
  animations: Record<string, AnimationClip>;
  selectedAnimation: string | null;
  playbackTime: number;
  isPlaying: boolean;
  playbackSpeed: number;

  // File
  characterId: string;
  projectRootHandle: FileSystemDirectoryHandle | null;
  currentFilename: string | null;

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

  // Actions – voxels
  pushUndo: () => void;
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
  newCharacter: (gridSize?: number) => void;
  resizeGrid: (size: number) => void;
  saveProject: () => EchidnaFile;
  loadProject: (raw: any) => void;
  setCurrentFilename: (name: string | null) => void;
  setProjectRootHandle: (h: FileSystemDirectoryHandle | null) => void;
  ensureCharacterId: () => string;

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
  mode: 'build',

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

  mirrorAxis: null,

  colorByPart: false,
  partColors: {},

  boxSelection: null,

  animations: {},
  selectedAnimation: null,
  playbackTime: 0,
  isPlaying: false,
  playbackSpeed: 1,

  characterId: '',
  projectRootHandle: null,
  currentFilename: null,

  undoStack: [],
  redoStack: [],

  xrayMode: false,
  yLevelLock: null,
  clipboard: null,
  lassoSelection: null,
  playbackMode: 'loop',
  onionSkinning: false,

  // ── Mode ──
  setMode: (mode) => set({ mode }),

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

  // ── Voxel actions (with mirror support) ──
  placeVoxel: (x, y, z) => {
    const { voxels, activeColor, mirrorAxis, gridWidth } = get();
    const next = new Map(voxels);
    next.set(voxelKey(x, y, z), { color: [...activeColor] });
    const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
    if (m) next.set(voxelKey(m[0], m[1], m[2]), { color: [...activeColor] });
    set({ voxels: next });
  },

  placeVoxels: (positions) => {
    const { voxels, activeColor, mirrorAxis, gridWidth } = get();
    const next = new Map(voxels);
    for (const [x, y, z] of positions) {
      next.set(voxelKey(x, y, z), { color: [...activeColor] });
      const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
      if (m) next.set(voxelKey(m[0], m[1], m[2]), { color: [...activeColor] });
    }
    set({ voxels: next });
  },

  /** Batch-place voxels in a single state update. Programmatic API — does not apply mirror axis. */
  batchPlaceVoxels: (batch) => {
    const { voxels, activeColor } = get();
    const newVoxels = new Map(voxels);
    for (const { x, y, z, color } of batch) {
      const key = voxelKey(x, y, z);
      newVoxels.set(key, { color: color ? [...color] : [...activeColor] });
    }
    set({ voxels: newVoxels });
  },

  paintVoxel: (x, y, z) => {
    const { voxels, activeColor, mirrorAxis, gridWidth } = get();
    const key = voxelKey(x, y, z);
    if (!voxels.has(key)) return;
    const next = new Map(voxels);
    next.set(key, { color: [...activeColor] });
    const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
    if (m) {
      const mk = voxelKey(m[0], m[1], m[2]);
      if (next.has(mk)) next.set(mk, { color: [...activeColor] });
    }
    set({ voxels: next });
  },

  eraseVoxel: (x, y, z) => {
    const { voxels, mirrorAxis, gridWidth } = get();
    const key = voxelKey(x, y, z);
    if (!voxels.has(key)) return;
    const next = new Map(voxels);
    next.delete(key);
    const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
    if (m) next.delete(voxelKey(m[0], m[1], m[2]));
    set({ voxels: next });
  },

  eraseVoxels: (positions) => {
    const { voxels, mirrorAxis, gridWidth } = get();
    const next = new Map(voxels);
    for (const [x, y, z] of positions) {
      next.delete(voxelKey(x, y, z));
      const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
      if (m) next.delete(voxelKey(m[0], m[1], m[2]));
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
    const colors = v ? generatePartColors(get().characterParts) : {};
    set({ colorByPart: v, partColors: colors });
  },

  // ── Box selection ──
  setBoxSelection: (keys) => set({ boxSelection: keys }),

  // ── Character actions ──
  setCharacterName: (name) => set({ characterName: name }),

  addPart: (name) => {
    const parts = get().characterParts;
    if (parts.some((p) => p.id === name)) return;
    const part: BodyPart = {
      id: name,
      name: name,
      parent: get().selectedPart ?? (parts.length > 0 ? parts[0].id : null),
      joint: [0, 0, 0],
      voxelKeys: [],
    };
    const newParts = [...parts, part];
    set({
      characterParts: newParts,
      selectedPart: name,
      partColors: get().colorByPart ? generatePartColors(newParts) : get().partColors,
    });
  },

  removePart: (id) => {
    const parts = get().characterParts.filter((p) => p.id !== id);
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
      partColors: get().colorByPart ? generatePartColors(updated) : get().partColors,
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
    const { mirrorAxis, gridWidth, voxels: voxelMap } = get();
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
      characterParts: get().characterParts.map((p) => {
        if (p.id === partId) {
          const existing = new Set(p.voxelKeys);
          const merged = [...p.voxelKeys, ...allKeys.filter((k) => !existing.has(k))];
          return { ...p, voxelKeys: merged };
        }
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

  updatePoseRootPosition: (poseName, position) => {
    const poses = { ...get().characterPoses };
    const pose = poses[poseName];
    if (pose) {
      poses[poseName] = { ...pose, rootPosition: position };
    }
    set({ characterPoses: poses });
  },

  setPreviewPose: (on) => set({ previewPose: on }),

  importVoxModels: (models) => {
    const voxels = new Map(get().voxels);
    const parts: BodyPart[] = [...get().characterParts];

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

    set({ voxels, characterParts: parts });
  },

  importFromPly: (voxels, parts, gridSize) => {
    set({
      voxels,
      characterParts: parts,
      gridWidth: gridSize,
      gridDepth: gridSize,
      characterPoses: {},
      animations: {},
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      undoStack: [],
      redoStack: [],
      boxSelection: null,
      lassoSelection: null,
    });
  },

  importFromObj: (voxels, parts, gridSize) => {
    set({
      voxels,
      characterParts: parts,
      gridWidth: gridSize,
      gridDepth: gridSize,
      characterPoses: {},
      animations: {},
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      undoStack: [],
      redoStack: [],
      boxSelection: null,
      lassoSelection: null,
    });
  },

  // ── Animation actions ──
  addAnimation: (name) => {
    const anims = { ...get().animations };
    if (!anims[name]) {
      anims[name] = { name, keyframes: [], duration: 1, playbackMode: 'loop' };
    }
    set({ animations: anims, selectedAnimation: name });
  },

  removeAnimation: (name) => {
    const anims = { ...get().animations };
    delete anims[name];
    set({
      animations: anims,
      selectedAnimation: get().selectedAnimation === name ? null : get().selectedAnimation,
    });
  },

  selectAnimation: (name) => {
    const clip = name ? get().animations[name] : null;
    set({
      selectedAnimation: name,
      playbackTime: 0,
      isPlaying: false,
      playbackMode: clip?.playbackMode ?? 'loop',
    });
  },

  addKeyframe: (animName, keyframe) => {
    const anims = { ...get().animations };
    const clip = anims[animName];
    if (!clip) return;
    const kf = { ...keyframe, easing: keyframe.easing ?? ('step' as const) };
    const keyframes = [...clip.keyframes, kf].sort((a, b) => a.time - b.time);
    anims[animName] = { ...clip, keyframes };
    set({ animations: anims });
  },

  removeKeyframe: (animName, index) => {
    const anims = { ...get().animations };
    const clip = anims[animName];
    if (!clip) return;
    const keyframes = clip.keyframes.filter((_, i) => i !== index);
    anims[animName] = { ...clip, keyframes };
    set({ animations: anims });
  },

  updateKeyframeEasing: (animName, index, easing) => {
    const anims = { ...get().animations };
    const clip = anims[animName];
    if (!clip) return;
    const keyframes = clip.keyframes.map((kf, i) => i === index ? { ...kf, easing } : kf);
    anims[animName] = { ...clip, keyframes };
    set({ animations: anims });
  },

  updateAnimationDuration: (animName, duration) => {
    const anims = { ...get().animations };
    const clip = anims[animName];
    if (!clip) return;
    anims[animName] = { ...clip, duration };
    set({ animations: anims });
  },

  updateAnimationPlaybackMode: (animName, mode) => {
    const anims = { ...get().animations };
    const clip = anims[animName];
    if (!clip) return;
    anims[animName] = { ...clip, playbackMode: mode };
    set({ animations: anims });
  },

  updateAnimationRootMotion: (animName, enabled) => {
    const anims = { ...get().animations };
    const clip = anims[animName];
    if (!clip) return;
    anims[animName] = { ...clip, rootMotion: enabled };
    set({ animations: anims });
  },

  autoCenterJoint: (partId) => {
    const { characterParts, voxels } = get();
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
    set({ characterParts: parts });
  },

  setPlaybackTime: (time) => set({ playbackTime: time }),
  togglePlayback: () => set({ isPlaying: !get().isPlaying }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  // ── File actions ──
  setCurrentFilename: (name) => set({ currentFilename: name }),
  setProjectRootHandle: (h) => set({ projectRootHandle: h }),
  ensureCharacterId: () => {
    const s = get();
    if (s.characterId.length > 0) return s.characterId;
    const id = slugifyCharacterId(s.characterName);
    set({ characterId: id });
    return id;
  },

  newCharacter: (gridSize?: number) => {
    const size = gridSize ?? 32;
    set({
      characterId: '',
      voxels: new Map(),
      gridWidth: size,
      gridDepth: size,
      characterName: 'Untitled',
      characterParts: [],
      characterPoses: {},
      animations: {},
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
    });
  },

  resizeGrid: (size: number) => {
    const { voxels, characterParts, gridWidth } = get();
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
    set({ voxels: next, gridWidth: size, gridDepth: size, characterParts: nextParts });
  },

  saveProject: () => {
    const id = get().ensureCharacterId();
    const s = get();
    const voxelArr: EchidnaFile['voxels'] = [];
    for (const [key, vox] of s.voxels) {
      const [x, y, z] = parseKey(key);
      voxelArr.push({ x, y, z, r: vox.color[0], g: vox.color[1], b: vox.color[2], a: vox.color[3] });
    }
    return {
      version: ECHIDNA_FILE_VERSION,
      id,
      characterName: s.characterName,
      gridWidth: s.gridWidth,
      gridDepth: s.gridDepth,
      voxels: voxelArr,
      parts: s.characterParts,
      poses: s.characterPoses,
      animations: Object.keys(s.animations).length > 0 ? s.animations : undefined,
    };
  },

  loadProject: (raw) => {
    const data = migrateEchidnaFile(raw);
    const wasLegacy = (raw?.version ?? 0) < ECHIDNA_FILE_VERSION;
    if (wasLegacy) {
      console.warn(`[echidna] Loaded legacy v${raw?.version} file "${data.characterName}" (id: ${data.id}); migrated to v${ECHIDNA_FILE_VERSION}`);
    }
    const voxels = new Map<VoxelKey, Voxel>();
    for (const v of data.voxels) {
      voxels.set(voxelKey(v.x, v.y, v.z), { color: [v.r, v.g, v.b, v.a] });
    }
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
      characterId: data.id,
      voxels,
      gridWidth: data.gridWidth,
      gridDepth: data.gridDepth,
      characterName: data.characterName,
      characterParts: parts,
      characterPoses: data.poses,
      animations,
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      previewPose: false,
      undoStack: [],
      redoStack: [],
      playbackTime: 0,
      isPlaying: false,
      boxSelection: null,
    });
  },

  // ── New tools and clipboard ──
  setXrayMode: (v) => set({ xrayMode: v }),
  setYLevelLock: (y) => set({ yLevelLock: y }),

  fillVoxels: (startKey) => {
    const { voxels, activeColor, mirrorAxis, gridWidth } = get();
    const keys = floodFill3D(voxels, startKey);
    if (keys.length === 0) return;
    const next = new Map(voxels);
    for (const key of keys) {
      next.set(key, { color: [...activeColor] });
      const [x, y, z] = parseKey(key);
      const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
      if (m) {
        const mk = voxelKey(m[0], m[1], m[2]);
        if (next.has(mk)) next.set(mk, { color: [...activeColor] });
      }
    }
    set({ voxels: next });
  },

  extrudeSelection: (dy) => {
    const { voxels, boxSelection, lassoSelection, mirrorAxis, gridWidth } = get();
    const sel = boxSelection ?? lassoSelection;
    if (!sel || sel.length === 0) return;
    const results = extrudeLayer(voxels, sel, dy);
    if (results.length === 0) return;
    const next = new Map(voxels);
    for (const { x, y, z, color } of results) {
      next.set(voxelKey(x, y, z), { color });
      const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
      if (m) next.set(voxelKey(m[0], m[1], m[2]), { color });
    }
    set({ voxels: next });
  },

  copySelection: () => {
    const { voxels, boxSelection, lassoSelection } = get();
    const sel = boxSelection ?? lassoSelection;
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
    const { clipboard, voxels, mirrorAxis, gridWidth } = get();
    if (!clipboard || clipboard.length === 0) return;
    const next = new Map(voxels);
    for (const { dx, dy, dz, color } of clipboard) {
      const x = cx + dx, y = cy + dy, z = cz + dz;
      next.set(voxelKey(x, y, z), { color: [...color] });
      const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
      if (m) next.set(voxelKey(m[0], m[1], m[2]), { color: [...color] });
    }
    set({ voxels: next });
  },

  deleteSelection: () => {
    const { voxels, boxSelection, lassoSelection, mirrorAxis, gridWidth } = get();
    const sel = boxSelection ?? lassoSelection;
    if (!sel || sel.length === 0) return;
    const next = new Map(voxels);
    for (const key of sel) {
      next.delete(key);
      const [x, y, z] = parseKey(key);
      const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
      if (m) next.delete(voxelKey(m[0], m[1], m[2]));
    }
    set({ voxels: next, boxSelection: null, lassoSelection: null });
  },

  recolorSelection: () => {
    const { voxels, boxSelection, lassoSelection, activeColor, mirrorAxis, gridWidth } = get();
    const sel = boxSelection ?? lassoSelection;
    if (!sel || sel.length === 0) return;
    const next = new Map(voxels);
    for (const key of sel) {
      if (!next.has(key)) continue;
      next.set(key, { color: [...activeColor] });
      const [x, y, z] = parseKey(key);
      const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
      if (m) {
        const mk = voxelKey(m[0], m[1], m[2]);
        if (next.has(mk)) next.set(mk, { color: [...activeColor] });
      }
    }
    set({ voxels: next });
  },

  setLassoSelection: (keys) => set({ lassoSelection: keys }),
  setPlaybackMode: (mode) => set({ playbackMode: mode }),
  setOnionSkinning: (v) => set({ onionSkinning: v }),
}));

if (import.meta.env.DEV) {
  (window as any).__debugStore = useCharacterStore;
}
