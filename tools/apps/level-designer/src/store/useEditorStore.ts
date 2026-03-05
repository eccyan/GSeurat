import { create } from 'zustand';

// Types matching the engine's scene format

interface TileData {
  id: number;
  solid: boolean;
}

interface NpcPlacement {
  name: string;
  position: [number, number, number];
  tint: [number, number, number, number];
  facing: string;
  patrol_speed: number;
  patrol_interval: number;
  dialog: { speaker_key: string; text_key: string }[];
  light_color: [number, number, number, number];
  light_radius: number;
  waypoints: [number, number][];
}

interface LightPlacement {
  position: [number, number];
  radius: number;
  color: [number, number, number];
  intensity: number;
  height: number;
}

interface PortalPlacement {
  position: [number, number];
  size: [number, number];
  target_scene: string;
  spawn_position: [number, number, number];
  spawn_facing: string;
}

type Tool = 'paint' | 'erase' | 'fill' | 'select';
type Layer = 'tiles' | 'lights' | 'npcs' | 'portals' | 'backgrounds' | 'environment';

interface HistoryEntry {
  tiles: TileData[];
  width: number;
  height: number;
}

interface EditorState {
  // Connection
  connected: boolean;
  setConnected: (c: boolean) => void;

  // Tilemap
  width: number;
  height: number;
  tileSize: number;
  tiles: TileData[];
  setTile: (col: number, row: number, id: number, solid: boolean) => void;
  setTiles: (tiles: TileData[], width: number, height: number) => void;
  resizeTilemap: (width: number, height: number, fillTile: number) => void;

  // Tool state
  activeTool: Tool;
  setActiveTool: (t: Tool) => void;
  activeLayer: Layer;
  setActiveLayer: (l: Layer) => void;
  selectedTileId: number;
  setSelectedTileId: (id: number) => void;
  selectedSolid: boolean;
  setSelectedSolid: (s: boolean) => void;

  // Entities
  npcs: NpcPlacement[];
  addNpc: (npc: NpcPlacement) => void;
  updateNpc: (index: number, npc: Partial<NpcPlacement>) => void;
  removeNpc: (index: number) => void;

  lights: LightPlacement[];
  addLight: (light: LightPlacement) => void;
  updateLight: (index: number, light: Partial<LightPlacement>) => void;
  removeLight: (index: number) => void;

  portals: PortalPlacement[];
  addPortal: (portal: PortalPlacement) => void;
  removePortal: (index: number) => void;

  // Ambient
  ambientColor: [number, number, number, number];
  setAmbientColor: (c: [number, number, number, number]) => void;

  // Canvas viewport
  viewportX: number;
  viewportY: number;
  zoom: number;
  setViewport: (x: number, y: number) => void;
  setZoom: (z: number) => void;

  // Selection
  selectedEntity: { type: 'npc' | 'light' | 'portal'; index: number } | null;
  setSelectedEntity: (
    e: { type: 'npc' | 'light' | 'portal'; index: number } | null
  ) => void;

  // Undo/redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // Scene file
  currentScenePath: string;
  setCurrentScenePath: (p: string) => void;
  dirty: boolean;
  setDirty: (d: boolean) => void;
}

const MAX_HISTORY = 50;

export const useEditorStore = create<EditorState>()((set, get) => ({
  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------
  connected: false,
  setConnected: (c) => set({ connected: c }),

  // ---------------------------------------------------------------------------
  // Tilemap
  // ---------------------------------------------------------------------------
  width: 16,
  height: 16,
  tileSize: 1,
  tiles: Array.from({ length: 16 * 16 }, () => ({ id: 0, solid: false })),

  setTile: (col, row, id, solid) => {
    const { width, height, tiles } = get();
    if (col < 0 || col >= width || row < 0 || row >= height) return;
    const index = row * width + col;
    const next = tiles.slice();
    next[index] = { id, solid };
    set({ tiles: next, dirty: true });
  },

  setTiles: (tiles, width, height) => {
    set({ tiles, width, height });
  },

  resizeTilemap: (newWidth, newHeight, fillTile) => {
    const { width, height, tiles } = get();

    // Preserve existing tile data where the old and new grids overlap.
    const next: TileData[] = Array.from({ length: newWidth * newHeight }, () => ({
      id: fillTile,
      solid: false,
    }));

    const copyRows = Math.min(height, newHeight);
    const copyCols = Math.min(width, newWidth);
    for (let r = 0; r < copyRows; r++) {
      for (let c = 0; c < copyCols; c++) {
        next[r * newWidth + c] = tiles[r * width + c];
      }
    }

    set({ tiles: next, width: newWidth, height: newHeight, dirty: true });
  },

  // ---------------------------------------------------------------------------
  // Tool state
  // ---------------------------------------------------------------------------
  activeTool: 'paint',
  setActiveTool: (t) => set({ activeTool: t }),

  activeLayer: 'tiles',
  setActiveLayer: (l) => set({ activeLayer: l }),

  selectedTileId: 0,
  setSelectedTileId: (id) => set({ selectedTileId: id }),

  selectedSolid: false,
  setSelectedSolid: (s) => set({ selectedSolid: s }),

  // ---------------------------------------------------------------------------
  // Entities — NPCs
  // ---------------------------------------------------------------------------
  npcs: [],

  addNpc: (npc) =>
    set((state) => ({ npcs: [...state.npcs, npc], dirty: true })),

  updateNpc: (index, npc) =>
    set((state) => {
      const next = state.npcs.slice();
      next[index] = { ...next[index], ...npc };
      return { npcs: next, dirty: true };
    }),

  removeNpc: (index) =>
    set((state) => {
      const next = state.npcs.filter((_, i) => i !== index);
      // Clear selection if it pointed at the removed NPC.
      const sel = state.selectedEntity;
      const clearSel =
        sel !== null && sel.type === 'npc' && sel.index === index ? null : sel;
      return { npcs: next, selectedEntity: clearSel, dirty: true };
    }),

  // ---------------------------------------------------------------------------
  // Entities — Lights
  // ---------------------------------------------------------------------------
  lights: [],

  addLight: (light) =>
    set((state) => ({ lights: [...state.lights, light], dirty: true })),

  updateLight: (index, light) =>
    set((state) => {
      const next = state.lights.slice();
      next[index] = { ...next[index], ...light };
      return { lights: next, dirty: true };
    }),

  removeLight: (index) =>
    set((state) => {
      const next = state.lights.filter((_, i) => i !== index);
      const sel = state.selectedEntity;
      const clearSel =
        sel !== null && sel.type === 'light' && sel.index === index
          ? null
          : sel;
      return { lights: next, selectedEntity: clearSel, dirty: true };
    }),

  // ---------------------------------------------------------------------------
  // Entities — Portals
  // ---------------------------------------------------------------------------
  portals: [],

  addPortal: (portal) =>
    set((state) => ({ portals: [...state.portals, portal], dirty: true })),

  removePortal: (index) =>
    set((state) => {
      const next = state.portals.filter((_, i) => i !== index);
      const sel = state.selectedEntity;
      const clearSel =
        sel !== null && sel.type === 'portal' && sel.index === index
          ? null
          : sel;
      return { portals: next, selectedEntity: clearSel, dirty: true };
    }),

  // ---------------------------------------------------------------------------
  // Ambient
  // ---------------------------------------------------------------------------
  ambientColor: [0.25, 0.28, 0.45, 1.0],
  setAmbientColor: (c) => set({ ambientColor: c, dirty: true }),

  // ---------------------------------------------------------------------------
  // Canvas viewport
  // ---------------------------------------------------------------------------
  viewportX: 0,
  viewportY: 0,
  zoom: 1,
  setViewport: (x, y) => set({ viewportX: x, viewportY: y }),
  setZoom: (z) => set({ zoom: z }),

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------
  selectedEntity: null,
  setSelectedEntity: (e) => set({ selectedEntity: e }),

  // ---------------------------------------------------------------------------
  // Undo / Redo
  // ---------------------------------------------------------------------------
  undoStack: [],
  redoStack: [],

  /**
   * Snapshot the current tile state onto the undo stack.
   * Call this BEFORE making a destructive tile edit so the previous state
   * is recoverable. Caps the stack at MAX_HISTORY entries.
   */
  pushHistory: () => {
    const { tiles, width, height, undoStack } = get();
    const entry: HistoryEntry = {
      tiles: tiles.slice(), // shallow copy of value objects — sufficient
      width,
      height,
    };
    const next = [...undoStack, entry];
    if (next.length > MAX_HISTORY) {
      next.shift();
    }
    set({ undoStack: next, redoStack: [] });
  },

  undo: () => {
    const { undoStack, redoStack, tiles, width, height } = get();
    if (undoStack.length === 0) return;

    // Push current state onto redo stack.
    const current: HistoryEntry = { tiles: tiles.slice(), width, height };
    const nextRedo = [...redoStack, current];
    if (nextRedo.length > MAX_HISTORY) {
      nextRedo.shift();
    }

    // Pop the most recent undo entry and restore it.
    const nextUndo = undoStack.slice();
    const entry = nextUndo.pop()!;

    set({
      undoStack: nextUndo,
      redoStack: nextRedo,
      tiles: entry.tiles,
      width: entry.width,
      height: entry.height,
      dirty: true,
    });
  },

  redo: () => {
    const { undoStack, redoStack, tiles, width, height } = get();
    if (redoStack.length === 0) return;

    // Push current state onto undo stack.
    const current: HistoryEntry = { tiles: tiles.slice(), width, height };
    const nextUndo = [...undoStack, current];
    if (nextUndo.length > MAX_HISTORY) {
      nextUndo.shift();
    }

    // Pop the most recent redo entry and restore it.
    const nextRedo = redoStack.slice();
    const entry = nextRedo.pop()!;

    set({
      undoStack: nextUndo,
      redoStack: nextRedo,
      tiles: entry.tiles,
      width: entry.width,
      height: entry.height,
      dirty: true,
    });
  },

  // ---------------------------------------------------------------------------
  // Scene file
  // ---------------------------------------------------------------------------
  currentScenePath: 'assets/scenes/untitled.json',
  setCurrentScenePath: (p) => set({ currentScenePath: p }),

  dirty: false,
  setDirty: (d) => set({ dirty: d }),
}));

// Re-export types so consumers can import them from a single location.
export type {
  TileData,
  NpcPlacement,
  LightPlacement,
  PortalPlacement,
  Tool,
  Layer,
  HistoryEntry,
  EditorState,
};
