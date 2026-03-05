/**
 * Audio Composer — Scenario Tests (multi-step workflows)
 */
import { TestRunner, assert, assertEqual } from './qa-runner.js';
import { assertStateHas } from './helpers.js';

interface Layer {
  id: string;
  volume: number;
  muted: boolean;
  soloed: boolean;
}

export function runAudioComposerScenarios(runner: TestRunner): void {
  // -----------------------------------------------------------------------
  // Scenario: Compose layered music with state transitions
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Compose layered music with state transitions', async (client) => {
    // 1. Set BPM=120
    await client.dispatch('setBpm', 120);
    await assertStateHas<number>(client, 'bpm', (v) => v === 120, 'BPM should be 120');

    // 2. Set layer volumes: bass=0.8, harmony=0.5, melody=0.0, percussion=0.3
    await client.dispatch('setLayerVolume', 'bass', 0.8);
    await client.dispatch('setLayerVolume', 'harmony', 0.5);
    await client.dispatch('setLayerVolume', 'melody', 0.0);
    await client.dispatch('setLayerVolume', 'percussion', 0.3);

    let layers = (await client.getStateSelector('layers')) as Layer[];
    assertEqual(layers.find((l) => l.id === 'bass')!.volume, 0.8, 'Bass volume 0.8');
    assertEqual(layers.find((l) => l.id === 'harmony')!.volume, 0.5, 'Harmony volume 0.5');
    assertEqual(layers.find((l) => l.id === 'melody')!.volume, 0.0, 'Melody volume 0.0');
    assertEqual(layers.find((l) => l.id === 'percussion')!.volume, 0.3, 'Percussion volume 0.3');

    // 3. Mute percussion
    await client.dispatch('setLayerMuted', 'percussion', true);
    layers = (await client.getStateSelector('layers')) as Layer[];
    assertEqual(layers.find((l) => l.id === 'percussion')!.muted, true, 'Percussion muted');

    // 4. Solo bass → verify only bass is soloed
    await client.dispatch('setLayerSoloed', 'bass', true);
    layers = (await client.getStateSelector('layers')) as Layer[];
    assertEqual(layers.find((l) => l.id === 'bass')!.soloed, true, 'Bass soloed');
    assertEqual(layers.find((l) => l.id === 'harmony')!.soloed, false, 'Harmony not soloed');
    assertEqual(layers.find((l) => l.id === 'melody')!.soloed, false, 'Melody not soloed');

    // 5. Unsolo → verify layers restore
    await client.dispatch('setLayerSoloed', 'bass', false);
    layers = (await client.getStateSelector('layers')) as Layer[];
    assertEqual(layers.find((l) => l.id === 'bass')!.soloed, false, 'Bass unsoloed');

    // 6. Set loop region 0-16s, enable loop
    await client.dispatch('setLoopRegion', { startSec: 0, endSec: 16 });
    await client.dispatch('setLoopEnabled', true);
    const region = (await client.getStateSelector('loopRegion')) as { startSec: number; endSec: number };
    assertEqual(region.startSec, 0, 'Loop start=0');
    assertEqual(region.endSec, 16, 'Loop end=16');
    await assertStateHas<boolean>(client, 'loopEnabled', (v) => v === true, 'Loop enabled');

    // 7. Activate "NearNPC" preset → verify layer targets changed
    await client.dispatch('setActiveMusicState', 'NearNPC');
    await assertStateHas<string>(
      client,
      'activeMusicState',
      (v) => v === 'NearNPC',
      'Active state should be NearNPC',
    );

    // 8. Switch to "Dialog" preset
    await client.dispatch('setActiveMusicState', 'Dialog');
    await assertStateHas<string>(
      client,
      'activeMusicState',
      (v) => v === 'Dialog',
      'Active state should be Dialog',
    );

    // 9. Set master volume to 0.5
    await client.dispatch('setMasterVolume', 0.5);
    await assertStateHas<number>(
      client,
      'masterVolume',
      (v) => v === 0.5,
      'Master volume should be 0.5',
    );

    // 10. Verify all state correct
    const bpm = await client.getStateSelector('bpm');
    assertEqual(bpm, 120, 'Final BPM check');
    const loopEnabled = await client.getStateSelector('loopEnabled');
    assertEqual(loopEnabled, true, 'Final loop enabled check');
    const masterVol = await client.getStateSelector('masterVolume');
    assertEqual(masterVol, 0.5, 'Final master volume check');
    const activeState = await client.getStateSelector('activeMusicState');
    assertEqual(activeState, 'Dialog', 'Final active state check');

    // Restore defaults
    await client.dispatch('setActiveMusicState', null);
    await client.dispatch('setMasterVolume', 1.0);
    await client.dispatch('setLoopEnabled', false);
    await client.dispatch('setLayerMuted', 'percussion', false);
    await client.dispatch('setLayerVolume', 'bass', 0.8);
    await client.dispatch('setLayerVolume', 'harmony', 0.5);
    await client.dispatch('setLayerVolume', 'melody', 0.0);
    await client.dispatch('setLayerVolume', 'percussion', 0.3);
  });

  // -----------------------------------------------------------------------
  // Scenario: Full music editing session
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Full music editing session', async (client) => {
    // 1. Set BPM, crossfade rate=5
    await client.dispatch('setBpm', 100);
    await client.dispatch('setCrossfadeRate', 5);
    assertEqual(await client.getStateSelector('bpm'), 100, 'BPM=100');
    assertEqual(await client.getStateSelector('crossfadeRate'), 5, 'Crossfade rate=5');

    // 2. Adjust all 4 layers independently
    await client.dispatch('setLayerVolume', 'bass', 0.9);
    await client.dispatch('setLayerVolume', 'harmony', 0.6);
    await client.dispatch('setLayerVolume', 'melody', 0.4);
    await client.dispatch('setLayerVolume', 'percussion', 0.7);

    let layers = (await client.getStateSelector('layers')) as Layer[];
    assertEqual(layers.find((l) => l.id === 'bass')!.volume, 0.9, 'Bass=0.9');
    assertEqual(layers.find((l) => l.id === 'melody')!.volume, 0.4, 'Melody=0.4');

    // 3. Toggle mute on 2 layers
    await client.dispatch('setLayerMuted', 'harmony', true);
    await client.dispatch('setLayerMuted', 'percussion', true);
    layers = (await client.getStateSelector('layers')) as Layer[];
    assertEqual(layers.find((l) => l.id === 'harmony')!.muted, true, 'Harmony muted');
    assertEqual(layers.find((l) => l.id === 'percussion')!.muted, true, 'Percussion muted');

    // 4. Set loop region, enable/disable
    await client.dispatch('setLoopRegion', { startSec: 4, endSec: 12 });
    await client.dispatch('setLoopEnabled', true);
    assertEqual(await client.getStateSelector('loopEnabled'), true, 'Loop on');

    await client.dispatch('setLoopEnabled', false);
    assertEqual(await client.getStateSelector('loopEnabled'), false, 'Loop off');

    // 5. Cycle through all 3 presets
    for (const preset of ['Explore', 'NearNPC', 'Dialog']) {
      await client.dispatch('setActiveMusicState', preset);
      const active = await client.getStateSelector('activeMusicState');
      assertEqual(active, preset, `Preset cycle: ${preset}`);
    }

    // 6. End: verify all values persisted correctly
    layers = (await client.getStateSelector('layers')) as Layer[];
    assertEqual(layers.find((l) => l.id === 'bass')!.volume, 0.9, 'Bass volume persisted');
    assertEqual(layers.find((l) => l.id === 'harmony')!.muted, true, 'Harmony mute persisted');
    assertEqual(layers.find((l) => l.id === 'percussion')!.muted, true, 'Perc mute persisted');
    assertEqual(await client.getStateSelector('crossfadeRate'), 5, 'Crossfade rate persisted');

    // Restore
    await client.dispatch('setActiveMusicState', null);
    await client.dispatch('setBpm', 120);
    await client.dispatch('setCrossfadeRate', 3);
    await client.dispatch('setLayerMuted', 'harmony', false);
    await client.dispatch('setLayerMuted', 'percussion', false);
    await client.dispatch('setLayerVolume', 'bass', 0.8);
    await client.dispatch('setLayerVolume', 'harmony', 0.5);
    await client.dispatch('setLayerVolume', 'melody', 0.0);
    await client.dispatch('setLayerVolume', 'percussion', 0.3);
  });
}
