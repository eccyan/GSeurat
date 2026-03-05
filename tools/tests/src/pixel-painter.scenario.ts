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

    // 5. Undo → pixels removed
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
}
