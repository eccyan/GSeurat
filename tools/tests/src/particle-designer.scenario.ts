/**
 * Particle Designer — Scenario Tests (multi-step workflows)
 */
import { TestRunner, assert, assertEqual } from './qa-runner.js';
import { assertStateHas } from './helpers.js';

interface EmitterConfig {
  spawn_rate: number;
  min_lifetime: number;
  max_lifetime: number;
  min_velocity: [number, number];
  max_velocity: [number, number];
  acceleration: [number, number];
  start_size: number;
  end_size: number;
  start_color: [number, number, number, number];
  end_color: [number, number, number, number];
  atlas_tile: number;
  z: number;
  spawn_offset_min: [number, number];
  spawn_offset_max: [number, number];
}

interface Emitter {
  id: number;
  name: string;
  config: EmitterConfig;
}

export function runParticleDesignerScenarios(runner: TestRunner): void {
  // -----------------------------------------------------------------------
  // Scenario: Design particle effect suite
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Design particle effect suite', async (client) => {
    // Track initial emitter count to restore later
    const initial = (await client.getStateSelector('emitters')) as Emitter[];
    const initialCount = initial.length;

    // 1. Add 3 emitters: fire, dust, sparkle
    await client.dispatch('addEmitter', 'fire');
    await client.dispatch('addEmitter', 'dust');
    await client.dispatch('addEmitter', 'sparkle');

    let emitters = (await client.getStateSelector('emitters')) as Emitter[];
    assertEqual(emitters.length, initialCount + 3, 'Should have 3 new emitters');

    // 2. Configure fire: spawn_rate=50, color start=orange, end=red, atlas_tile=1
    const fire = emitters.find((e) => e.name === 'fire')!;
    await client.dispatch('updateConfig', fire.id, {
      spawn_rate: 50,
      start_color: [1, 0.6, 0, 1],
      end_color: [1, 0, 0, 0.5],
      atlas_tile: 1,
    });

    // 3. Configure dust: spawn_rate=10, color start=brown, end=transparent
    const dust = emitters.find((e) => e.name === 'dust')!;
    await client.dispatch('updateConfig', dust.id, {
      spawn_rate: 10,
      start_color: [0.6, 0.4, 0.2, 0.8],
      end_color: [0.6, 0.4, 0.2, 0],
    });

    // 4. Configure sparkle: spawn_rate=30, color start=white, end=yellow
    const sparkle = emitters.find((e) => e.name === 'sparkle')!;
    await client.dispatch('updateConfig', sparkle.id, {
      spawn_rate: 30,
      start_color: [1, 1, 1, 1],
      end_color: [1, 1, 0, 0.5],
    });

    // 5. Duplicate fire → rename as "fire_blue" variant
    await client.dispatch('duplicateEmitter', fire.id);
    emitters = (await client.getStateSelector('emitters')) as Emitter[];
    assertEqual(emitters.length, initialCount + 4, 'Should have 4 new emitters after duplicate');

    // The duplicate is the last emitter — update its color to blue
    const fireBlue = emitters[emitters.length - 1];
    await client.dispatch('updateConfig', fireBlue.id, {
      start_color: [0, 0.4, 1, 1],
      end_color: [0, 0, 1, 0.5],
    });

    // 6. Verify 4 emitters total (beyond initial)
    emitters = (await client.getStateSelector('emitters')) as Emitter[];
    assertEqual(emitters.length, initialCount + 4, '4 new emitters total');

    // Verify fire config
    const fireUpdated = emitters.find((e) => e.id === fire.id)!;
    assertEqual(fireUpdated.config.spawn_rate, 50, 'Fire spawn_rate=50');
    assertEqual(fireUpdated.config.atlas_tile, 1, 'Fire atlas_tile=1');

    // 7. Export JSON → clear all → import JSON → verify 4 emitters restored
    const exportState = (await client.getState()) as { emitters: Emitter[] };
    const exportedEmitters = exportState.emitters;

    // Remove all added emitters
    for (let i = emitters.length - 1; i >= initialCount; i--) {
      await client.dispatch('removeEmitter', emitters[i].id);
    }
    emitters = (await client.getStateSelector('emitters')) as Emitter[];
    assertEqual(emitters.length, initialCount, 'All new emitters removed');

    // Import them back
    const jsonStr = JSON.stringify(exportedEmitters.slice(initialCount));
    await client.dispatch('importJson', jsonStr);

    emitters = (await client.getStateSelector('emitters')) as Emitter[];
    assert(emitters.length >= initialCount + 4, 'Emitters restored after import');

    // Cleanup
    const finalEmitters = (await client.getStateSelector('emitters')) as Emitter[];
    for (let i = finalEmitters.length - 1; i >= initialCount; i--) {
      await client.dispatch('removeEmitter', finalEmitters[i].id);
    }
  });

  // -----------------------------------------------------------------------
  // Scenario: Preset application and override
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Preset application and override', async (client) => {
    const initial = (await client.getStateSelector('emitters')) as Emitter[];
    const initialCount = initial.length;

    // 1. Add emitter
    await client.dispatch('addEmitter', 'preset_test');
    let emitters = (await client.getStateSelector('emitters')) as Emitter[];
    const emitter = emitters.find((e) => e.name === 'preset_test')!;

    // 2. Apply preset-like config values
    await client.dispatch('updateConfig', emitter.id, {
      spawn_rate: 40,
      min_lifetime: 0.5,
      max_lifetime: 2.0,
      start_size: 1.5,
      end_size: 0.1,
      start_color: [1, 0.8, 0, 1],
      end_color: [1, 0, 0, 0],
    });

    // 3. Override spawn_rate
    await client.dispatch('updateConfig', emitter.id, { spawn_rate: 100 });
    emitters = (await client.getStateSelector('emitters')) as Emitter[];
    const updated = emitters.find((e) => e.id === emitter.id)!;
    assertEqual(updated.config.spawn_rate, 100, 'Overridden spawn_rate=100');
    // Other values should remain from preset
    assertEqual(updated.config.start_size, 1.5, 'start_size preserved from preset');

    // 4. Duplicate → verify duplicate has overridden value
    await client.dispatch('duplicateEmitter', emitter.id);
    emitters = (await client.getStateSelector('emitters')) as Emitter[];
    const duplicate = emitters[emitters.length - 1];
    assertEqual(duplicate.config.spawn_rate, 100, 'Duplicate has overridden spawn_rate');
    assertEqual(duplicate.config.start_size, 1.5, 'Duplicate has preset start_size');

    // 5. Remove original, verify duplicate survives
    await client.dispatch('removeEmitter', emitter.id);
    emitters = (await client.getStateSelector('emitters')) as Emitter[];
    const dupeStillExists = emitters.find((e) => e.id === duplicate.id);
    assert(dupeStillExists !== undefined, 'Duplicate should survive original removal');
    assertEqual(dupeStillExists!.config.spawn_rate, 100, 'Duplicate spawn_rate intact');

    // Cleanup
    await client.dispatch('removeEmitter', duplicate.id);
  });
}
