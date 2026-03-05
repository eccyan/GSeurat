/**
 * Level Designer — Scenario Tests (multi-step workflows)
 */
import { TestRunner, assert, assertEqual } from './qa-runner.js';
import { assertStateHas, undoTimes, redoTimes } from './helpers.js';

export function runLevelDesignerScenarios(runner: TestRunner): void {
  // -----------------------------------------------------------------------
  // Scenario: Design a complete dungeon room
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Design a complete dungeon room', async (client) => {
    // 1. Resize tilemap to 12×12
    await client.dispatch('resizeTilemap', 12, 12, 0);
    await assertStateHas<number>(client, 'width', (w) => w === 12, 'Width should be 12');
    await assertStateHas<number>(client, 'height', (h) => h === 12, 'Height should be 12');

    // 2. Paint border walls (solid tiles) on all edges
    await client.dispatch('pushHistory');
    for (let col = 0; col < 12; col++) {
      await client.dispatch('setTile', col, 0, 1, true);   // top row
      await client.dispatch('setTile', col, 11, 1, true);  // bottom row
    }
    for (let row = 1; row < 11; row++) {
      await client.dispatch('setTile', 0, row, 1, true);   // left col
      await client.dispatch('setTile', 11, row, 1, true);  // right col
    }

    // 3. Paint floor tiles in interior
    await client.dispatch('pushHistory');
    for (let row = 1; row < 11; row++) {
      for (let col = 1; col < 11; col++) {
        await client.dispatch('setTile', col, row, 0, false);
      }
    }

    // 4. Add 2 lights (warm torches at corners)
    await client.dispatch('addLight', {
      position: [2, 2],
      radius: 4,
      color: [1, 0.8, 0.4],
      intensity: 1.2,
      height: 3,
    });
    await client.dispatch('addLight', {
      position: [9, 9],
      radius: 4,
      color: [1, 0.8, 0.4],
      intensity: 1.2,
      height: 3,
    });

    // 5. Add 1 NPC with position
    await client.dispatch('addNpc', {
      name: 'dungeon_guard',
      position: [5, 5, 0],
      tint: [1, 0.5, 0.5, 1],
      facing: 'south',
      patrol_speed: 2,
      patrol_interval: 3,
      dialog: [{ speaker_key: 'guard', text_key: 'guard_greeting' }],
      light_color: [1, 0.4, 0.4, 1],
      light_radius: 3,
      waypoints: [],
    });

    // 6. Add 1 portal (exit at bottom)
    await client.dispatch('addPortal', {
      position: [5, 11],
      size: [2, 1],
      target_scene: 'assets/scenes/test_scene.json',
      spawn_position: [5, 1, 0],
      spawn_facing: 'south',
    });

    // 7. Set ambient color (cool blue for dungeon)
    await client.dispatch('setAmbientColor', [0.2, 0.25, 0.5, 1.0]);

    // 8. Verify final state
    const tiles = (await client.getStateSelector('tiles')) as Array<{
      id: number;
      solid: boolean;
    }>;
    assertEqual(tiles.length, 144, 'Tile count should be 12×12=144');

    // Check a corner wall tile
    assertEqual(tiles[0].id, 1, 'Top-left tile is wall');
    assertEqual(tiles[0].solid, true, 'Top-left tile is solid');

    // Check an interior floor tile
    const interiorIdx = 1 * 12 + 1; // row=1, col=1
    assertEqual(tiles[interiorIdx].id, 0, 'Interior tile is floor');

    const lights = (await client.getStateSelector('lights')) as unknown[];
    assertEqual(lights.length, 2, 'Should have 2 lights');

    const npcs = (await client.getStateSelector('npcs')) as Array<{ name: string }>;
    assertEqual(npcs.length, 1, 'Should have 1 NPC');
    assertEqual(npcs[0].name, 'dungeon_guard', 'NPC name matches');

    const portals = (await client.getStateSelector('portals')) as Array<{ target_scene: string }>;
    assertEqual(portals.length, 1, 'Should have 1 portal');
    assertEqual(portals[0].target_scene, 'assets/scenes/test_scene.json', 'Portal target matches');

    const ambient = (await client.getStateSelector('ambientColor')) as number[];
    assertEqual(ambient[0], 0.2, 'Ambient R');
    assertEqual(ambient[2], 0.5, 'Ambient B');

    // 9. Undo tile painting (2 tile operations) — tiles revert, entities stay
    await undoTimes(client, 2);
    const tilesAfterUndo = (await client.getStateSelector('tiles')) as Array<{ id: number }>;
    // After undoing both tile operations, all tiles should be back to fill=0
    assertEqual(tilesAfterUndo[0].id, 0, 'Top-left tile reverted after undo');

    // Entities are not affected by tile undo
    const lightsStill = (await client.getStateSelector('lights')) as unknown[];
    assertEqual(lightsStill.length, 2, 'Lights preserved through tile undo');
    const npcsStill = (await client.getStateSelector('npcs')) as unknown[];
    assertEqual(npcsStill.length, 1, 'NPCs preserved through tile undo');

    // 10. Redo 2 times → verify tiles restored
    await redoTimes(client, 2);
    const tilesAfterRedo = (await client.getStateSelector('tiles')) as Array<{ id: number }>;
    assertEqual(tilesAfterRedo[0].id, 1, 'Top-left tile restored after redo');

    // Cleanup: remove added entities
    await client.dispatch('removePortal', 0);
    await client.dispatch('removeNpc', 0);
    await client.dispatch('removeLight', 1);
    await client.dispatch('removeLight', 0);
  });

  // -----------------------------------------------------------------------
  // Scenario: Undo/redo stress on tile operations
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Undo/redo stress on tile operations', async (client) => {
    // Start fresh with known dimensions
    await client.dispatch('resizeTilemap', 16, 16, 0);

    // Paint 5 tiles (push history before each batch)
    for (let i = 0; i < 5; i++) {
      await client.dispatch('pushHistory');
      await client.dispatch('setTile', i + 1, 1, 1, true);
    }

    // Verify tiles are set
    const width = (await client.getStateSelector('width')) as number;
    let tiles = (await client.getStateSelector('tiles')) as Array<{ id: number }>;
    for (let i = 0; i < 5; i++) {
      assertEqual(tiles[1 * width + (i + 1)].id, 1, `Tile (${i + 1},1) is wall`);
    }

    // Undo all 5 tile operations one by one, verify state at each step
    for (let step = 4; step >= 0; step--) {
      await client.dispatch('undo');
      tiles = (await client.getStateSelector('tiles')) as Array<{ id: number }>;
      // After undoing step N, tile (N+1,1) should be reverted to 0
      assertEqual(tiles[1 * width + (step + 1)].id, 0, `Tile (${step + 1},1) reverted at undo step ${4 - step}`);
    }

    // Redo all 5
    for (let step = 0; step < 5; step++) {
      await client.dispatch('redo');
      tiles = (await client.getStateSelector('tiles')) as Array<{ id: number }>;
      assertEqual(tiles[1 * width + (step + 1)].id, 1, `Tile (${step + 1},1) restored at redo step ${step}`);
    }

    // Also test entity CRUD independently (no undo/redo)
    // Add 3 lights, 2 NPCs, verify counts, then remove all
    for (let i = 0; i < 3; i++) {
      await client.dispatch('addLight', {
        position: [i + 2, 3],
        radius: 3,
        color: [1, 1, 1],
        intensity: 1,
        height: 2,
      });
    }
    for (let i = 0; i < 2; i++) {
      await client.dispatch('addNpc', {
        name: `stress_npc_${i}`,
        position: [i + 4, 5, 0],
        tint: [1, 1, 1, 1],
        facing: 'south',
        patrol_speed: 2,
        patrol_interval: 3,
        dialog: [],
        light_color: [1, 1, 1, 1],
        light_radius: 2,
        waypoints: [],
      });
    }

    const lights = (await client.getStateSelector('lights')) as unknown[];
    assertEqual(lights.length, 3, 'Should have 3 lights');
    const npcs = (await client.getStateSelector('npcs')) as unknown[];
    assertEqual(npcs.length, 2, 'Should have 2 NPCs');

    // Remove all in reverse order
    await client.dispatch('removeNpc', 1);
    await client.dispatch('removeNpc', 0);
    await client.dispatch('removeLight', 2);
    await client.dispatch('removeLight', 1);
    await client.dispatch('removeLight', 0);

    const lightsClean = (await client.getStateSelector('lights')) as unknown[];
    assertEqual(lightsClean.length, 0, 'All lights removed');
    const npcsClean = (await client.getStateSelector('npcs')) as unknown[];
    assertEqual(npcsClean.length, 0, 'All NPCs removed');
  });
}
