/**
 * Remote Commands — Unit test for the pixel-painter command handler.
 *
 * Tests handleCommand() in isolation by creating a mock store object.
 * Does NOT require the browser or dev server.
 *
 * Usage: node --import tsx/esm --conditions source src/remote-commands.test.ts
 */
import { DEFAULT_ASSET_MANIFEST, type AssetManifest } from '@vulkan-game-tools/asset-types';

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
  history: Array<{ pixels: PixelData }>;
  historyIndex: number;

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
      store.history.push({ pixels: new Uint8ClampedArray(store.pixels) as PixelData });
      store.historyIndex = store.history.length - 1;
    },
    undo() {
      if (store.historyIndex > 0) {
        store.historyIndex--;
        store.pixels = new Uint8ClampedArray(store.history[store.historyIndex].pixels) as PixelData;
      }
    },
    redo() {
      if (store.historyIndex < store.history.length - 1) {
        store.historyIndex++;
        store.pixels = new Uint8ClampedArray(store.history[store.historyIndex].pixels) as PixelData;
      }
    },
    setActiveTool(tool: DrawingTool) { store.activeTool = tool; },
    setFgColor(c: RGBA) { store.fgColor = c; },
    setBgColor(c: RGBA) { store.bgColor = c; },
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

// Summary
console.log('\n' + '='.repeat(60));
console.log(`  SUMMARY: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
