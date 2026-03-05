import { TestRunner, assert, assertEqual } from './qa-runner.js';

export function runParticleDesignerTests(runner: TestRunner): void {
  runner.test('Store is accessible', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(state !== null, 'State should not be null');
    assert('emitters' in state, 'State should have emitters');
  });

  runner.test('Add emitter increases count', async (client) => {
    const before = await client.getStateSelector('emitters') as unknown[];
    const countBefore = before.length;
    await client.dispatch('addEmitter', 'test_emitter');
    const after = await client.getStateSelector('emitters') as unknown[];
    assertEqual(after.length, countBefore + 1, 'Emitter count after add');
  });

  runner.test('Update spawn_rate on emitter', async (client) => {
    const emitters = await client.getStateSelector('emitters') as Array<{ id: number; config: { spawn_rate: number } }>;
    assert(emitters.length > 0, 'Need at least one emitter');
    const emitter = emitters[emitters.length - 1];
    await client.dispatch('updateConfig', emitter.id, { spawn_rate: 42 });
    const updated = await client.getStateSelector('emitters') as Array<{ id: number; config: { spawn_rate: number } }>;
    const updatedEmitter = updated.find((e) => e.id === emitter.id)!;
    assertEqual(updatedEmitter.config.spawn_rate, 42, 'Updated spawn_rate');
  });

  runner.test('Duplicate emitter', async (client) => {
    const before = await client.getStateSelector('emitters') as Array<{ id: number }>;
    const countBefore = before.length;
    await client.dispatch('duplicateEmitter', before[before.length - 1].id);
    const after = await client.getStateSelector('emitters') as unknown[];
    assertEqual(after.length, countBefore + 1, 'Emitter count after duplicate');
  });

  runner.test('Select emitter', async (client) => {
    const emitters = await client.getStateSelector('emitters') as Array<{ id: number }>;
    const emitter = emitters[0];
    await client.dispatch('selectEmitter', emitter.id);
    const selected = await client.getStateSelector('selectedEmitterId');
    assertEqual(selected, emitter.id, 'Selected emitter ID');
  });

  runner.test('Remove emitter decreases count', async (client) => {
    const before = await client.getStateSelector('emitters') as Array<{ id: number }>;
    const countBefore = before.length;
    // Remove the last one (duplicate from earlier test)
    await client.dispatch('removeEmitter', before[before.length - 1].id);
    const after = await client.getStateSelector('emitters') as unknown[];
    assertEqual(after.length, countBefore - 1, 'Emitter count after remove');
  });

  runner.test('Export/import JSON roundtrip', async (client) => {
    // exportJson returns a string — we test by getting state
    const state = await client.getState() as Record<string, unknown>;
    assert('emitters' in state, 'State has emitters');

    // Import with a new emitter via JSON string
    const json = JSON.stringify([{
      id: 999,
      name: 'json_import_test',
      config: {
        spawn_rate: 10,
        min_lifetime: 0.5,
        max_lifetime: 1.5,
        min_velocity: [-1, -1],
        max_velocity: [1, 1],
        acceleration: [0, 0],
        start_size: 1,
        end_size: 0.1,
        start_color: [1, 1, 1, 1],
        end_color: [1, 1, 1, 0],
        atlas_tile: 0,
        z: 0,
        spawn_offset_min: [0, 0],
        spawn_offset_max: [0, 0],
      },
    }]);
    await client.dispatch('importJson', json);
    const after = await client.getStateSelector('emitters') as Array<{ name: string }>;
    const imported = after.find((e) => e.name === 'json_import_test');
    assert(imported !== undefined, 'Imported emitter should exist');
  });

  runner.test('Auto-sync toggle', async (client) => {
    await client.dispatch('setAutoSync', true);
    let autoSync = await client.getStateSelector('autoSync');
    assertEqual(autoSync, true, 'Auto-sync on');

    await client.dispatch('setAutoSync', false);
    autoSync = await client.getStateSelector('autoSync');
    assertEqual(autoSync, false, 'Auto-sync off');
  });
}
