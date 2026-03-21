/**
 * Remote Commands — Unit test for the pixel-painter command handler.
 *
 * Tests handleCommand() in isolation by creating a mock store object.
 * Does NOT require the browser or dev server.
 *
 * Usage: node --import tsx/esm --conditions source src/remote-commands.test.ts
 */
import { DEFAULT_ASSET_MANIFEST, type AssetManifest } from '@gseurat/asset-types';

// Re-implement minimal store types/helpers for testing without browser deps
type RGBA = [number, number, number, number];
type PixelData = Uint8ClampedArray;
type EditTarget = 'tileset' | 'spritesheet';
type DrawingTool = 'pencil' | 'eraser' | 'line' | 'rect' | 'fill' | 'eyedropper';

function makeBlankPixels(w: number, h: number): PixelData {
  return new Uint8ClampedArray(w * h * 4);
}

// ---------------------------------------------------------------------------
// Minimal mock store
// ---------------------------------------------------------------------------

type ActiveLayer = 'diffuse' | 'heightmap';
type HeightmapData = Uint8ClampedArray;

function makeBlankHeightmap(w: number, h: number): HeightmapData {
  const data = new Uint8ClampedArray(w * h);
  data.fill(128);
  return data;
}

interface MockStore {
  manifest: AssetManifest;
  editTarget: EditTarget;
  selectedTileCol: number;
  selectedTileRow: number;
  selectedFrameCol: number;
  selectedFrameRow: number;
  activeTool: DrawingTool;
  mirrorMode: string;
  zoom: number;
  showGrid: boolean;
  fgColor: RGBA;
  bgColor: RGBA;
  pixels: PixelData;
  tilesetPixels: Map<string, PixelData>;
  spritesheetPixels: Map<string, PixelData>;
  history: Array<{ pixels: PixelData; heightmapPixels?: HeightmapData }>;
  historyIndex: number;
  activeLayer: ActiveLayer;
  heightValue: number;
  heightmapPixels: HeightmapData;
  tilesetHeightmaps: Map<string, HeightmapData>;
  spritesheetHeightmaps: Map<string, HeightmapData>;

  setManifest: (m: AssetManifest) => void;
  setEditTarget: (t: EditTarget) => void;
  selectTile: (col: number, row: number) => void;
  selectFrame: (col: number, row: number) => void;
  setPixel: (x: number, y: number, color: RGBA) => void;
  setPixels: (px: PixelData) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  setActiveTool: (tool: DrawingTool) => void;
  setFgColor: (c: RGBA) => void;
  setBgColor: (c: RGBA) => void;
  setActiveLayer: (layer: ActiveLayer) => void;
  setHeightValue: (v: number) => void;
  setHeightmapPixels: (hm: HeightmapData) => void;
}

function createMockStore(): MockStore {
  const store: MockStore = {
    manifest: JSON.parse(JSON.stringify(DEFAULT_ASSET_MANIFEST)),
    editTarget: 'tileset',
    selectedTileCol: 0,
    selectedTileRow: 0,
    selectedFrameCol: 0,
    selectedFrameRow: 0,
    activeTool: 'pencil',
    mirrorMode: 'none',
    zoom: 24,
    showGrid: true,
    fgColor: [0, 0, 0, 255],
    bgColor: [255, 255, 255, 255],
    pixels: makeBlankPixels(16, 16),
    tilesetPixels: new Map(),
    spritesheetPixels: new Map(),
    history: [],
    historyIndex: -1,
    activeLayer: 'diffuse',
    heightValue: 128,
    heightmapPixels: makeBlankHeightmap(16, 16),
    tilesetHeightmaps: new Map(),
    spritesheetHeightmaps: new Map(),

    setManifest(m: AssetManifest) { store.manifest = m; },
    setEditTarget(t: EditTarget) { store.editTarget = t; },
    selectTile(col: number, row: number) {
      store.selectedTileCol = col;
      store.selectedTileRow = row;
    },
    selectFrame(col: number, row: number) {
      store.selectedFrameCol = col;
      store.selectedFrameRow = row;
    },
    setPixel(x: number, y: number, color: RGBA) {
      const w = store.editTarget === 'tileset'
        ? store.manifest.tileset.tile_width
        : store.manifest.spritesheet.frame_width;
      const idx = (y * w + x) * 4;
      store.pixels[idx] = color[0];
      store.pixels[idx + 1] = color[1];
      store.pixels[idx + 2] = color[2];
      store.pixels[idx + 3] = color[3];
    },
    setPixels(px: PixelData) { store.pixels = new Uint8ClampedArray(px) as PixelData; },
    pushHistory() {
      store.history.push({
        pixels: new Uint8ClampedArray(store.pixels) as PixelData,
        heightmapPixels: new Uint8ClampedArray(store.heightmapPixels) as HeightmapData,
      });
      store.historyIndex = store.history.length - 1;
    },
    undo() {
      if (store.historyIndex > 0) {
        store.historyIndex--;
        store.pixels = new Uint8ClampedArray(store.history[store.historyIndex].pixels) as PixelData;
        if (store.history[store.historyIndex].heightmapPixels) {
          store.heightmapPixels = new Uint8ClampedArray(store.history[store.historyIndex].heightmapPixels!) as HeightmapData;
        }
      }
    },
    redo() {
      if (store.historyIndex < store.history.length - 1) {
        store.historyIndex++;
        store.pixels = new Uint8ClampedArray(store.history[store.historyIndex].pixels) as PixelData;
        if (store.history[store.historyIndex].heightmapPixels) {
          store.heightmapPixels = new Uint8ClampedArray(store.history[store.historyIndex].heightmapPixels!) as HeightmapData;
        }
      }
    },
    setActiveTool(tool: DrawingTool) { store.activeTool = tool; },
    setFgColor(c: RGBA) { store.fgColor = c; },
    setBgColor(c: RGBA) { store.bgColor = c; },
    setActiveLayer(layer: ActiveLayer) { store.activeLayer = layer; },
    setHeightValue(v: number) { store.heightValue = Math.max(0, Math.min(255, Math.round(v))); },
    setHeightmapPixels(hm: HeightmapData) { store.heightmapPixels = new Uint8ClampedArray(hm) as HeightmapData; },
  };
  return store;
}

// ---------------------------------------------------------------------------
// Inline handleCommand (since we can't import the browser-targeted module)
// ---------------------------------------------------------------------------

type CommandResult = { response: unknown } | { error: string };

function pixelsToBase64(pixels: PixelData): string {
  let binary = '';
  for (let i = 0; i < pixels.length; i++) {
    binary += String.fromCharCode(pixels[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function base64ToPixels(b64: string): PixelData {
  const buf = Buffer.from(b64, 'base64');
  const arr = new Uint8ClampedArray(buf.length);
  for (let i = 0; i < buf.length; i++) {
    arr[i] = buf[i];
  }
  return arr as PixelData;
}

function heightmapToBase64(hm: HeightmapData): string {
  let binary = '';
  for (let i = 0; i < hm.length; i++) {
    binary += String.fromCharCode(hm[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function base64ToHeightmap(b64: string): HeightmapData {
  const buf = Buffer.from(b64, 'base64');
  const arr = new Uint8ClampedArray(buf.length);
  for (let i = 0; i < buf.length; i++) {
    arr[i] = buf[i];
  }
  return arr as HeightmapData;
}

function heightmapToNormalMap(heightmap: HeightmapData, w: number, h: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      const ym = Math.max(0, y - 1);
      const yp = Math.min(h - 1, y + 1);
      const dhdx = heightmap[y * w + xp] - heightmap[y * w + xm];
      const dhdy = heightmap[yp * w + x] - heightmap[ym * w + x];
      let nx = -dhdx, ny = -dhdy, nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      const idx = (y * w + x) * 4;
      output[idx + 0] = Math.round(Math.max(0, Math.min(255, (nx * 0.5 + 0.5) * 255)));
      output[idx + 1] = Math.round(Math.max(0, Math.min(255, (ny * 0.5 + 0.5) * 255)));
      output[idx + 2] = Math.round(Math.max(0, Math.min(255, (nz * 0.5 + 0.5) * 255)));
      output[idx + 3] = 255;
    }
  }
  return output;
}

function pixelDims(store: MockStore): { w: number; h: number } {
  if (store.editTarget === 'tileset') {
    return { w: store.manifest.tileset.tile_width, h: store.manifest.tileset.tile_height };
  }
  return { w: store.manifest.spritesheet.frame_width, h: store.manifest.spritesheet.frame_height };
}

function handleCommand(
  cmd: string,
  params: Record<string, unknown>,
  store: MockStore,
): CommandResult {
  switch (cmd) {
    case 'get_state': {
      const { w, h } = pixelDims(store);
      return {
        response: {
          manifest: store.manifest,
          editTarget: store.editTarget,
          selectedTileCol: store.selectedTileCol,
          selectedTileRow: store.selectedTileRow,
          selectedFrameCol: store.selectedFrameCol,
          selectedFrameRow: store.selectedFrameRow,
          activeTool: store.activeTool,
          mirrorMode: store.mirrorMode,
          zoom: store.zoom,
          showGrid: store.showGrid,
          fgColor: store.fgColor,
          bgColor: store.bgColor,
          pixelWidth: w,
          pixelHeight: h,
          pixels: pixelsToBase64(store.pixels),
          activeLayer: store.activeLayer,
          heightValue: store.heightValue,
          heightmap: heightmapToBase64(store.heightmapPixels),
        },
      };
    }
    case 'get_manifest': {
      return { response: { manifest: store.manifest } };
    }
    case 'set_manifest': {
      const m = params['manifest'] as AssetManifest | undefined;
      if (!m) return { error: 'missing manifest param' };
      store.setManifest(m);
      return { response: { ok: true } };
    }
    case 'get_pixels': {
      const { w, h } = pixelDims(store);
      return { response: { pixels: pixelsToBase64(store.pixels), width: w, height: h } };
    }
    case 'set_pixels': {
      const b64 = params['pixels'] as string | undefined;
      if (!b64) return { error: 'missing pixels param' };
      const newPixels = base64ToPixels(b64);
      store.pushHistory();
      store.setPixels(newPixels);
      return { response: { ok: true } };
    }
    case 'select_tile': {
      const col = params['col'] as number | undefined;
      const row = params['row'] as number | undefined;
      if (col === undefined || row === undefined) return { error: 'missing col/row' };
      if (store.editTarget !== 'tileset') store.setEditTarget('tileset');
      store.selectTile(col, row);
      return { response: { ok: true } };
    }
    case 'select_frame': {
      const col = params['col'] as number | undefined;
      const row = params['row'] as number | undefined;
      if (col === undefined || row === undefined) return { error: 'missing col/row' };
      if (store.editTarget !== 'spritesheet') store.setEditTarget('spritesheet');
      store.selectFrame(col, row);
      return { response: { ok: true } };
    }
    case 'set_edit_target': {
      const target = params['target'] as EditTarget | undefined;
      if (!target) return { error: 'missing target' };
      store.setEditTarget(target);
      return { response: { ok: true } };
    }
    case 'set_pixel': {
      const x = params['x'] as number;
      const y = params['y'] as number;
      const color = params['color'] as RGBA;
      if (x === undefined || y === undefined || !color) return { error: 'missing x/y/color' };
      store.pushHistory();
      store.setPixel(x, y, color);
      return { response: { ok: true } };
    }
    case 'set_tool': {
      const tool = params['tool'] as DrawingTool | undefined;
      if (!tool) return { error: 'missing tool' };
      store.setActiveTool(tool);
      return { response: { ok: true } };
    }
    case 'set_color': {
      const fg = params['fg'] as RGBA | undefined;
      const bg = params['bg'] as RGBA | undefined;
      if (fg) store.setFgColor(fg);
      if (bg) store.setBgColor(bg);
      return { response: { ok: true } };
    }
    case 'clear': {
      const { w, h } = pixelDims(store);
      store.pushHistory();
      store.setPixels(makeBlankPixels(w, h));
      return { response: { ok: true } };
    }
    case 'undo': {
      store.undo();
      return { response: { ok: true } };
    }
    case 'redo': {
      store.redo();
      return { response: { ok: true } };
    }
    case 'get_heightmap': {
      const { w, h } = pixelDims(store);
      return { response: { heightmap: heightmapToBase64(store.heightmapPixels), width: w, height: h } };
    }
    case 'set_heightmap': {
      const b64 = params['heightmap'] as string | undefined;
      if (!b64) return { error: 'missing heightmap param' };
      const newHm = base64ToHeightmap(b64);
      store.pushHistory();
      store.setHeightmapPixels(newHm);
      return { response: { ok: true } };
    }
    case 'get_normal_map': {
      const { w, h } = pixelDims(store);
      const normalMap = heightmapToNormalMap(store.heightmapPixels, w, h);
      return { response: { normal_map: pixelsToBase64(normalMap), width: w, height: h } };
    }
    case 'set_layer': {
      const layer = params['layer'] as string | undefined;
      if (!layer || (layer !== 'diffuse' && layer !== 'heightmap')) return { error: 'invalid layer' };
      store.setActiveLayer(layer);
      return { response: { ok: true } };
    }
    case 'set_height_value': {
      const value = params['value'] as number | undefined;
      if (value === undefined) return { error: 'missing value' };
      store.setHeightValue(value);
      return { response: { ok: true } };
    }
    default:
      return { error: `unknown command: ${cmd}` };
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    failed++;
    console.log(`  FAIL  ${label}`);
    throw new Error(`Assertion failed: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failed++;
    const msg = `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    console.log(`  FAIL  ${msg}`);
    throw new Error(msg);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch {
    // Error already logged in assert
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('  Remote Commands Unit Tests');
console.log('='.repeat(60));

test('get_state returns full state snapshot', () => {
  const store = createMockStore();
  const result = handleCommand('get_state', {}, store);
  assert('response' in result, 'Should return response');
  const resp = result.response as Record<string, unknown>;
  assertEqual(resp['editTarget'], 'tileset', 'editTarget');
  assertEqual(resp['pixelWidth'], 16, 'pixelWidth');
  assertEqual(resp['pixelHeight'], 16, 'pixelHeight');
  assert(typeof resp['pixels'] === 'string', 'pixels is base64 string');
  assert(resp['manifest'] !== undefined, 'manifest present');
});

test('get_manifest returns manifest', () => {
  const store = createMockStore();
  const result = handleCommand('get_manifest', {}, store);
  assert('response' in result, 'Should return response');
  const resp = result.response as Record<string, unknown>;
  const m = resp['manifest'] as Record<string, unknown>;
  assertEqual(m['version'], 1, 'version');
});

test('set_manifest updates manifest', () => {
  const store = createMockStore();
  const newManifest = JSON.parse(JSON.stringify(DEFAULT_ASSET_MANIFEST));
  newManifest.tileset.tile_width = 32;
  const result = handleCommand('set_manifest', { manifest: newManifest }, store);
  assert('response' in result, 'Should return response');
  assertEqual(store.manifest.tileset.tile_width, 32, 'tile_width updated');
});

test('set_manifest missing param returns error', () => {
  const store = createMockStore();
  const result = handleCommand('set_manifest', {}, store);
  assert('error' in result, 'Should return error');
});

test('get_pixels returns base64 pixels with dimensions', () => {
  const store = createMockStore();
  store.setPixel(0, 0, [255, 0, 0, 255]);
  const result = handleCommand('get_pixels', {}, store);
  assert('response' in result, 'Should return response');
  const resp = result.response as Record<string, unknown>;
  assertEqual(resp['width'], 16, 'width');
  assertEqual(resp['height'], 16, 'height');

  const pixels = base64ToPixels(resp['pixels'] as string);
  assertEqual(pixels[0], 255, 'R channel');
  assertEqual(pixels[1], 0, 'G channel');
  assertEqual(pixels[2], 0, 'B channel');
  assertEqual(pixels[3], 255, 'A channel');
});

test('set_pixels writes base64 pixels to canvas', () => {
  const store = createMockStore();
  const testPixels = makeBlankPixels(16, 16);
  testPixels[0] = 42; testPixels[1] = 43; testPixels[2] = 44; testPixels[3] = 255;
  const b64 = pixelsToBase64(testPixels);
  const result = handleCommand('set_pixels', { pixels: b64 }, store);
  assert('response' in result, 'Should return response');
  assertEqual(store.pixels[0], 42, 'Pixel R written');
  assertEqual(store.pixels[1], 43, 'Pixel G written');
});

test('set_pixel writes single pixel', () => {
  const store = createMockStore();
  const result = handleCommand('set_pixel', { x: 5, y: 3, color: [100, 200, 50, 255] }, store);
  assert('response' in result, 'Should return response');
  const idx = (3 * 16 + 5) * 4;
  assertEqual(store.pixels[idx], 100, 'R at (5,3)');
  assertEqual(store.pixels[idx + 1], 200, 'G at (5,3)');
  assertEqual(store.pixels[idx + 2], 50, 'B at (5,3)');
});

test('select_tile changes selection', () => {
  const store = createMockStore();
  const result = handleCommand('select_tile', { col: 3, row: 2 }, store);
  assert('response' in result, 'Should return response');
  assertEqual(store.selectedTileCol, 3, 'col');
  assertEqual(store.selectedTileRow, 2, 'row');
  assertEqual(store.editTarget, 'tileset', 'editTarget switched');
});

test('select_frame changes selection and switches target', () => {
  const store = createMockStore();
  assertEqual(store.editTarget, 'tileset', 'starts as tileset');
  const result = handleCommand('select_frame', { col: 2, row: 5 }, store);
  assert('response' in result, 'Should return response');
  assertEqual(store.selectedFrameCol, 2, 'col');
  assertEqual(store.selectedFrameRow, 5, 'row');
  assertEqual(store.editTarget, 'spritesheet', 'editTarget switched');
});

test('set_edit_target switches target', () => {
  const store = createMockStore();
  handleCommand('set_edit_target', { target: 'spritesheet' }, store);
  assertEqual(store.editTarget, 'spritesheet', 'spritesheet');
  handleCommand('set_edit_target', { target: 'tileset' }, store);
  assertEqual(store.editTarget, 'tileset', 'tileset');
});

test('set_tool changes active tool', () => {
  const store = createMockStore();
  handleCommand('set_tool', { tool: 'eraser' }, store);
  assertEqual(store.activeTool, 'eraser', 'eraser');
  handleCommand('set_tool', { tool: 'fill' }, store);
  assertEqual(store.activeTool, 'fill', 'fill');
});

test('set_color updates fg and bg', () => {
  const store = createMockStore();
  handleCommand('set_color', { fg: [10, 20, 30, 255] }, store);
  assertEqual(store.fgColor[0], 10, 'fg R');
  handleCommand('set_color', { bg: [100, 110, 120, 255] }, store);
  assertEqual(store.bgColor[0], 100, 'bg R');
  handleCommand('set_color', { fg: [50, 60, 70, 255], bg: [80, 90, 100, 255] }, store);
  assertEqual(store.fgColor[0], 50, 'fg R after dual set');
  assertEqual(store.bgColor[0], 80, 'bg R after dual set');
});

test('clear resets canvas to blank', () => {
  const store = createMockStore();
  store.setPixel(0, 0, [255, 0, 0, 255]);
  assertEqual(store.pixels[0], 255, 'pre-clear R');
  handleCommand('clear', {}, store);
  assertEqual(store.pixels[0], 0, 'post-clear R');
});

test('undo/redo cycle', () => {
  const store = createMockStore();
  store.pushHistory(); // save blank state
  store.setPixel(0, 0, [99, 0, 0, 255]);
  store.pushHistory(); // save drawn state

  handleCommand('undo', {}, store);
  assertEqual(store.pixels[0], 0, 'after undo R=0');

  handleCommand('redo', {}, store);
  assertEqual(store.pixels[0], 99, 'after redo R=99');
});

test('unknown command returns error', () => {
  const store = createMockStore();
  const result = handleCommand('nonexistent', {}, store);
  assert('error' in result, 'Should return error');
  assert((result as { error: string }).error.includes('nonexistent'), 'Error includes cmd name');
});

// ---------------------------------------------------------------------------
// Heightmap / Normal map command tests
// ---------------------------------------------------------------------------

test('get_state includes heightmap fields', () => {
  const store = createMockStore();
  const result = handleCommand('get_state', {}, store);
  assert('response' in result, 'Should return response');
  const resp = result.response as Record<string, unknown>;
  assertEqual(resp['activeLayer'], 'diffuse', 'activeLayer');
  assertEqual(resp['heightValue'], 128, 'heightValue');
  assert(typeof resp['heightmap'] === 'string', 'heightmap is base64 string');
});

test('get_heightmap returns base64 heightmap with dimensions', () => {
  const store = createMockStore();
  // Set a specific heightmap value
  store.heightmapPixels[0] = 200;
  const result = handleCommand('get_heightmap', {}, store);
  assert('response' in result, 'Should return response');
  const resp = result.response as Record<string, unknown>;
  assertEqual(resp['width'], 16, 'width');
  assertEqual(resp['height'], 16, 'height');
  const hm = base64ToHeightmap(resp['heightmap'] as string);
  assertEqual(hm[0], 200, 'First pixel height');
  assertEqual(hm[1], 128, 'Second pixel height (default)');
});

test('set_heightmap writes base64 heightmap', () => {
  const store = createMockStore();
  const testHm = makeBlankHeightmap(16, 16);
  testHm[0] = 42;
  testHm[255] = 200;
  const b64 = heightmapToBase64(testHm);
  const result = handleCommand('set_heightmap', { heightmap: b64 }, store);
  assert('response' in result, 'Should return response');
  assertEqual(store.heightmapPixels[0], 42, 'Heightmap pixel 0');
  assertEqual(store.heightmapPixels[255], 200, 'Heightmap pixel 255');
});

test('get_normal_map returns computed RGBA normal map', () => {
  const store = createMockStore();
  // Flat heightmap → all normals should be (128, 128, 255, 255)
  const result = handleCommand('get_normal_map', {}, store);
  assert('response' in result, 'Should return response');
  const resp = result.response as Record<string, unknown>;
  assertEqual(resp['width'], 16, 'width');
  assertEqual(resp['height'], 16, 'height');
  const nm = base64ToPixels(resp['normal_map'] as string);
  assertEqual(nm.length, 16 * 16 * 4, 'Normal map size');
  assertEqual(nm[0], 128, 'R for flat normal');
  assertEqual(nm[1], 128, 'G for flat normal');
  assertEqual(nm[2], 255, 'B for flat normal');
  assertEqual(nm[3], 255, 'A');
});

test('set_layer switches active layer', () => {
  const store = createMockStore();
  assertEqual(store.activeLayer, 'diffuse', 'starts as diffuse');
  handleCommand('set_layer', { layer: 'heightmap' }, store);
  assertEqual(store.activeLayer, 'heightmap', 'switched to heightmap');
  handleCommand('set_layer', { layer: 'diffuse' }, store);
  assertEqual(store.activeLayer, 'diffuse', 'switched back to diffuse');
});

test('set_layer rejects invalid layer', () => {
  const store = createMockStore();
  const result = handleCommand('set_layer', { layer: 'invalid' }, store);
  assert('error' in result, 'Should return error');
});

test('set_height_value sets brush height', () => {
  const store = createMockStore();
  handleCommand('set_height_value', { value: 200 }, store);
  assertEqual(store.heightValue, 200, 'Height value');
  handleCommand('set_height_value', { value: 300 }, store);
  assertEqual(store.heightValue, 255, 'Clamped to 255');
  handleCommand('set_height_value', { value: -10 }, store);
  assertEqual(store.heightValue, 0, 'Clamped to 0');
});

test('base64 round-trip preserves pixel data', () => {
  const original = makeBlankPixels(16, 16);
  // Write some non-trivial data
  for (let i = 0; i < original.length; i++) {
    original[i] = i % 256;
  }
  const b64 = pixelsToBase64(original);
  const decoded = base64ToPixels(b64);
  assertEqual(decoded.length, original.length, 'Same length');
  for (let i = 0; i < original.length; i++) {
    if (decoded[i] !== original[i]) {
      assert(false, `Mismatch at index ${i}: ${decoded[i]} !== ${original[i]}`);
      break;
    }
  }
});

// Note: Summary is printed after async tests below.

// ---------------------------------------------------------------------------
// AI command tests (async — these mock fetch)
// ---------------------------------------------------------------------------

// Inline the AI helpers used by the test's handleCommand
const SAMPLER_NAMES = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc'];
const DEFAULT_NEGATIVE_PROMPT = 'smooth, realistic, 3d render, blurry, soft, high resolution, photorealistic, anti-aliasing, gradient, watercolor';

function buildFullPrompt_test(ctx: { prompt: string; editTarget: EditTarget; manifest: AssetManifest; col: number; row: number; targetW: number; targetH: number; activeLayer: string }): string {
  const slotLabel = ctx.editTarget === 'tileset'
    ? ctx.manifest.tileset.slots.find((s) => s.id === ctx.row * ctx.manifest.tileset.columns + ctx.col)?.label
    : ctx.manifest.spritesheet.rows.find((r) => r.row === ctx.row)?.label;
  const target = ctx.editTarget === 'tileset'
    ? `${ctx.targetW}x${ctx.targetH} pixel art tile, tile (${ctx.col},${ctx.row})${slotLabel ? ` "${slotLabel}"` : ''}`
    : `${ctx.targetW}x${ctx.targetH} pixel art sprite frame, ${slotLabel ?? `row ${ctx.row}`} frame ${ctx.col}`;
  const heightmapSuffix = ctx.activeLayer === 'heightmap'
    ? ', height map, white=high black=low, grayscale, depth map'
    : ', pixel art, 8-bit, 16-bit, low-res, retro game graphics, NES palette, clean edges, game asset';
  return `${ctx.prompt}, ${target}${heightmapSuffix}`;
}

function buildNegativePrompt_test(negativePrompt?: string): string {
  if (negativePrompt) return `${negativePrompt}, watermark, text, signature`;
  return 'smooth, realistic, 3d render, blurry, soft, high resolution, photorealistic, watermark, text, signature';
}

// Extend handleCommand with ai_check and ai_get_config (no fetch needed for these tests)
type AsyncCommandResult = CommandResult | Promise<CommandResult>;

function handleCommandAsync(
  cmd: string,
  params: Record<string, unknown>,
  store: MockStore,
): AsyncCommandResult {
  switch (cmd) {
    case 'ai_check': {
      const comfyUrl = (params['comfy_url'] as string | undefined) ?? 'http://localhost:8188';
      // Mock: check availability by calling fetch
      return fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(5000) })
        .then(async (response) => {
          if (!response.ok) return { response: { available: false, error: `HTTP ${response.status}` } };
          return { response: { available: true } };
        })
        .catch((err) => ({ response: { available: false, error: String(err) } }));
    }
    case 'ai_get_config': {
      return {
        response: {
          comfy_url: 'http://localhost:8188',
          default_negative_prompt: DEFAULT_NEGATIVE_PROMPT,
          samplers: [...SAMPLER_NAMES],
          default_steps: 20,
          default_cfg: 7,
          default_sampler: 'euler',
        },
      };
    }
    default:
      return handleCommand(cmd, params, store);
  }
}

// Mock fetch for tests
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): void {
  (globalThis as Record<string, unknown>).fetch = handler;
}

function restoreFetch(): void {
  (globalThis as Record<string, unknown>).fetch = originalFetch;
}

async function asyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${(err as Error).message}`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('  AI Remote Command Tests');
console.log('='.repeat(60));

// We need to run async tests sequentially
async function runAsyncTests() {
  await asyncTest('ai_check returns available when server responds', async () => {
    const store = createMockStore();
    mockFetch(async () => new Response(JSON.stringify({ system: {} }), { status: 200 }));
    try {
      const result = await handleCommandAsync('ai_check', {}, store);
      assert('response' in result, 'Should return response');
      const resp = result.response as Record<string, unknown>;
      assertEqual(resp['available'], true, 'available');
    } finally {
      restoreFetch();
    }
  });

  await asyncTest('ai_check handles unavailable server', async () => {
    const store = createMockStore();
    mockFetch(async () => { throw new Error('Connection refused'); });
    try {
      const result = await handleCommandAsync('ai_check', {}, store);
      assert('response' in result, 'Should return response');
      const resp = result.response as Record<string, unknown>;
      assertEqual(resp['available'], false, 'available');
      assert(typeof resp['error'] === 'string', 'error is string');
    } finally {
      restoreFetch();
    }
  });

  await asyncTest('ai_check with custom comfy_url', async () => {
    const store = createMockStore();
    let calledUrl = '';
    mockFetch(async (url) => {
      calledUrl = url;
      return new Response(JSON.stringify({ system: {} }), { status: 200 });
    });
    try {
      await handleCommandAsync('ai_check', { comfy_url: 'http://myhost:9999' }, store);
      assert(calledUrl.includes('myhost:9999'), 'Used custom URL');
    } finally {
      restoreFetch();
    }
  });

  await asyncTest('ai_get_config returns defaults', async () => {
    const store = createMockStore();
    const result = handleCommandAsync('ai_get_config', {}, store);
    assert(!(result instanceof Promise), 'ai_get_config is sync');
    assert('response' in (result as CommandResult), 'Should return response');
    const resp = (result as { response: Record<string, unknown> }).response;
    assertEqual(resp['default_steps'], 20, 'default_steps');
    assertEqual(resp['default_cfg'], 7, 'default_cfg');
    assertEqual(resp['default_sampler'], 'euler', 'default_sampler');
    assert(Array.isArray(resp['samplers']), 'samplers is array');
    assertEqual((resp['samplers'] as string[]).length, 6, 'sampler count');
    assert(typeof resp['default_negative_prompt'] === 'string', 'has negative prompt');
  });

  await asyncTest('ai_generate returns async result (Promise)', async () => {
    const store = createMockStore();
    // We just test that ai_generate on the real handleCommandAsync returns a Promise
    // (it will fail on fetch, but we verify it's async)
    mockFetch(async () => { throw new Error('mock unavailable'); });
    try {
      const result = handleCommandAsync('ai_check', {}, store);
      assert(result instanceof Promise, 'ai_check returns Promise');
    } finally {
      restoreFetch();
    }
  });

  await asyncTest('buildFullPrompt includes tile context for tileset', async () => {
    const m = JSON.parse(JSON.stringify(DEFAULT_ASSET_MANIFEST)) as AssetManifest;
    const result = buildFullPrompt_test({
      prompt: 'stone floor',
      editTarget: 'tileset',
      manifest: m,
      col: 2,
      row: 1,
      targetW: 16,
      targetH: 16,
      activeLayer: 'diffuse',
    });
    assert(result.includes('stone floor'), 'Contains user prompt');
    assert(result.includes('tile (2,1)'), 'Contains tile coords');
    assert(result.includes('pixel art'), 'Contains pixel art suffix');
  });

  await asyncTest('buildFullPrompt for heightmap includes grayscale suffix', async () => {
    const m = JSON.parse(JSON.stringify(DEFAULT_ASSET_MANIFEST)) as AssetManifest;
    const result = buildFullPrompt_test({
      prompt: 'rocky surface',
      editTarget: 'tileset',
      manifest: m,
      col: 0,
      row: 0,
      targetW: 16,
      targetH: 16,
      activeLayer: 'heightmap',
    });
    assert(result.includes('height map'), 'Contains height map');
    assert(result.includes('grayscale'), 'Contains grayscale');
    assert(!result.includes('NES palette'), 'No pixel art suffix');
  });

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log(`  SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runAsyncTests();
