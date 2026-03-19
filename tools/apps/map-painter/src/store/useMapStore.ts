import { create } from 'zustand';

export type Tool = 'pencil' | 'fill' | 'eraser' | 'rectangle' | 'line' | 'height' | 'select';
export type Layer = 'ground' | 'walls' | 'decorations';

export interface MapPainterState {
  // Map dimensions
  width: number;
  height: number;

  // Pixel data: RGBA per cell per layer
  layers: Record<Layer, Uint8Array>;
  heights: Float32Array;

  // Active tool state
  activeTool: Tool;
  activeLayer: Layer;
  activeColor: [number, number, number, number];
  heightBrushValue: number;

  // Zoom/pan
  zoom: number;
  panX: number;
  panY: number;

  // Selection
  selectionStart: [number, number] | null;
  selectionEnd: [number, number] | null;

  // Collision grid
  collisionGrid: boolean[];
  showCollision: boolean;

  // 3D preview camera
  previewCamera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };

  // Undo history
  undoStack: { layers: Record<Layer, Uint8Array>; heights: Float32Array }[];
  redoStack: { layers: Record<Layer, Uint8Array>; heights: Float32Array }[];

  // Actions
  initMap: (width: number, height: number) => void;
  resizeMap: (width: number, height: number) => void;
  setTool: (tool: Tool) => void;
  setActiveLayer: (layer: Layer) => void;
  setColor: (color: [number, number, number, number]) => void;
  setHeightBrushValue: (value: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setShowCollision: (show: boolean) => void;

  // Pixel operations
  setPixel: (x: number, y: number, r: number, g: number, b: number, a: number) => void;
  erasePixel: (x: number, y: number) => void;
  fillArea: (x: number, y: number, r: number, g: number, b: number, a: number) => void;
  setHeight: (x: number, y: number, height: number) => void;

  // Collision
  toggleCollision: (x: number, y: number) => void;
  autoGenerateCollision: (heightThreshold: number) => void;

  // Undo/redo
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;

  // Export
  setPreviewCamera: (camera: MapPainterState['previewCamera']) => void;
}

function createEmptyLayers(size: number): Record<Layer, Uint8Array> {
  return {
    ground: new Uint8Array(size * 4),
    walls: new Uint8Array(size * 4),
    decorations: new Uint8Array(size * 4),
  };
}

function cloneLayers(layers: Record<Layer, Uint8Array>): Record<Layer, Uint8Array> {
  return {
    ground: new Uint8Array(layers.ground),
    walls: new Uint8Array(layers.walls),
    decorations: new Uint8Array(layers.decorations),
  };
}

function getPixelIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function colorsMatch(data: Uint8Array, idx: number, r: number, g: number, b: number, a: number): boolean {
  return data[idx] === r && data[idx + 1] === g && data[idx + 2] === b && data[idx + 3] === a;
}

export const useMapStore = create<MapPainterState>((set, get) => ({
  width: 256,
  height: 224,
  layers: createEmptyLayers(256 * 224),
  heights: new Float32Array(256 * 224),
  activeTool: 'pencil',
  activeLayer: 'ground',
  activeColor: [76, 153, 76, 255],
  heightBrushValue: 1,
  zoom: 4,
  panX: 0,
  panY: 0,
  selectionStart: null,
  selectionEnd: null,
  collisionGrid: new Array(256 * 224).fill(false),
  showCollision: false,
  previewCamera: {
    position: [0, 5, 10],
    target: [0, 0, 0],
    fov: 45,
  },
  undoStack: [],
  redoStack: [],

  initMap: (width, height) => {
    const size = width * height;
    set({
      width, height,
      layers: createEmptyLayers(size),
      heights: new Float32Array(size),
      collisionGrid: new Array(size).fill(false),
      undoStack: [],
      redoStack: [],
    });
  },

  resizeMap: (width, height) => {
    const state = get();
    const size = width * height;
    const newLayers = createEmptyLayers(size);
    const newHeights = new Float32Array(size);
    const newCollision = new Array(size).fill(false);

    // Copy existing data
    const copyW = Math.min(state.width, width);
    const copyH = Math.min(state.height, height);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        const oldIdx = getPixelIndex(x, y, state.width);
        const newIdx = getPixelIndex(x, y, width);
        for (const layer of ['ground', 'walls', 'decorations'] as Layer[]) {
          for (let c = 0; c < 4; c++) {
            newLayers[layer][newIdx + c] = state.layers[layer][oldIdx + c];
          }
        }
        const oldFlatIdx = y * state.width + x;
        const newFlatIdx = y * width + x;
        newHeights[newFlatIdx] = state.heights[oldFlatIdx];
        newCollision[newFlatIdx] = state.collisionGrid[oldFlatIdx];
      }
    }

    set({
      width, height,
      layers: newLayers,
      heights: newHeights,
      collisionGrid: newCollision,
    });
  },

  setTool: (tool) => set({ activeTool: tool }),
  setActiveLayer: (layer) => set({ activeLayer: layer }),
  setColor: (color) => set({ activeColor: color }),
  setHeightBrushValue: (value) => set({ heightBrushValue: value }),
  setZoom: (zoom) => set({ zoom: Math.max(1, Math.min(64, zoom)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setShowCollision: (show) => set({ showCollision: show }),

  setPixel: (x, y, r, g, b, a) => {
    const state = get();
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
    const idx = getPixelIndex(x, y, state.width);
    const layerData = state.layers[state.activeLayer];
    layerData[idx] = r;
    layerData[idx + 1] = g;
    layerData[idx + 2] = b;
    layerData[idx + 3] = a;
    set({ layers: { ...state.layers } });
  },

  erasePixel: (x, y) => {
    const state = get();
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
    const idx = getPixelIndex(x, y, state.width);
    const layerData = state.layers[state.activeLayer];
    layerData[idx] = 0;
    layerData[idx + 1] = 0;
    layerData[idx + 2] = 0;
    layerData[idx + 3] = 0;
    set({ layers: { ...state.layers } });
  },

  fillArea: (startX, startY, r, g, b, a) => {
    const state = get();
    if (startX < 0 || startX >= state.width || startY < 0 || startY >= state.height) return;

    const layerData = state.layers[state.activeLayer];
    const startIdx = getPixelIndex(startX, startY, state.width);
    const targetR = layerData[startIdx];
    const targetG = layerData[startIdx + 1];
    const targetB = layerData[startIdx + 2];
    const targetA = layerData[startIdx + 3];

    if (targetR === r && targetG === g && targetB === b && targetA === a) return;

    const stack: [number, number][] = [[startX, startY]];
    const visited = new Set<number>();

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const flatIdx = cy * state.width + cx;
      if (visited.has(flatIdx)) continue;
      if (cx < 0 || cx >= state.width || cy < 0 || cy >= state.height) continue;

      const idx = getPixelIndex(cx, cy, state.width);
      if (!colorsMatch(layerData, idx, targetR, targetG, targetB, targetA)) continue;

      visited.add(flatIdx);
      layerData[idx] = r;
      layerData[idx + 1] = g;
      layerData[idx + 2] = b;
      layerData[idx + 3] = a;

      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }

    set({ layers: { ...state.layers } });
  },

  setHeight: (x, y, height) => {
    const state = get();
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
    const idx = y * state.width + x;
    state.heights[idx] = height;
    set({ heights: new Float32Array(state.heights) });
  },

  toggleCollision: (x, y) => {
    const state = get();
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return;
    const idx = y * state.width + x;
    const newGrid = [...state.collisionGrid];
    newGrid[idx] = !newGrid[idx];
    set({ collisionGrid: newGrid });
  },

  autoGenerateCollision: (heightThreshold) => {
    const state = get();
    const newGrid = new Array(state.width * state.height).fill(false);
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const idx = y * state.width + x;
        if (state.heights[idx] > heightThreshold) {
          newGrid[idx] = true;
        }
      }
    }
    set({ collisionGrid: newGrid });
  },

  pushUndo: () => {
    const state = get();
    set({
      undoStack: [...state.undoStack, {
        layers: cloneLayers(state.layers),
        heights: new Float32Array(state.heights),
      }].slice(-50), // Keep last 50 states
      redoStack: [],
    });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack[state.undoStack.length - 1];
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, {
        layers: cloneLayers(state.layers),
        heights: new Float32Array(state.heights),
      }],
      layers: prev.layers,
      heights: prev.heights,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, {
        layers: cloneLayers(state.layers),
        heights: new Float32Array(state.heights),
      }],
      layers: next.layers,
      heights: next.heights,
    });
  },

  setPreviewCamera: (camera) => set({ previewCamera: camera }),
}));
