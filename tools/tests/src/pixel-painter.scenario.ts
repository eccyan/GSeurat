/**
 * Pixel Painter — Scenario Tests (multi-step workflows)
 */
import { TestRunner, assert, assertEqual } from './qa-runner.js';
import { assertStateHas } from './helpers.js';

export function runPixelPainterScenarios(runner: TestRunner): void {
  // -----------------------------------------------------------------------
  // Scenario: Create multi-frame sprite animation
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Create multi-frame sprite animation', async (client) => {
    // 1. Switch to spritesheet edit target
    await client.dispatch('setEditTarget', 'spritesheet');
    await assertStateHas<string>(
      client,
      'editTarget',
      (v) => v === 'spritesheet',
      'Edit target should be spritesheet',
    );

    // 2. Select frame (0,0) — draw pattern (4 corner pixels)
    await client.dispatch('selectFrame', 0, 0);
    await client.dispatch('pushHistory');
    await client.dispatch('setPixel', 0, 0, [255, 0, 0, 255]);   // top-left red
    await client.dispatch('setPixel', 15, 0, [0, 255, 0, 255]);  // top-right green
    await client.dispatch('setPixel', 0, 15, [0, 0, 255, 255]);  // bottom-left blue
    await client.dispatch('setPixel', 15, 15, [255, 255, 0, 255]); // bottom-right yellow

    // 3. Push history, select frame (1,0) — draw shifted pattern
    await client.dispatch('pushHistory');
    await client.dispatch('selectFrame', 1, 0);
    await client.dispatch('setPixel', 1, 0, [255, 0, 0, 255]);
    await client.dispatch('setPixel', 14, 0, [0, 255, 0, 255]);
    await client.dispatch('setPixel', 1, 15, [0, 0, 255, 255]);
    await client.dispatch('setPixel', 14, 15, [255, 255, 0, 255]);

    // 4. Push history, select frame (2,0) — draw shifted pattern
    await client.dispatch('pushHistory');
    await client.dispatch('selectFrame', 2, 0);
    await client.dispatch('setPixel', 2, 0, [255, 0, 0, 255]);
    await client.dispatch('setPixel', 13, 0, [0, 255, 0, 255]);
    await client.dispatch('setPixel', 2, 15, [0, 0, 255, 255]);
    await client.dispatch('setPixel', 13, 15, [255, 255, 0, 255]);

    // 5. Select frame (3,0) — draw final frame
    await client.dispatch('pushHistory');
    await client.dispatch('selectFrame', 3, 0);
    await client.dispatch('setPixel', 3, 0, [255, 0, 0, 255]);
    await client.dispatch('setPixel', 12, 0, [0, 255, 0, 255]);
    await client.dispatch('setPixel', 3, 15, [0, 0, 255, 255]);
    await client.dispatch('setPixel', 12, 15, [255, 255, 0, 255]);

    // 6. Switch back to frame (0,0), verify original pixels intact
    await client.dispatch('selectFrame', 0, 0);
    const pixels = (await client.getStateSelector('pixels')) as Record<string, number>;
    // Pixel (0,0) = index 0: R=255 (red corner)
    assertEqual(pixels[0], 255, 'Frame (0,0) pixel (0,0) R intact');
    assertEqual(pixels[1], 0, 'Frame (0,0) pixel (0,0) G intact');
    assertEqual(pixels[2], 0, 'Frame (0,0) pixel (0,0) B intact');
    // Pixel (15,0) = index 15*4 = 60: R=0 G=255 (green corner)
    assertEqual(pixels[60], 0, 'Frame (0,0) pixel (15,0) R intact');
    assertEqual(pixels[61], 255, 'Frame (0,0) pixel (15,0) G intact');

    // 7. Verify all 4 frames have distinct pixel data by checking each frame's unique pattern
    // Frame 0: pixel at (0,0) is red
    await client.dispatch('selectFrame', 0, 0);
    const f0 = (await client.getStateSelector('pixels')) as Record<string, number>;
    assertEqual(f0[0], 255, 'Frame 0 has red at (0,0)');

    // Frame 1: pixel at (1,0) is red, (0,0) should be empty
    await client.dispatch('selectFrame', 1, 0);
    const f1 = (await client.getStateSelector('pixels')) as Record<string, number>;
    assertEqual(f1[4], 255, 'Frame 1 has red at (1,0)');
    assertEqual(f1[0], 0, 'Frame 1 has nothing at (0,0)');

    // Frame 2: pixel at (2,0) is red
    await client.dispatch('selectFrame', 2, 0);
    const f2 = (await client.getStateSelector('pixels')) as Record<string, number>;
    assertEqual(f2[8], 255, 'Frame 2 has red at (2,0)');
    assertEqual(f2[0], 0, 'Frame 2 has nothing at (0,0)');

    // Frame 3: pixel at (3,0) is red
    await client.dispatch('selectFrame', 3, 0);
    const f3 = (await client.getStateSelector('pixels')) as Record<string, number>;
    assertEqual(f3[12], 255, 'Frame 3 has red at (3,0)');
    assertEqual(f3[0], 0, 'Frame 3 has nothing at (0,0)');
  });

  // -----------------------------------------------------------------------
  // Scenario: Mirror mode drawing workflow
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Mirror mode drawing workflow', async (client) => {
    // Start fresh frame
    await client.dispatch('selectFrame', 0, 0);
    await client.dispatch('pushHistory');

    // 1. Enable horizontal mirror
    await client.dispatch('setMirrorMode', 'horizontal');
    await assertStateHas<string>(
      client,
      'mirrorMode',
      (m) => m === 'horizontal',
      'Mirror mode should be horizontal',
    );

    // 2. Draw pixel at (2,0) — verify mirrored pixel at (13,0)
    await client.dispatch('setPixel', 2, 0, [128, 128, 128, 255]);
    // Note: mirror mode in the store doesn't auto-mirror setPixel dispatches;
    // it's a UI-level feature. We test the state tracking instead.
    const pixels = (await client.getStateSelector('pixels')) as Record<string, number>;
    assertEqual(pixels[8], 128, 'Pixel at (2,0) set via mirror mode');

    // 3. Enable vertical mirror (both mode)
    await client.dispatch('setMirrorMode', 'both');
    await assertStateHas<string>(
      client,
      'mirrorMode',
      (m) => m === 'both',
      'Mirror mode should be both',
    );

    // 4. Draw pixel at (0,2) — in both mode, this would mirror to 4 positions in the UI
    await client.dispatch('setPixel', 0, 2, [64, 64, 64, 255]);
    const pixelsAfter = (await client.getStateSelector('pixels')) as Record<string, number>;
    // Verify the source pixel is set
    const idx02 = (2 * 16 + 0) * 4; // row=2, col=0
    assertEqual(pixelsAfter[idx02], 64, 'Pixel at (0,2) set');

    // 5. Undo -> pixels removed
    await client.dispatch('undo');
    const pixelsUndo = (await client.getStateSelector('pixels')) as Record<string, number>;
    // After undo, the pixel at (0,2) should be reverted
    assertEqual(pixelsUndo[idx02], 0, 'Pixel at (0,2) undone');

    // 6. Disable mirror, verify mode is 'none'
    await client.dispatch('setMirrorMode', 'none');
    await assertStateHas<string>(
      client,
      'mirrorMode',
      (m) => m === 'none',
      'Mirror mode should be none after disable',
    );
  });

  // -----------------------------------------------------------------------
  // Scenario: Manifest defaults match expected values
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Manifest defaults are correct', async (client) => {
    const manifest = (await client.getStateSelector('manifest')) as Record<string, unknown>;
    assert(manifest !== null, 'Manifest should exist');

    const tileset = manifest['tileset'] as Record<string, unknown>;
    assertEqual(tileset['tile_width'], 16, 'Default tile width');
    assertEqual(tileset['tile_height'], 16, 'Default tile height');
    assertEqual(tileset['columns'], 8, 'Default tileset columns');
    assertEqual(tileset['rows'], 3, 'Default tileset rows');

    const slots = tileset['slots'] as Array<Record<string, unknown>>;
    assert(slots.length >= 10, 'Should have at least 10 tile slots');
    assertEqual(slots[0]['label'], 'floor', 'Slot 0 label');
    assertEqual(slots[1]['label'], 'wall', 'Slot 1 label');

    const spritesheet = manifest['spritesheet'] as Record<string, unknown>;
    assertEqual(spritesheet['frame_width'], 16, 'Default frame width');
    assertEqual(spritesheet['frame_height'], 16, 'Default frame height');
    assertEqual(spritesheet['columns'], 4, 'Default spritesheet columns');

    const rows = spritesheet['rows'] as Array<Record<string, unknown>>;
    assert(rows.length === 12, 'Should have 12 sprite rows');
    assertEqual(rows[0]['label'], 'idle_S', 'Row 0 label');
    assertEqual(rows[4]['label'], 'walk_S', 'Row 4 label');
    assertEqual(rows[8]['label'], 'run_S', 'Row 8 label');
  });

  // -----------------------------------------------------------------------
  // Scenario: Manifest update changes pixel dimensions
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Manifest update resizes canvas', async (client) => {
    // 1. Switch to tileset and draw a pixel
    await client.dispatch('setEditTarget', 'tileset');
    await client.dispatch('selectTile', 0, 0);
    await client.dispatch('pushHistory');
    await client.dispatch('setPixel', 0, 0, [100, 100, 100, 255]);

    // 2. Read current manifest
    const origManifest = (await client.getStateSelector('manifest')) as Record<string, unknown>;
    const origTileset = origManifest['tileset'] as Record<string, unknown>;
    assertEqual(origTileset['tile_width'], 16, 'Original tile width is 16');

    // 3. Update manifest with 32x32 tile dimensions
    const newManifest = JSON.parse(JSON.stringify(origManifest));
    newManifest['tileset']['tile_width'] = 32;
    newManifest['tileset']['tile_height'] = 32;
    await client.dispatch('setManifest', newManifest);

    // 4. Verify manifest updated
    const updatedManifest = (await client.getStateSelector('manifest')) as Record<string, unknown>;
    const updatedTileset = updatedManifest['tileset'] as Record<string, unknown>;
    assertEqual(updatedTileset['tile_width'], 32, 'Updated tile width is 32');
    assertEqual(updatedTileset['tile_height'], 32, 'Updated tile height is 32');

    // 5. Verify canvas was cleared (new dims = new blank canvas)
    const pixels = (await client.getStateSelector('pixels')) as Record<string, number>;
    assertEqual(pixels[0], 0, 'Canvas cleared after dim change — pixel (0,0) R=0');

    // 6. Verify new canvas has correct size (32*32*4 = 4096 bytes)
    // Uint8ClampedArray serialized as object — count keys
    const keys = Object.keys(pixels);
    assertEqual(keys.length, 32 * 32 * 4, 'Canvas has 32x32 pixel data');

    // 7. Draw pixel with new dimensions and verify bounds
    await client.dispatch('setPixel', 31, 31, [200, 200, 200, 255]);
    const pixelsAfter = (await client.getStateSelector('pixels')) as Record<string, number>;
    const idx = (31 * 32 + 31) * 4;
    assertEqual(pixelsAfter[idx], 200, 'Pixel at (31,31) in 32x32 canvas R=200');

    // 8. Restore original manifest (16x16)
    await client.dispatch('setManifest', origManifest);
    const restoredManifest = (await client.getStateSelector('manifest')) as Record<string, unknown>;
    const restoredTileset = restoredManifest['tileset'] as Record<string, unknown>;
    assertEqual(restoredTileset['tile_width'], 16, 'Restored tile width is 16');
  });

  // -----------------------------------------------------------------------
  // Scenario: Manifest settings panel toggle
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Manifest settings panel toggle', async (client) => {
    // 1. Verify initial state — settings panel hidden
    let show = await client.getStateSelector('showManifestSettings');
    assertEqual(show, false, 'Settings panel initially hidden');

    // 2. Toggle on
    await client.dispatch('setShowManifestSettings', true);
    show = await client.getStateSelector('showManifestSettings');
    assertEqual(show, true, 'Settings panel shown after toggle');

    // 3. Toggle off
    await client.dispatch('setShowManifestSettings', false);
    show = await client.getStateSelector('showManifestSettings');
    assertEqual(show, false, 'Settings panel hidden after second toggle');
  });

  // -----------------------------------------------------------------------
  // Scenario: Tile selection with manifest-driven grid
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Tile selection across manifest grid', async (client) => {
    await client.dispatch('setEditTarget', 'tileset');

    // Select tile at the edge of the grid
    await client.dispatch('selectTile', 7, 2);
    const col = await client.getStateSelector('selectedTileCol');
    const row = await client.getStateSelector('selectedTileRow');
    assertEqual(col, 7, 'Selected tile col = 7');
    assertEqual(row, 2, 'Selected tile row = 2');

    // Draw pixel and verify it's stored
    await client.dispatch('pushHistory');
    await client.dispatch('setPixel', 5, 5, [42, 42, 42, 255]);
    const pixels = (await client.getStateSelector('pixels')) as Record<string, number>;
    const idx = (5 * 16 + 5) * 4;
    assertEqual(pixels[idx], 42, 'Pixel at (5,5) in tile (7,2)');

    // Switch to different tile and back — verify persistence
    await client.dispatch('selectTile', 0, 0);
    await client.dispatch('selectTile', 7, 2);
    const pixelsBack = (await client.getStateSelector('pixels')) as Record<string, number>;
    assertEqual(pixelsBack[idx], 42, 'Pixel at (5,5) in tile (7,2) persists after round-trip');

    // Reset back to (0,0)
    await client.dispatch('selectTile', 0, 0);
  });

  // -----------------------------------------------------------------------
  // Scenario: Spritesheet frame selection with manifest row metadata
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Spritesheet frames use manifest row count', async (client) => {
    await client.dispatch('setEditTarget', 'spritesheet');

    // Select row 11 (last row in 12-row manifest)
    await client.dispatch('selectFrame', 3, 11);
    const col = await client.getStateSelector('selectedFrameCol');
    const row = await client.getStateSelector('selectedFrameRow');
    assertEqual(col, 3, 'Selected frame col = 3');
    assertEqual(row, 11, 'Selected frame row = 11');

    // Draw and verify
    await client.dispatch('pushHistory');
    await client.dispatch('setPixel', 8, 8, [77, 77, 77, 255]);
    const pixels = (await client.getStateSelector('pixels')) as Record<string, number>;
    const idx = (8 * 16 + 8) * 4;
    assertEqual(pixels[idx], 77, 'Pixel in last sprite row');

    // Switch back
    await client.dispatch('setEditTarget', 'tileset');
    await client.dispatch('selectTile', 0, 0);
  });
}
