import { TestRunner, assert, assertEqual } from './qa-runner.js';

export function runPixelPainterTests(runner: TestRunner): void {
  runner.test('Store is accessible', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(state !== null, 'State should not be null');
    assert('pixels' in state, 'State should have pixels');
    assert('activeTool' in state, 'State should have activeTool');
  });

  runner.test('Set pixel updates canvas data', async (client) => {
    await client.dispatch('pushHistory');
    // Set pixel at (0,0) to red
    await client.dispatch('setPixel', 0, 0, [255, 0, 0, 255]);
    // Push again so undo has a "current" state to revert from
    await client.dispatch('pushHistory');
    const pixels = await client.getStateSelector('pixels') as Record<string, number>;
    // PixelData is a Uint8ClampedArray (16*16*4 = 1024 bytes), serialized as object
    // Pixel (0,0) starts at index 0: RGBA
    assertEqual(pixels[0], 255, 'Pixel R at (0,0)');
    assertEqual(pixels[1], 0, 'Pixel G at (0,0)');
    assertEqual(pixels[2], 0, 'Pixel B at (0,0)');
    assertEqual(pixels[3], 255, 'Pixel A at (0,0)');
  });

  runner.test('Color swap swaps fg/bg', async (client) => {
    const fgBefore = await client.getStateSelector('fgColor') as number[];
    const bgBefore = await client.getStateSelector('bgColor') as number[];
    await client.dispatch('swapColors');
    const fgAfter = await client.getStateSelector('fgColor') as number[];
    const bgAfter = await client.getStateSelector('bgColor') as number[];

    assertEqual(fgAfter[0], bgBefore[0], 'FG R after swap = BG R before');
    assertEqual(bgAfter[0], fgBefore[0], 'BG R after swap = FG R before');

    // Swap back
    await client.dispatch('swapColors');
  });

  runner.test('Mirror mode updates state', async (client) => {
    await client.dispatch('setMirrorMode', 'horizontal');
    let mode = await client.getStateSelector('mirrorMode');
    assertEqual(mode, 'horizontal', 'Mirror mode horizontal');

    await client.dispatch('setMirrorMode', 'vertical');
    mode = await client.getStateSelector('mirrorMode');
    assertEqual(mode, 'vertical', 'Mirror mode vertical');

    await client.dispatch('setMirrorMode', 'both');
    mode = await client.getStateSelector('mirrorMode');
    assertEqual(mode, 'both', 'Mirror mode both');

    await client.dispatch('setMirrorMode', 'none');
    mode = await client.getStateSelector('mirrorMode');
    assertEqual(mode, 'none', 'Mirror mode none');
  });

  runner.test('Undo restores pixel state', async (client) => {
    await client.dispatch('undo');
    const pixels = await client.getStateSelector('pixels') as Record<string, number>;
    // After undo, pixel (0,0) should be back to 0 (the default transparent)
    assertEqual(pixels[0], 0, 'Pixel R at (0,0) after undo');
  });

  runner.test('Redo restores edited pixel', async (client) => {
    await client.dispatch('redo');
    const pixels = await client.getStateSelector('pixels') as Record<string, number>;
    assertEqual(pixels[0], 255, 'Pixel R at (0,0) after redo');
  });

  runner.test('Tool selection works', async (client) => {
    const tools = ['pencil', 'eraser', 'line', 'rect', 'fill', 'eyedropper'] as const;
    for (const tool of tools) {
      await client.dispatch('setActiveTool', tool);
      const current = await client.getStateSelector('activeTool');
      assertEqual(current, tool, `Active tool: ${tool}`);
    }
  });

  runner.test('Edit target switching', async (client) => {
    await client.dispatch('setEditTarget', 'spritesheet');
    let target = await client.getStateSelector('editTarget');
    assertEqual(target, 'spritesheet', 'Edit target: spritesheet');

    await client.dispatch('setEditTarget', 'tileset');
    target = await client.getStateSelector('editTarget');
    assertEqual(target, 'tileset', 'Edit target: tileset');
  });

  runner.test('Zoom updates', async (client) => {
    await client.dispatch('setZoom', 8);
    const zoom = await client.getStateSelector('zoom');
    assertEqual(zoom, 8, 'Zoom value');
    await client.dispatch('setZoom', 1);
  });

  runner.test('Foreground color set', async (client) => {
    await client.dispatch('setFgColor', [0, 128, 255, 255]);
    const fg = await client.getStateSelector('fgColor') as number[];
    assertEqual(fg[0], 0, 'FG R');
    assertEqual(fg[1], 128, 'FG G');
    assertEqual(fg[2], 255, 'FG B');
  });
}
