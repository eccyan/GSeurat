import { TestRunner, assert, assertEqual, assertTruthy } from './qa-runner.js';

export function runMapPainterTests(runner: TestRunner): void {
  runner.test('Store is accessible', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(state !== null, 'State should not be null');
    assert('width' in state, 'State should have width');
    assert('height' in state, 'State should have height');
    assert('layers' in state, 'State should have layers');
    assert('heights' in state, 'State should have heights');
    assert('activeTool' in state, 'State should have activeTool');
    assert('collisionGrid' in state, 'State should have collisionGrid');
  });

  runner.test('Default map dimensions are 32x32', async (client) => {
    const width = await client.getStateSelector('width') as number;
    const height = await client.getStateSelector('height') as number;
    assertEqual(width, 32, 'Default width');
    assertEqual(height, 32, 'Default height');
  });

  runner.test('initMap creates new map with correct dimensions', async (client) => {
    await client.dispatch('initMap', 16, 16);
    const width = await client.getStateSelector('width') as number;
    const height = await client.getStateSelector('height') as number;
    assertEqual(width, 16, 'Width after init');
    assertEqual(height, 16, 'Height after init');
  });

  runner.test('setPixel updates pixel data', async (client) => {
    await client.dispatch('initMap', 8, 8);
    await client.dispatch('setActiveLayer', 'ground');
    await client.dispatch('setPixel', 3, 4, 255, 128, 0, 255);

    const layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    const ground = layers.ground;
    // Pixel at (3,4) in 8-wide grid: index = (4*8+3)*4 = 124
    const idx = (4 * 8 + 3) * 4;
    assertEqual(ground[idx], 255, 'Pixel R=255');
    assertEqual(ground[idx + 1], 128, 'Pixel G=128');
    assertEqual(ground[idx + 2], 0, 'Pixel B=0');
    assertEqual(ground[idx + 3], 255, 'Pixel A=255');
  });

  runner.test('erasePixel clears pixel data', async (client) => {
    await client.dispatch('erasePixel', 3, 4);
    const layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    const ground = layers.ground;
    const idx = (4 * 8 + 3) * 4;
    assertEqual(ground[idx], 0, 'Erased pixel R=0');
    assertEqual(ground[idx + 3], 0, 'Erased pixel A=0');
  });

  runner.test('setHeight updates height data', async (client) => {
    await client.dispatch('setHeight', 2, 2, 5);
    const heights = await client.getStateSelector('heights') as Record<string, number>;
    const idx = 2 * 8 + 2;
    assertEqual(heights[idx], 5, 'Height at (2,2)=5');
  });

  runner.test('Tool selection works', async (client) => {
    await client.dispatch('setTool', 'fill');
    const tool = await client.getStateSelector('activeTool');
    assertEqual(tool, 'fill', 'Active tool=fill');

    await client.dispatch('setTool', 'height');
    const tool2 = await client.getStateSelector('activeTool');
    assertEqual(tool2, 'height', 'Active tool=height');

    await client.dispatch('setTool', 'pencil');
  });

  runner.test('Layer selection works', async (client) => {
    await client.dispatch('setActiveLayer', 'walls');
    const layer = await client.getStateSelector('activeLayer');
    assertEqual(layer, 'walls', 'Active layer=walls');
    await client.dispatch('setActiveLayer', 'ground');
  });

  runner.test('Color selection works', async (client) => {
    await client.dispatch('setColor', [100, 200, 50, 255]);
    const color = await client.getStateSelector('activeColor') as number[];
    assertEqual(color[0], 100, 'Color R=100');
    assertEqual(color[1], 200, 'Color G=200');
    assertEqual(color[2], 50, 'Color B=50');
    assertEqual(color[3], 255, 'Color A=255');
  });

  runner.test('Height brush value updates', async (client) => {
    await client.dispatch('setHeightBrushValue', 7);
    const val = await client.getStateSelector('heightBrushValue') as number;
    assertEqual(val, 7, 'Height brush value=7');
  });

  runner.test('Zoom clamps to valid range', async (client) => {
    await client.dispatch('setZoom', 100);
    const zoom = await client.getStateSelector('zoom') as number;
    assertEqual(zoom, 64, 'Zoom clamped to max 64');

    await client.dispatch('setZoom', -5);
    const zoom2 = await client.getStateSelector('zoom') as number;
    assertEqual(zoom2, 1, 'Zoom clamped to min 1');

    await client.dispatch('setZoom', 16);
  });

  runner.test('Collision toggle works', async (client) => {
    await client.dispatch('initMap', 4, 4);
    await client.dispatch('toggleCollision', 1, 2);
    const grid = await client.getStateSelector('collisionGrid') as boolean[];
    const idx = 2 * 4 + 1;
    assertEqual(grid[idx], true, 'Collision toggled on at (1,2)');

    await client.dispatch('toggleCollision', 1, 2);
    const grid2 = await client.getStateSelector('collisionGrid') as boolean[];
    assertEqual(grid2[idx], false, 'Collision toggled off at (1,2)');
  });

  runner.test('Auto-generate collision from heights', async (client) => {
    await client.dispatch('initMap', 4, 4);
    await client.dispatch('setHeight', 0, 0, 3);
    await client.dispatch('setHeight', 1, 1, 5);
    await client.dispatch('setHeight', 2, 2, 0);

    await client.dispatch('autoGenerateCollision', 2);
    const grid = await client.getStateSelector('collisionGrid') as boolean[];
    assertEqual(grid[0 * 4 + 0], true, 'Height 3 > threshold 2 → solid');
    assertEqual(grid[1 * 4 + 1], true, 'Height 5 > threshold 2 → solid');
    assertEqual(grid[2 * 4 + 2], false, 'Height 0 ≤ threshold 2 → walkable');
  });

  runner.test('Undo/redo works for pixel operations', async (client) => {
    await client.dispatch('initMap', 4, 4);
    await client.dispatch('setActiveLayer', 'ground');

    // Push undo, paint a pixel
    await client.dispatch('pushUndo');
    await client.dispatch('setPixel', 0, 0, 255, 0, 0, 255);

    // Push undo, paint another pixel
    await client.dispatch('pushUndo');
    await client.dispatch('setPixel', 1, 0, 0, 255, 0, 255);

    // Verify both pixels set
    let layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    assertEqual(layers.ground[0], 255, 'Pixel (0,0) R=255 before undo');
    assertEqual(layers.ground[4], 0, 'Pixel (1,0) R=0 before undo');
    assertEqual(layers.ground[5], 255, 'Pixel (1,0) G=255 before undo');

    // Undo last paint
    await client.dispatch('undo');
    layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    assertEqual(layers.ground[4], 0, 'Pixel (1,0) R=0 after undo');
    assertEqual(layers.ground[5], 0, 'Pixel (1,0) G=0 after undo (erased)');
    // First pixel should still be there
    assertEqual(layers.ground[0], 255, 'Pixel (0,0) R=255 still there after 1 undo');

    // Redo
    await client.dispatch('redo');
    layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    assertEqual(layers.ground[5], 255, 'Pixel (1,0) G=255 after redo');
  });

  runner.test('resizeMap preserves existing data', async (client) => {
    await client.dispatch('initMap', 4, 4);
    await client.dispatch('setActiveLayer', 'ground');
    await client.dispatch('setPixel', 1, 1, 200, 100, 50, 255);

    // Resize to 8x8
    await client.dispatch('resizeMap', 8, 8);
    const width = await client.getStateSelector('width') as number;
    assertEqual(width, 8, 'Width after resize=8');

    // Original pixel (1,1) should be preserved at new position
    const layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    const idx = (1 * 8 + 1) * 4; // row=1, col=1 in 8-wide grid
    assertEqual(layers.ground[idx], 200, 'Pixel preserved after resize R=200');
  });

  runner.test('fillArea floods connected region', async (client) => {
    await client.dispatch('initMap', 4, 4);
    await client.dispatch('setActiveLayer', 'ground');

    // Fill entire 4x4 grid with green (all cells are transparent, so flood fills everything)
    await client.dispatch('fillArea', 0, 0, 0, 200, 0, 255);

    const layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    // Check a few cells
    assertEqual(layers.ground[1], 200, 'Fill pixel (0,0) G=200');
    const idx2 = (2 * 4 + 3) * 4;
    assertEqual(layers.ground[idx2 + 1], 200, 'Fill pixel (3,2) G=200');
  });

  runner.test('Preview camera updates', async (client) => {
    await client.dispatch('setPreviewCamera', {
      position: [5, 10, 20],
      target: [1, 2, 3],
      fov: 60,
    });
    const cam = await client.getStateSelector('previewCamera') as {
      position: number[]; target: number[]; fov: number
    };
    assertEqual(cam.position[0], 5, 'Camera pos X=5');
    assertEqual(cam.position[1], 10, 'Camera pos Y=10');
    assertEqual(cam.target[2], 3, 'Camera target Z=3');
    assertEqual(cam.fov, 60, 'Camera FOV=60');
  });

  runner.test('showCollision toggle works', async (client) => {
    await client.dispatch('setShowCollision', true);
    const show = await client.getStateSelector('showCollision') as boolean;
    assertEqual(show, true, 'showCollision=true');
    await client.dispatch('setShowCollision', false);
  });

  runner.test('Multiple layers are independent', async (client) => {
    await client.dispatch('initMap', 4, 4);

    // Paint ground layer
    await client.dispatch('setActiveLayer', 'ground');
    await client.dispatch('setPixel', 0, 0, 255, 0, 0, 255);

    // Paint walls layer
    await client.dispatch('setActiveLayer', 'walls');
    await client.dispatch('setPixel', 0, 0, 0, 0, 255, 255);

    // Verify layers are independent
    const layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    assertEqual(layers.ground[0], 255, 'Ground R=255');
    assertEqual(layers.ground[2], 0, 'Ground B=0');
    assertEqual(layers.walls[0], 0, 'Walls R=0');
    assertEqual(layers.walls[2], 255, 'Walls B=255');
  });
}
