import { TestRunner, assert, assertEqual } from './qa-runner.js';

export function runSfxDesignerTests(runner: TestRunner): void {
  runner.test('Store is accessible', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(state !== null, 'State should not be null');
    assert('oscillators' in state, 'State should have oscillators');
    assert('envelope' in state, 'State should have envelope');
    assert('filters' in state, 'State should have filters');
  });

  runner.test('Add oscillator increases count', async (client) => {
    const before = await client.getStateSelector('oscillators') as unknown[];
    const countBefore = before.length;
    await client.dispatch('addOscillator');
    const after = await client.getStateSelector('oscillators') as unknown[];
    assertEqual(after.length, countBefore + 1, 'Oscillator count after add');
  });

  runner.test('Set waveform on oscillator', async (client) => {
    const oscillators = await client.getStateSelector('oscillators') as Array<{ id: string; waveform: string }>;
    assert(oscillators.length > 0, 'Need at least one oscillator');
    const osc = oscillators[oscillators.length - 1];
    await client.dispatch('updateOscillator', osc.id, { waveform: 'sawtooth' });
    const updated = await client.getStateSelector('oscillators') as Array<{ id: string; waveform: string }>;
    const updatedOsc = updated.find((o) => o.id === osc.id)!;
    assertEqual(updatedOsc.waveform, 'sawtooth', 'Waveform updated');
  });

  runner.test('Update oscillator frequency', async (client) => {
    const oscillators = await client.getStateSelector('oscillators') as Array<{ id: string; frequency: number }>;
    const osc = oscillators[0];
    await client.dispatch('updateOscillator', osc.id, { frequency: 880 });
    const updated = await client.getStateSelector('oscillators') as Array<{ id: string; frequency: number }>;
    const updatedOsc = updated.find((o) => o.id === osc.id)!;
    assertEqual(updatedOsc.frequency, 880, 'Frequency updated');
  });

  runner.test('Remove oscillator decreases count', async (client) => {
    const before = await client.getStateSelector('oscillators') as Array<{ id: string }>;
    const countBefore = before.length;
    assert(countBefore >= 2, 'Need >= 2 oscillators to test removal');
    await client.dispatch('removeOscillator', before[before.length - 1].id);
    const after = await client.getStateSelector('oscillators') as unknown[];
    assertEqual(after.length, countBefore - 1, 'Oscillator count after remove');
  });

  runner.test('ADSR envelope update', async (client) => {
    await client.dispatch('setEnvelope', { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.3 });
    const env = await client.getStateSelector('envelope') as {
      attack: number; decay: number; sustain: number; release: number;
    };
    assertEqual(env.attack, 0.1, 'Attack');
    assertEqual(env.decay, 0.2, 'Decay');
    assertEqual(env.sustain, 0.7, 'Sustain');
    assertEqual(env.release, 0.3, 'Release');
  });

  runner.test('Add filter increases chain', async (client) => {
    const before = await client.getStateSelector('filters') as unknown[];
    const countBefore = before.length;
    await client.dispatch('addFilter');
    const after = await client.getStateSelector('filters') as unknown[];
    assertEqual(after.length, countBefore + 1, 'Filter count after add');
  });

  runner.test('Update filter type', async (client) => {
    const filters = await client.getStateSelector('filters') as Array<{ id: string; type: string }>;
    assert(filters.length > 0, 'Need at least one filter');
    const filter = filters[filters.length - 1];
    await client.dispatch('updateFilter', filter.id, { type: 'highpass' });
    const updated = await client.getStateSelector('filters') as Array<{ id: string; type: string }>;
    const updatedFilter = updated.find((f) => f.id === filter.id)!;
    assertEqual(updatedFilter.type, 'highpass', 'Filter type updated');
  });

  runner.test('Remove filter decreases chain', async (client) => {
    const before = await client.getStateSelector('filters') as Array<{ id: string }>;
    const countBefore = before.length;
    await client.dispatch('removeFilter', before[before.length - 1].id);
    const after = await client.getStateSelector('filters') as unknown[];
    assertEqual(after.length, countBefore - 1, 'Filter count after remove');
  });

  runner.test('Reverb effect toggle', async (client) => {
    await client.dispatch('setReverb', { enabled: true, roomSize: 0.8 });
    let reverb = await client.getStateSelector('reverb') as { enabled: boolean; roomSize: number };
    assertEqual(reverb.enabled, true, 'Reverb enabled');
    assertEqual(reverb.roomSize, 0.8, 'Reverb room size');

    await client.dispatch('setReverb', { enabled: false });
    reverb = await client.getStateSelector('reverb') as { enabled: boolean };
    assertEqual(reverb.enabled, false, 'Reverb disabled');
  });

  runner.test('Delay effect toggle', async (client) => {
    await client.dispatch('setDelay', { enabled: true, time: 0.3, feedback: 0.5 });
    let delay = await client.getStateSelector('delay') as { enabled: boolean; time: number; feedback: number };
    assertEqual(delay.enabled, true, 'Delay enabled');
    assertEqual(delay.time, 0.3, 'Delay time');
    assertEqual(delay.feedback, 0.5, 'Delay feedback');

    await client.dispatch('setDelay', { enabled: false });
    delay = await client.getStateSelector('delay') as { enabled: boolean };
    assertEqual(delay.enabled, false, 'Delay disabled');
  });

  runner.test('Distortion effect toggle', async (client) => {
    await client.dispatch('setDistortion', { enabled: true, amount: 50 });
    let dist = await client.getStateSelector('distortion') as { enabled: boolean; amount: number };
    assertEqual(dist.enabled, true, 'Distortion enabled');
    assertEqual(dist.amount, 50, 'Distortion amount');

    await client.dispatch('setDistortion', { enabled: false });
    dist = await client.getStateSelector('distortion') as { enabled: boolean };
    assertEqual(dist.enabled, false, 'Distortion disabled');
  });
}
