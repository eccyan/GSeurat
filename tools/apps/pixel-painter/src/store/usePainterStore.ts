import { create } from 'zustand';
import { AssetManifest, DEFAULT_ASSET_MANIFEST } from '@vulkan-game-tools/asset-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrawingTool = 'pencil' | 'eraser' | 'line' | 'rect' | 'fill' | 'eyedropper';
export type MirrorMode = 'none' | 'horizontal' | 'vertical' | 'both';
export type EditTarget = 'tileset' | 'spritesheet';
export type ActiveLayer = 'diffuse' | 'heightmap';

/** RGBA color as [r, g, b, a] with values 0-255 */
export type RGBA = [number, number, number, number];

/** Pixel canvas stored as flat RGBA array (4 bytes per pixel) */
export type PixelData = Uint8ClampedArray;

/** Single-channel heightmap data (1 byte per pixel) */
export type HeightmapData = Uint8ClampedArray;

export interface HistoryEntry {
  pixels: PixelData;
  heightmapPixels?: HeightmapData;
}

export interface PainterState {
  // --- Asset manifest ---
  manifest: AssetManifest;

  // --- Current editing target ---
  editTarget: EditTarget;

  // --- Tileset editing ---
  selectedTileCol: number;
  selectedTileRow: number;
  tilesetPixels: Map<string, PixelData>;

  // --- Spritesheet editing ---
  selectedFrameCol: number;
  selectedFrameRow: number;
  spritesheetPixels: Map<string, PixelData>;

  // --- Current pixel canvas (active tile/frame) ---
  pixels: PixelData;

  // --- Undo/redo ---
  history: HistoryEntry[];
  historyIndex: number;

  // --- Tools ---
  activeTool: DrawingTool;
  mirrorMode: MirrorMode;
  zoom: number;
  showGrid: boolean;

  // --- Colors ---
  fgColor: RGBA;
  bgColor: RGBA;
  recentColors: RGBA[];

  // --- Animation preview ---
  animPreviewFps: number;
  animPreviewPlaying: boolean;

  // --- Heightmap / Normal map layer ---
  activeLayer: ActiveLayer;
  heightValue: number;
  tilesetHeightmaps: Map<string, HeightmapData>;
  spritesheetHeightmaps: Map<string, HeightmapData>;
  heightmapPixels: HeightmapData;
  showNormalPreview: boolean;
  heightmapOpacity: number;

  // --- UI state ---
  showAIPanel: boolean;
  showManifestSettings: boolean;

  // --- Actions ---
  setManifest: (m: AssetManifest) => void;
  setEditTarget: (target: EditTarget) => void;
  selectTile: (col: number, row: number) => void;
  selectFrame: (col: number, row: number) => void;
  setPixel: (x: number, y: number, color: RGBA) => void;
  setPixels: (newPixels: PixelData) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  setActiveTool: (tool: DrawingTool) => void;
  setMirrorMode: (mode: MirrorMode) => void;
  setZoom: (zoom: number) => void;
  toggleGrid: () => void;
  setFgColor: (color: RGBA) => void;
  setBgColor: (color: RGBA) => void;
  swapColors: () => void;
  addRecentColor: (color: RGBA) => void;
  setAnimPreviewFps: (fps: number) => void;
  setAnimPreviewPlaying: (playing: boolean) => void;
  setShowAIPanel: (show: boolean) => void;
  setShowManifestSettings: (show: boolean) => void;
  applyAIPixels: (pixels: PixelData) => void;
  applyRowPixels: (row: number, frames: PixelData[]) => void;
  setActiveLayer: (layer: ActiveLayer) => void;
  setHeightValue: (v: number) => void;
  setHeightmapPixel: (x: number, y: number, height: number) => void;
  setHeightmapPixels: (data: HeightmapData) => void;
  setShowNormalPreview: (show: boolean) => void;
  setHeightmapOpacity: (opacity: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeBlankPixels(w: number, h: number): PixelData {
  return new Uint8ClampedArray(w * h * 4);
}

export function makeBlankHeightmap(w: number, h: number): HeightmapData {
  const data = new Uint8ClampedArray(w * h);
  data.fill(128);
  return data;
}

function cloneHeightmap(src: HeightmapData): HeightmapData {
  return new Uint8ClampedArray(src);
}

function clonePixels(src: PixelData): PixelData {
  return new Uint8ClampedArray(src);
}

function getTileKey(col: number, row: number): string {
  return `${col},${row}`;
}

function colorsEqual(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Get the pixel dimensions for the current editing context */
export function pixelDims(state: Pick<PainterState, 'editTarget' | 'manifest'>): { w: number; h: number } {
  if (state.editTarget === 'tileset') {
    return { w: state.manifest.tileset.tile_width, h: state.manifest.tileset.tile_height };
  }
  return { w: state.manifest.spritesheet.frame_width, h: state.manifest.spritesheet.frame_height };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const MAX_HISTORY = 50;
const MAX_RECENT_COLORS = 8;

function defaultBlank(): PixelData {
  const m = DEFAULT_ASSET_MANIFEST;
  return makeBlankPixels(m.tileset.tile_width, m.tileset.tile_height);
}

export const usePainterStore = create<PainterState>((set, get) => ({
  manifest: DEFAULT_ASSET_MANIFEST,

  editTarget: 'tileset',

  selectedTileCol: 0,
  selectedTileRow: 0,
  tilesetPixels: new Map(),

  selectedFrameCol: 0,
  selectedFrameRow: 0,
  spritesheetPixels: new Map(),

  pixels: defaultBlank(),

  history: [],
  historyIndex: -1,

  activeTool: 'pencil',
  mirrorMode: 'none',
  zoom: 24,
  showGrid: true,

  fgColor: [0, 0, 0, 255],
  bgColor: [255, 255, 255, 255],
  recentColors: [],

  animPreviewFps: 8,
  animPreviewPlaying: false,

  activeLayer: 'diffuse',
  heightValue: 128,
  tilesetHeightmaps: new Map(),
  spritesheetHeightmaps: new Map(),
  heightmapPixels: makeBlankHeightmap(DEFAULT_ASSET_MANIFEST.tileset.tile_width, DEFAULT_ASSET_MANIFEST.tileset.tile_height),
  showNormalPreview: false,
  heightmapOpacity: 0.5,

  showAIPanel: false,
  showManifestSettings: false,

  // -------------------------------------------------------------------------
  setManifest: (m) => {
    const state = get();
    const oldDims = pixelDims(state);
    const newState: Partial<PainterState> = { manifest: m };

    // Check if dimensions changed — if so, clear pixel maps and reset canvas
    const newTileDims = { w: m.tileset.tile_width, h: m.tileset.tile_height };
    const newFrameDims = { w: m.spritesheet.frame_width, h: m.spritesheet.frame_height };

    const tileChanged = state.manifest.tileset.tile_width !== newTileDims.w || state.manifest.tileset.tile_height !== newTileDims.h;
    const frameChanged = state.manifest.spritesheet.frame_width !== newFrameDims.w || state.manifest.spritesheet.frame_height !== newFrameDims.h;

    if (tileChanged) {
      newState.tilesetPixels = new Map();
      newState.tilesetHeightmaps = new Map();
    }
    if (frameChanged) {
      newState.spritesheetPixels = new Map();
      newState.spritesheetHeightmaps = new Map();
    }

    // Reset current canvas if active target's dims changed
    const activeDimsChanged = (state.editTarget === 'tileset' && tileChanged) || (state.editTarget === 'spritesheet' && frameChanged);
    if (activeDimsChanged) {
      const d = state.editTarget === 'tileset' ? newTileDims : newFrameDims;
      newState.pixels = makeBlankPixels(d.w, d.h);
      newState.heightmapPixels = makeBlankHeightmap(d.w, d.h);
      newState.history = [];
      newState.historyIndex = -1;
    }

    set(newState);
  },

  // -------------------------------------------------------------------------
  setEditTarget: (target) => {
    const state = get();
    const dims = pixelDims(state);
    // Save current pixels + heightmap back into map before switching
    if (state.editTarget === 'tileset') {
      const key = getTileKey(state.selectedTileCol, state.selectedTileRow);
      const newMap = new Map(state.tilesetPixels);
      newMap.set(key, clonePixels(state.pixels));
      const newHmMap = new Map(state.tilesetHeightmaps);
      newHmMap.set(key, cloneHeightmap(state.heightmapPixels));
      set({ editTarget: target, tilesetPixels: newMap, tilesetHeightmaps: newHmMap });
    } else {
      const key = getTileKey(state.selectedFrameCol, state.selectedFrameRow);
      const newMap = new Map(state.spritesheetPixels);
      newMap.set(key, clonePixels(state.pixels));
      const newHmMap = new Map(state.spritesheetHeightmaps);
      newHmMap.set(key, cloneHeightmap(state.heightmapPixels));
      set({ editTarget: target, spritesheetPixels: newMap, spritesheetHeightmaps: newHmMap });
    }
    // Load the appropriate canvas + heightmap
    const newDims = pixelDims({ editTarget: target, manifest: state.manifest });
    if (target === 'tileset') {
      const key = getTileKey(state.selectedTileCol, state.selectedTileRow);
      const s = get();
      set({
        pixels: clonePixels(s.tilesetPixels.get(key) ?? makeBlankPixels(newDims.w, newDims.h)),
        heightmapPixels: cloneHeightmap(s.tilesetHeightmaps.get(key) ?? makeBlankHeightmap(newDims.w, newDims.h)),
        history: [], historyIndex: -1,
      });
    } else {
      const key = getTileKey(state.selectedFrameCol, state.selectedFrameRow);
      const s = get();
      set({
        pixels: clonePixels(s.spritesheetPixels.get(key) ?? makeBlankPixels(newDims.w, newDims.h)),
        heightmapPixels: cloneHeightmap(s.spritesheetHeightmaps.get(key) ?? makeBlankHeightmap(newDims.w, newDims.h)),
        history: [], historyIndex: -1,
      });
    }
  },

  // -------------------------------------------------------------------------
  selectTile: (col, row) => {
    const state = get();
    const newDims = pixelDims({ editTarget: 'tileset', manifest: state.manifest });
    // Save current canvas + heightmap back
    const oldKey = getTileKey(state.selectedTileCol, state.selectedTileRow);
    const newMap = new Map(state.tilesetPixels);
    newMap.set(oldKey, clonePixels(state.pixels));
    const newHmMap = new Map(state.tilesetHeightmaps);
    newHmMap.set(oldKey, cloneHeightmap(state.heightmapPixels));
    // Load new tile
    const newKey = getTileKey(col, row);
    const newPixels = clonePixels(newMap.get(newKey) ?? makeBlankPixels(newDims.w, newDims.h));
    const newHm = cloneHeightmap(newHmMap.get(newKey) ?? makeBlankHeightmap(newDims.w, newDims.h));
    set({
      selectedTileCol: col,
      selectedTileRow: row,
      tilesetPixels: newMap,
      tilesetHeightmaps: newHmMap,
      pixels: newPixels,
      heightmapPixels: newHm,
      history: [],
      historyIndex: -1,
    });
  },

  selectFrame: (col, row) => {
    const state = get();
    const newDims = pixelDims({ editTarget: 'spritesheet', manifest: state.manifest });
    const oldKey = getTileKey(state.selectedFrameCol, state.selectedFrameRow);
    const newMap = new Map(state.spritesheetPixels);
    newMap.set(oldKey, clonePixels(state.pixels));
    const newHmMap = new Map(state.spritesheetHeightmaps);
    newHmMap.set(oldKey, cloneHeightmap(state.heightmapPixels));
    const newKey = getTileKey(col, row);
    const newPixels = clonePixels(newMap.get(newKey) ?? makeBlankPixels(newDims.w, newDims.h));
    const newHm = cloneHeightmap(newHmMap.get(newKey) ?? makeBlankHeightmap(newDims.w, newDims.h));
    set({
      selectedFrameCol: col,
      selectedFrameRow: row,
      spritesheetPixels: newMap,
      spritesheetHeightmaps: newHmMap,
      pixels: newPixels,
      heightmapPixels: newHm,
      history: [],
      historyIndex: -1,
    });
  },

  // -------------------------------------------------------------------------
  setPixel: (x, y, color) => {
    const state = get();
    const { w, h } = pixelDims(state);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const newPixels = clonePixels(state.pixels);
    const idx = (y * w + x) * 4;
    newPixels[idx] = color[0];
    newPixels[idx + 1] = color[1];
    newPixels[idx + 2] = color[2];
    newPixels[idx + 3] = color[3];
    set({ pixels: newPixels });
  },

  setPixels: (newPixels) => {
    set({ pixels: clonePixels(newPixels) });
  },

  // -------------------------------------------------------------------------
  pushHistory: () => {
    const state = get();
    const newEntry: HistoryEntry = {
      pixels: clonePixels(state.pixels),
      heightmapPixels: cloneHeightmap(state.heightmapPixels),
    };
    const truncated = state.history.slice(0, state.historyIndex + 1);
    const newHistory = [...truncated, newEntry].slice(-MAX_HISTORY);
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;
    const newIndex = state.historyIndex - 1;
    const entry = state.history[newIndex];
    const updates: Partial<PainterState> = { pixels: clonePixels(entry.pixels), historyIndex: newIndex };
    if (entry.heightmapPixels) updates.heightmapPixels = cloneHeightmap(entry.heightmapPixels);
    set(updates);
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;
    const newIndex = state.historyIndex + 1;
    const entry = state.history[newIndex];
    const updates: Partial<PainterState> = { pixels: clonePixels(entry.pixels), historyIndex: newIndex };
    if (entry.heightmapPixels) updates.heightmapPixels = cloneHeightmap(entry.heightmapPixels);
    set(updates);
  },

  // -------------------------------------------------------------------------
  setActiveTool: (tool) => set({ activeTool: tool }),
  setMirrorMode: (mode) => set({ mirrorMode: mode }),
  setZoom: (zoom) => set({ zoom }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),

  // -------------------------------------------------------------------------
  setFgColor: (color) => set({ fgColor: color }),
  setBgColor: (color) => set({ bgColor: color }),
  swapColors: () => set((s) => ({ fgColor: s.bgColor, bgColor: s.fgColor })),

  addRecentColor: (color) => {
    const state = get();
    const filtered = state.recentColors.filter((c) => !colorsEqual(c, color));
    const newRecent = [color, ...filtered].slice(0, MAX_RECENT_COLORS);
    set({ recentColors: newRecent });
  },

  // -------------------------------------------------------------------------
  setAnimPreviewFps: (fps) => set({ animPreviewFps: fps }),
  setAnimPreviewPlaying: (playing) => set({ animPreviewPlaying: playing }),

  setShowAIPanel: (show) => set({ showAIPanel: show }),
  setShowManifestSettings: (show) => set({ showManifestSettings: show }),

  applyAIPixels: (pixels) => {
    const state = get();
    const newEntry: HistoryEntry = {
      pixels: clonePixels(state.pixels),
      heightmapPixels: cloneHeightmap(state.heightmapPixels),
    };
    const truncated = state.history.slice(0, state.historyIndex + 1);
    const newHistory = [...truncated, newEntry].slice(-MAX_HISTORY);
    set({ pixels: clonePixels(pixels), history: newHistory, historyIndex: newHistory.length - 1 });
  },

  applyRowPixels: (row, frames) => {
    const state = get();
    // Push history before applying
    const newEntry: HistoryEntry = {
      pixels: clonePixels(state.pixels),
      heightmapPixels: cloneHeightmap(state.heightmapPixels),
    };
    const truncated = state.history.slice(0, state.historyIndex + 1);
    const newHistory = [...truncated, newEntry].slice(-MAX_HISTORY);

    const newMap = new Map(state.spritesheetPixels);
    for (let col = 0; col < frames.length; col++) {
      newMap.set(getTileKey(col, row), clonePixels(frames[col]));
    }

    const updates: Partial<PainterState> = {
      spritesheetPixels: newMap,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    };

    // If currently viewing a frame in this row, update active pixels too
    if (
      state.editTarget === 'spritesheet' &&
      state.selectedFrameRow === row &&
      state.selectedFrameCol < frames.length
    ) {
      updates.pixels = clonePixels(frames[state.selectedFrameCol]);
    }

    set(updates);
  },

  setActiveLayer: (layer) => set({ activeLayer: layer }),

  setHeightValue: (v) => set({ heightValue: Math.max(0, Math.min(255, Math.round(v))) }),

  setHeightmapPixel: (x, y, height) => {
    const state = get();
    const { w, h } = pixelDims(state);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const newHm = cloneHeightmap(state.heightmapPixels);
    newHm[y * w + x] = Math.max(0, Math.min(255, Math.round(height)));
    set({ heightmapPixels: newHm });
  },

  setHeightmapPixels: (data) => {
    set({ heightmapPixels: cloneHeightmap(data) });
  },

  setShowNormalPreview: (show) => set({ showNormalPreview: show }),

  setHeightmapOpacity: (opacity) => set({ heightmapOpacity: Math.max(0, Math.min(1, opacity)) }),
}));
