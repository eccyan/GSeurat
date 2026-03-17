/**
 * Map Painter — Scenario Tests (multi-step workflows)
 */
import { TestRunner, assert, assertEqual } from './qa-runner.js';
import { assertStateHas, undoTimes, redoTimes } from './helpers.js';

export function runMapPainterScenarios(runner: TestRunner): void {
  // -----------------------------------------------------------------------
  // Scenario: Create a simple village map with terrain, walls, and collision
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Create a village map with terrain and walls', async (client) => {
    // 1. Initialize a 16×16 map
    await client.dispatch('initMap', 16, 16);
    await assertStateHas<number>(client, 'width', w => w === 16, 'Width=16');
    await assertStateHas<number>(client, 'height', h => h === 16, 'Height=16');

    // 2. Paint grass ground layer across the whole map
    await client.dispatch('setActiveLayer', 'ground');
    await client.dispatch('pushUndo');
    await client.dispatch('fillArea', 0, 0, 76, 153, 76, 255); // grass green

    // Verify a sample ground pixel
    const layers1 = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    const midIdx = (8 * 16 + 8) * 4; // center pixel
    assertEqual(layers1.ground[midIdx], 76, 'Ground center pixel R=76 (grass)');
    assertEqual(layers1.ground[midIdx + 1], 153, 'Ground center pixel G=153');

    // 3. Paint stone walls on walls layer (border ring)
    await client.dispatch('setActiveLayer', 'walls');
    await client.dispatch('pushUndo');
    for (let x = 0; x < 16; x++) {
      await client.dispatch('setPixel', x, 0, 128, 128, 128, 255);   // top
      await client.dispatch('setPixel', x, 15, 128, 128, 128, 255);  // bottom
    }
    for (let y = 1; y < 15; y++) {
      await client.dispatch('setPixel', 0, y, 128, 128, 128, 255);   // left
      await client.dispatch('setPixel', 15, y, 128, 128, 128, 255);  // right
    }

    // Verify wall pixel
    const layers2 = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    assertEqual(layers2.walls[0], 128, 'Wall (0,0) R=128');
    assertEqual(layers2.walls[3], 255, 'Wall (0,0) A=255');

    // 4. Set heights: walls are 3 units tall, ground is 0
    await client.dispatch('pushUndo');
    for (let x = 0; x < 16; x++) {
      await client.dispatch('setHeight', x, 0, 3);
      await client.dispatch('setHeight', x, 15, 3);
    }
    for (let y = 1; y < 15; y++) {
      await client.dispatch('setHeight', 0, y, 3);
      await client.dispatch('setHeight', 15, y, 3);
    }

    // Verify heights
    const heights = await client.getStateSelector('heights') as Record<string, number>;
    assertEqual(heights[0], 3, 'Wall height (0,0)=3');
    assertEqual(heights[8 * 16 + 8], 0, 'Ground height (8,8)=0');

    // 5. Auto-generate collision from heights (threshold=1)
    await client.dispatch('autoGenerateCollision', 1);

    const grid = await client.getStateSelector('collisionGrid') as boolean[];
    assertEqual(grid[0], true, 'Wall (0,0) solid after auto-collision');
    assertEqual(grid[8 * 16 + 8], false, 'Ground (8,8) walkable after auto-collision');

    // 6. Add a water feature — paint blue on ground layer
    await client.dispatch('setActiveLayer', 'decorations');
    await client.dispatch('pushUndo');
    for (let y = 6; y <= 9; y++) {
      for (let x = 6; x <= 9; x++) {
        await client.dispatch('setPixel', x, y, 64, 128, 200, 255);
      }
    }

    // Verify water pixel (decorations layer)
    const layers3 = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    const waterIdx = (7 * 16 + 7) * 4;
    assertEqual(layers3.decorations[waterIdx], 64, 'Water R=64');
    assertEqual(layers3.decorations[waterIdx + 1], 128, 'Water G=128');
    assertEqual(layers3.decorations[waterIdx + 2], 200, 'Water B=200');

    // 7. Set camera for preview
    await client.dispatch('setPreviewCamera', {
      position: [0, 12, 20],
      target: [0, 0, 0],
      fov: 45,
    });

    const cam = await client.getStateSelector('previewCamera') as {
      position: number[]; target: number[]; fov: number;
    };
    assertEqual(cam.position[1], 12, 'Camera Y=12');
    assertEqual(cam.fov, 45, 'Camera FOV=45');

    // 8. Verify final state
    const finalWidth = await client.getStateSelector('width') as number;
    const finalHeight = await client.getStateSelector('height') as number;
    assertEqual(finalWidth, 16, 'Final width=16');
    assertEqual(finalHeight, 16, 'Final height=16');

    // 9. Undo water painting — decorations revert
    await undoTimes(client, 1);
    const layers4 = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    assertEqual(layers4.decorations[waterIdx], 0, 'Water gone after undo');

    // 10. Redo — water comes back
    await redoTimes(client, 1);
    const layers5 = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    assertEqual(layers5.decorations[waterIdx], 64, 'Water restored after redo');
  });

  // -----------------------------------------------------------------------
  // Scenario: Undo/redo stress across multiple layers and tools
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Undo/redo across layers and tools', async (client) => {
    await client.dispatch('initMap', 8, 8);

    // Paint 3 operations on different layers
    await client.dispatch('setActiveLayer', 'ground');
    await client.dispatch('pushUndo');
    await client.dispatch('setPixel', 0, 0, 255, 0, 0, 255);

    await client.dispatch('setActiveLayer', 'walls');
    await client.dispatch('pushUndo');
    await client.dispatch('setPixel', 1, 1, 0, 255, 0, 255);

    await client.dispatch('pushUndo');
    await client.dispatch('setHeight', 2, 2, 10);

    // Verify all 3 operations
    let layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    let heights = await client.getStateSelector('heights') as Record<string, number>;
    assertEqual(layers.ground[0], 255, 'Ground pixel set');
    assertEqual(layers.walls[(1 * 8 + 1) * 4 + 1], 255, 'Walls pixel set');
    assertEqual(heights[2 * 8 + 2], 10, 'Height set');

    // Undo all 3
    await undoTimes(client, 3);

    // Everything should be reverted
    layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    heights = await client.getStateSelector('heights') as Record<string, number>;
    assertEqual(layers.ground[0], 0, 'Ground pixel reverted');
    assertEqual(layers.walls[(1 * 8 + 1) * 4 + 1], 0, 'Walls pixel reverted');
    assertEqual(heights[2 * 8 + 2], 0, 'Height reverted');

    // Redo all 3
    await redoTimes(client, 3);
    layers = await client.getStateSelector('layers') as Record<string, Record<string, number>>;
    heights = await client.getStateSelector('heights') as Record<string, number>;
    assertEqual(layers.ground[0], 255, 'Ground pixel restored');
    assertEqual(heights[2 * 8 + 2], 10, 'Height restored');
  });

  // -----------------------------------------------------------------------
  // Scenario: Collision grid manual refinement after auto-generation
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Manual collision refinement', async (client) => {
    await client.dispatch('initMap', 4, 4);

    // Set all heights to 5 (everything solid)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        await client.dispatch('setHeight', x, y, 5);
      }
    }

    // Auto-generate collision (all should be solid)
    await client.dispatch('autoGenerateCollision', 1);
    let grid = await client.getStateSelector('collisionGrid') as boolean[];
    for (let i = 0; i < 16; i++) {
      assertEqual(grid[i], true, `Cell ${i} should be solid after auto-gen`);
    }

    // Manually clear a path (row 2, all columns)
    for (let x = 0; x < 4; x++) {
      await client.dispatch('toggleCollision', x, 2);
    }

    grid = await client.getStateSelector('collisionGrid') as boolean[];
    assertEqual(grid[2 * 4 + 0], false, 'Path cell (0,2) cleared');
    assertEqual(grid[2 * 4 + 1], false, 'Path cell (1,2) cleared');
    assertEqual(grid[2 * 4 + 2], false, 'Path cell (2,2) cleared');
    assertEqual(grid[2 * 4 + 3], false, 'Path cell (3,2) cleared');

    // Other rows still solid
    assertEqual(grid[0 * 4 + 0], true, 'Row 0 still solid');
    assertEqual(grid[1 * 4 + 0], true, 'Row 1 still solid');
    assertEqual(grid[3 * 4 + 0], true, 'Row 3 still solid');
  });
}
