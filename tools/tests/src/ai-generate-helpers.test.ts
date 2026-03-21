/**
 * AI Generate Helpers — Unit tests for prompt building and pixel helpers.
 *
 * Usage: node --import tsx/esm --conditions source src/ai-generate-helpers.test.ts
 */
import { DEFAULT_ASSET_MANIFEST, type AssetManifest } from '@gseurat/asset-types';

// Re-implement types locally (no browser deps)
type EditTarget = 'tileset' | 'spritesheet';
type ActiveLayer = 'diffuse' | 'heightmap';
type PixelData = Uint8ClampedArray;
type HeightmapData = Uint8ClampedArray;

// ---------------------------------------------------------------------------
// Inline the pure helpers (can't import browser-targeted module directly)
// ---------------------------------------------------------------------------

interface PromptContext {
  prompt: string;
  editTarget: EditTarget;
  manifest: AssetManifest;
  col: number;
  row: number;
  targetW: number;
  targetH: number;
  activeLayer: ActiveLayer;
}

function buildFullPrompt(ctx: PromptContext): string {
  const slotLabel = ctx.editTarget === 'tileset'
    ? ctx.manifest.tileset.slots.find(
        (s) => s.id === ctx.row * ctx.manifest.tileset.columns + ctx.col,
      )?.label
    : ctx.manifest.spritesheet.rows.find((r) => r.row === ctx.row)?.label;

  const target = ctx.editTarget === 'tileset'
    ? `${ctx.targetW}x${ctx.targetH} pixel art tile, tile (${ctx.col},${ctx.row})${slotLabel ? ` "${slotLabel}"` : ''}`
    : `${ctx.targetW}x${ctx.targetH} pixel art sprite frame, ${slotLabel ?? `row ${ctx.row}`} frame ${ctx.col}`;

  const heightmapSuffix = ctx.activeLayer === 'heightmap'
    ? ', height map, white=high black=low, grayscale, depth map'
    : ', pixel art, 8-bit, 16-bit, low-res, retro game graphics, NES palette, clean edges, game asset';

  return `${ctx.prompt}, ${target}${heightmapSuffix}`;
}

function buildNegativePrompt(negativePrompt?: string): string {
  if (negativePrompt) {
    return `${negativePrompt}, watermark, text, signature`;
  }
  return 'smooth, realistic, 3d render, blurry, soft, high resolution, photorealistic, watermark, text, signature';
}

function pixelsToHeightmap(pixels: PixelData, w: number, h: number): HeightmapData {
  const hm = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    hm[i] = pixels[i * 4]; // R channel
  }
  return hm as HeightmapData;
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
console.log('  AI Generate Helpers Unit Tests');
console.log('='.repeat(60));

const manifest: AssetManifest = JSON.parse(JSON.stringify(DEFAULT_ASSET_MANIFEST));

test('buildFullPrompt for tileset includes tile coords and pixel art suffix', () => {
  const result = buildFullPrompt({
    prompt: 'stone floor',
    editTarget: 'tileset',
    manifest,
    col: 2,
    row: 1,
    targetW: 16,
    targetH: 16,
    activeLayer: 'diffuse',
  });
  assert(result.includes('stone floor'), 'Contains user prompt');
  assert(result.includes('tile (2,1)'), 'Contains tile coords');
  assert(result.includes('16x16 pixel art tile'), 'Contains dimensions + tile');
  assert(result.includes('pixel art'), 'Contains pixel art suffix');
  assert(result.includes('NES palette'), 'Contains NES palette');
});

test('buildFullPrompt for tileset includes slot label when available', () => {
  const m: AssetManifest = JSON.parse(JSON.stringify(DEFAULT_ASSET_MANIFEST));
  m.tileset.slots = [{ id: 0, label: 'floor' }, { id: 1, label: 'wall' }];
  const result = buildFullPrompt({
    prompt: 'test',
    editTarget: 'tileset',
    manifest: m,
    col: 0,
    row: 0,
    targetW: 16,
    targetH: 16,
    activeLayer: 'diffuse',
  });
  assert(result.includes('"floor"'), 'Contains slot label');
});

test('buildFullPrompt for spritesheet includes row label and frame number', () => {
  const m: AssetManifest = JSON.parse(JSON.stringify(DEFAULT_ASSET_MANIFEST));
  m.spritesheet.rows = [{ row: 0, label: 'idle_down' }];
  const result = buildFullPrompt({
    prompt: 'hero character',
    editTarget: 'spritesheet',
    manifest: m,
    col: 3,
    row: 0,
    targetW: 16,
    targetH: 16,
    activeLayer: 'diffuse',
  });
  assert(result.includes('hero character'), 'Contains user prompt');
  assert(result.includes('sprite frame'), 'Contains sprite frame');
  assert(result.includes('idle_down'), 'Contains row label');
  assert(result.includes('frame 3'), 'Contains frame number');
});

test('buildFullPrompt for heightmap layer includes grayscale/depth suffix', () => {
  const result = buildFullPrompt({
    prompt: 'rocky surface',
    editTarget: 'tileset',
    manifest,
    col: 0,
    row: 0,
    targetW: 16,
    targetH: 16,
    activeLayer: 'heightmap',
  });
  assert(result.includes('height map'), 'Contains height map');
  assert(result.includes('grayscale'), 'Contains grayscale');
  assert(result.includes('depth map'), 'Contains depth map');
  assert(!result.includes('NES palette'), 'Does not contain pixel art suffix');
});

test('buildNegativePrompt with custom prompt appends standard suffixes', () => {
  const result = buildNegativePrompt('blurry, low quality');
  assert(result.includes('blurry, low quality'), 'Contains custom prompt');
  assert(result.includes('watermark'), 'Appends watermark');
  assert(result.includes('text'), 'Appends text');
  assert(result.includes('signature'), 'Appends signature');
});

test('buildNegativePrompt default returns standard negative prompt', () => {
  const result = buildNegativePrompt(undefined);
  assert(result.includes('smooth'), 'Contains smooth');
  assert(result.includes('realistic'), 'Contains realistic');
  assert(result.includes('watermark'), 'Contains watermark');
  assert(result.includes('photorealistic'), 'Contains photorealistic');
});

test('pixelsToHeightmap extracts R channel from RGBA', () => {
  const w = 4, h = 4;
  const pixels = new Uint8ClampedArray(w * h * 4);
  // Set pixel (0,0) = R:100, G:200, B:50, A:255
  pixels[0] = 100; pixels[1] = 200; pixels[2] = 50; pixels[3] = 255;
  // Set pixel (1,0) = R:42, G:0, B:0, A:255
  pixels[4] = 42; pixels[5] = 0; pixels[6] = 0; pixels[7] = 255;
  // Set pixel (2,0) = R:255, G:128, B:64, A:128
  pixels[8] = 255; pixels[9] = 128; pixels[10] = 64; pixels[11] = 128;

  const hm = pixelsToHeightmap(pixels as PixelData, w, h);
  assertEqual(hm.length, w * h, 'Heightmap size');
  assertEqual(hm[0], 100, 'Pixel 0 R channel');
  assertEqual(hm[1], 42, 'Pixel 1 R channel');
  assertEqual(hm[2], 255, 'Pixel 2 R channel');
  // Remaining pixels should be 0 (blank RGBA)
  assertEqual(hm[3], 0, 'Pixel 3 R channel (blank)');
});

// Summary
console.log('\n' + '='.repeat(60));
console.log(`  SUMMARY: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
