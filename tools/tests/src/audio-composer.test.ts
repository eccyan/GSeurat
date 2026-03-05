import { TestRunner, assert, assertEqual } from './qa-runner.js';

export function runAudioComposerTests(runner: TestRunner): void {
  runner.test('Store is accessible', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(state !== null, 'State should not be null');
    assert('bpm' in state, 'State should have bpm');
    assert('layers' in state, 'State should have layers');
    assert('musicStates' in state, 'State should have musicStates');
  });

  runner.test('Set BPM updates value', async (client) => {
    await client.dispatch('setBpm', 140);
    const bpm = await client.getStateSelector('bpm');
    assertEqual(bpm, 140, 'BPM value');
    await client.dispatch('setBpm', 120); // restore
  });

  runner.test('Layer volume update', async (client) => {
    await client.dispatch('setLayerVolume', 'bass', 0.5);
    const layers = await client.getStateSelector('layers') as Array<{ id: string; volume: number }>;
    const bass = layers.find((l) => l.id === 'bass');
    assert(bass !== undefined, 'Bass layer should exist');
    assertEqual(bass!.volume, 0.5, 'Bass volume');
    await client.dispatch('setLayerVolume', 'bass', 0.8); // restore
  });

  runner.test('Layer mute toggle', async (client) => {
    await client.dispatch('setLayerMuted', 'melody', true);
    let layers = await client.getStateSelector('layers') as Array<{ id: string; muted: boolean }>;
    let melody = layers.find((l) => l.id === 'melody')!;
    assertEqual(melody.muted, true, 'Melody muted');

    await client.dispatch('setLayerMuted', 'melody', false);
    layers = await client.getStateSelector('layers') as Array<{ id: string; muted: boolean }>;
    melody = layers.find((l) => l.id === 'melody')!;
    assertEqual(melody.muted, false, 'Melody unmuted');
  });

  runner.test('Layer solo toggle', async (client) => {
    await client.dispatch('setLayerSoloed', 'percussion', true);
    let layers = await client.getStateSelector('layers') as Array<{ id: string; soloed: boolean }>;
    let perc = layers.find((l) => l.id === 'percussion')!;
    assertEqual(perc.soloed, true, 'Percussion soloed');

    await client.dispatch('setLayerSoloed', 'percussion', false);
    layers = await client.getStateSelector('layers') as Array<{ id: string; soloed: boolean }>;
    perc = layers.find((l) => l.id === 'percussion')!;
    assertEqual(perc.soloed, false, 'Percussion unsoloed');
  });

  runner.test('Music state preset activation', async (client) => {
    await client.dispatch('setActiveMusicState', 'Explore');
    let active = await client.getStateSelector('activeMusicState');
    assertEqual(active, 'Explore', 'Active music state: Explore');

    await client.dispatch('setActiveMusicState', 'NearNPC');
    active = await client.getStateSelector('activeMusicState');
    assertEqual(active, 'NearNPC', 'Active music state: NearNPC');

    await client.dispatch('setActiveMusicState', 'Dialog');
    active = await client.getStateSelector('activeMusicState');
    assertEqual(active, 'Dialog', 'Active music state: Dialog');

    await client.dispatch('setActiveMusicState', null);
  });

  runner.test('Loop region set', async (client) => {
    await client.dispatch('setLoopRegion', { startSec: 2.0, endSec: 8.0 });
    const region = await client.getStateSelector('loopRegion') as { startSec: number; endSec: number };
    assertEqual(region.startSec, 2.0, 'Loop start');
    assertEqual(region.endSec, 8.0, 'Loop end');
  });

  runner.test('Loop enable/disable', async (client) => {
    await client.dispatch('setLoopEnabled', true);
    let enabled = await client.getStateSelector('loopEnabled');
    assertEqual(enabled, true, 'Loop enabled');

    await client.dispatch('setLoopEnabled', false);
    enabled = await client.getStateSelector('loopEnabled');
    assertEqual(enabled, false, 'Loop disabled');
  });

  runner.test('Master volume', async (client) => {
    await client.dispatch('setMasterVolume', 0.75);
    const vol = await client.getStateSelector('masterVolume');
    assertEqual(vol, 0.75, 'Master volume');
    await client.dispatch('setMasterVolume', 1.0);
  });

  runner.test('Crossfade rate', async (client) => {
    await client.dispatch('setCrossfadeRate', 5.0);
    const rate = await client.getStateSelector('crossfadeRate');
    assertEqual(rate, 5.0, 'Crossfade rate');
    await client.dispatch('setCrossfadeRate', 3.0);
  });

  runner.test('Play/stop state', async (client) => {
    await client.dispatch('setPlaying', true);
    let playing = await client.getStateSelector('isPlaying');
    assertEqual(playing, true, 'Is playing');

    await client.dispatch('setPlaying', false);
    playing = await client.getStateSelector('isPlaying');
    assertEqual(playing, false, 'Is stopped');
  });
}
