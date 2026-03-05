import { TestRunner, assert, assertEqual } from './qa-runner.js';

export function runLevelDesignerTests(runner: TestRunner): void {
  runner.test('Store is accessible', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(state !== null, 'State should not be null');
    assert('width' in state, 'State should have width');
    assert('height' in state, 'State should have height');
    assert('tiles' in state, 'State should have tiles');
  });

  runner.test('Paint tile updates store', async (client) => {
    // Push history first for undo test later
    await client.dispatch('pushHistory');
    await client.dispatch('setTile', 2, 2, 1, true);
    const tiles = await client.getStateSelector('tiles') as Array<{ id: number; solid: boolean }>;
    const width = await client.getStateSelector('width') as number;
    const idx = 2 * width + 2;
    assertEqual(tiles[idx].id, 1, 'Tile ID at (2,2)');
    assertEqual(tiles[idx].solid, true, 'Tile solid at (2,2)');
  });

  runner.test('Add light updates store', async (client) => {
    const before = await client.getStateSelector('lights') as unknown[];
    const countBefore = before.length;
    await client.dispatch('addLight', {
      position: [3, 3],
      radius: 4,
      color: [1, 0.8, 0.4],
      intensity: 1.2,
      height: 3,
    });
    const after = await client.getStateSelector('lights') as unknown[];
    assertEqual(after.length, countBefore + 1, 'Light count after add');
  });

  runner.test('Update light updates store', async (client) => {
    const lights = await client.getStateSelector('lights') as Array<{ radius: number }>;
    if (lights.length > 0) {
      await client.dispatch('updateLight', 0, { radius: 6 });
      const updated = await client.getStateSelector('lights') as Array<{ radius: number }>;
      assertEqual(updated[0].radius, 6, 'Updated light radius');
    }
  });

  runner.test('Remove light updates store', async (client) => {
    const before = await client.getStateSelector('lights') as unknown[];
    if (before.length > 0) {
      const countBefore = before.length;
      await client.dispatch('removeLight', 0);
      const after = await client.getStateSelector('lights') as unknown[];
      assertEqual(after.length, countBefore - 1, 'Light count after remove');
    }
  });

  runner.test('Undo restores tile state', async (client) => {
    await client.dispatch('undo');
    const tiles = await client.getStateSelector('tiles') as Array<{ id: number }>;
    const width = await client.getStateSelector('width') as number;
    const idx = 2 * width + 2;
    // After undo, tile (2,2) should be back to 0 (the default)
    assertEqual(tiles[idx].id, 0, 'Tile ID after undo');
  });

  runner.test('Redo restores edited state', async (client) => {
    await client.dispatch('redo');
    const tiles = await client.getStateSelector('tiles') as Array<{ id: number }>;
    const width = await client.getStateSelector('width') as number;
    const idx = 2 * width + 2;
    assertEqual(tiles[idx].id, 1, 'Tile ID after redo');
  });

  runner.test('Resize tilemap updates dimensions', async (client) => {
    await client.dispatch('resizeTilemap', 20, 20, 0);
    const width = await client.getStateSelector('width') as number;
    const height = await client.getStateSelector('height') as number;
    assertEqual(width, 20, 'Width after resize');
    assertEqual(height, 20, 'Height after resize');
  });

  runner.test('Layer switching updates activeLayer', async (client) => {
    await client.dispatch('setActiveLayer', 'lights');
    const layer = await client.getStateSelector('activeLayer');
    assertEqual(layer, 'lights', 'Active layer');
    // Restore
    await client.dispatch('setActiveLayer', 'tiles');
  });

  runner.test('Set ambient color updates store', async (client) => {
    await client.dispatch('setAmbientColor', [0.5, 0.6, 0.7, 1.0]);
    const color = await client.getStateSelector('ambientColor') as number[];
    assertEqual(color[0], 0.5, 'Ambient R');
    assertEqual(color[1], 0.6, 'Ambient G');
    assertEqual(color[2], 0.7, 'Ambient B');
  });

  runner.test('Tool selection works', async (client) => {
    await client.dispatch('setActiveTool', 'fill');
    const tool = await client.getStateSelector('activeTool');
    assertEqual(tool, 'fill', 'Active tool');
    await client.dispatch('setActiveTool', 'paint');
  });
}
