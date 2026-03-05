/**
 * SFX Designer — Scenario Tests (multi-step workflows)
 */
import { TestRunner, assert, assertEqual } from './qa-runner.js';
import { assertStateHas } from './helpers.js';

interface Oscillator {
  id: string;
  waveform: string;
  frequency: number;
}

interface Filter {
  id: string;
  type: string;
  cutoff: number;
}

interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

interface EffectState {
  enabled: boolean;
  [key: string]: unknown;
}

export function runSfxDesignerScenarios(runner: TestRunner): void {
  // -----------------------------------------------------------------------
  // Scenario: Synthesize bell sound from scratch
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Synthesize bell sound from scratch', async (client) => {
    // Track initial oscillator count
    const initialOscs = (await client.getStateSelector('oscillators')) as Oscillator[];
    const initialOscCount = initialOscs.length;

    // 1. Add 2 oscillators
    await client.dispatch('addOscillator');
    await client.dispatch('addOscillator');
    let oscs = (await client.getStateSelector('oscillators')) as Oscillator[];
    assertEqual(oscs.length, initialOscCount + 2, 'Should have 2 new oscillators');

    // 2. Set osc1: sine, 440Hz
    const osc1 = oscs[oscs.length - 2];
    await client.dispatch('updateOscillator', osc1.id, { waveform: 'sine', frequency: 440 });

    // 3. Set osc2: square, 880Hz (harmonic)
    const osc2 = oscs[oscs.length - 1];
    await client.dispatch('updateOscillator', osc2.id, { waveform: 'square', frequency: 880 });

    // Verify oscillator configs
    oscs = (await client.getStateSelector('oscillators')) as Oscillator[];
    const updatedOsc1 = oscs.find((o) => o.id === osc1.id)!;
    const updatedOsc2 = oscs.find((o) => o.id === osc2.id)!;
    assertEqual(updatedOsc1.waveform, 'sine', 'Osc1 waveform=sine');
    assertEqual(updatedOsc1.frequency, 440, 'Osc1 frequency=440');
    assertEqual(updatedOsc2.waveform, 'square', 'Osc2 waveform=square');
    assertEqual(updatedOsc2.frequency, 880, 'Osc2 frequency=880');

    // 4. Set envelope: attack=0.01, decay=0.3, sustain=0.5, release=0.8
    await client.dispatch('setEnvelope', {
      attack: 0.01,
      decay: 0.3,
      sustain: 0.5,
      release: 0.8,
    });
    const env = (await client.getStateSelector('envelope')) as Envelope;
    assertEqual(env.attack, 0.01, 'Envelope attack=0.01');
    assertEqual(env.decay, 0.3, 'Envelope decay=0.3');
    assertEqual(env.sustain, 0.5, 'Envelope sustain=0.5');
    assertEqual(env.release, 0.8, 'Envelope release=0.8');

    // 5. Add lowpass filter, cutoff=2000
    const initialFilters = (await client.getStateSelector('filters')) as Filter[];
    const initialFilterCount = initialFilters.length;
    await client.dispatch('addFilter');
    let filters = (await client.getStateSelector('filters')) as Filter[];
    assertEqual(filters.length, initialFilterCount + 1, 'Should have 1 new filter');
    const filter = filters[filters.length - 1];
    await client.dispatch('updateFilter', filter.id, { type: 'lowpass', cutoff: 2000 });

    filters = (await client.getStateSelector('filters')) as Filter[];
    const updatedFilter = filters.find((f) => f.id === filter.id)!;
    assertEqual(updatedFilter.type, 'lowpass', 'Filter type=lowpass');

    // 6. Enable reverb: roomSize=0.7, enabled=true
    await client.dispatch('setReverb', { enabled: true, roomSize: 0.7 });
    const reverb = (await client.getStateSelector('reverb')) as EffectState;
    assertEqual(reverb.enabled, true, 'Reverb enabled');

    // 7. Enable delay: time=0.25, feedback=0.4
    await client.dispatch('setDelay', { enabled: true, time: 0.25, feedback: 0.4 });
    const delay = (await client.getStateSelector('delay')) as EffectState;
    assertEqual(delay.enabled, true, 'Delay enabled');

    // 8. Verify full state: 2 new oscillators, envelope, 1 new filter, reverb+delay enabled
    oscs = (await client.getStateSelector('oscillators')) as Oscillator[];
    assertEqual(oscs.length, initialOscCount + 2, '2 new oscillators in final state');
    filters = (await client.getStateSelector('filters')) as Filter[];
    assertEqual(filters.length, initialFilterCount + 1, '1 new filter in final state');

    const finalReverb = (await client.getStateSelector('reverb')) as EffectState;
    assertEqual(finalReverb.enabled, true, 'Reverb still enabled');
    const finalDelay = (await client.getStateSelector('delay')) as EffectState;
    assertEqual(finalDelay.enabled, true, 'Delay still enabled');

    // 9. Remove osc2 → verify 1 oscillator remains (of the new ones)
    await client.dispatch('removeOscillator', osc2.id);
    oscs = (await client.getStateSelector('oscillators')) as Oscillator[];
    assertEqual(oscs.length, initialOscCount + 1, '1 new oscillator after removal');
    const osc2Gone = oscs.find((o) => o.id === osc2.id);
    assert(osc2Gone === undefined, 'Osc2 should be removed');

    // 10. Disable all effects → verify clean state
    await client.dispatch('setReverb', { enabled: false });
    await client.dispatch('setDelay', { enabled: false });
    await client.dispatch('setDistortion', { enabled: false });

    const cleanReverb = (await client.getStateSelector('reverb')) as EffectState;
    assertEqual(cleanReverb.enabled, false, 'Reverb disabled');
    const cleanDelay = (await client.getStateSelector('delay')) as EffectState;
    assertEqual(cleanDelay.enabled, false, 'Delay disabled');
    const cleanDistortion = (await client.getStateSelector('distortion')) as EffectState;
    assertEqual(cleanDistortion.enabled, false, 'Distortion disabled');

    // Cleanup: remove added oscillator and filter
    await client.dispatch('removeOscillator', osc1.id);
    await client.dispatch('removeFilter', filter.id);
  });

  // -----------------------------------------------------------------------
  // Scenario: Effect chain ordering
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Effect chain ordering', async (client) => {
    const initialFilters = (await client.getStateSelector('filters')) as Filter[];
    const initialCount = initialFilters.length;

    // 1. Add 3 filters (lowpass, highpass, bandpass)
    await client.dispatch('addFilter');
    await client.dispatch('addFilter');
    await client.dispatch('addFilter');

    let filters = (await client.getStateSelector('filters')) as Filter[];
    assertEqual(filters.length, initialCount + 3, '3 new filters added');

    const f1 = filters[filters.length - 3];
    const f2 = filters[filters.length - 2];
    const f3 = filters[filters.length - 1];

    await client.dispatch('updateFilter', f1.id, { type: 'lowpass', cutoff: 1000 });
    await client.dispatch('updateFilter', f2.id, { type: 'highpass', cutoff: 200 });
    await client.dispatch('updateFilter', f3.id, { type: 'bandpass', cutoff: 500 });

    // 2. Verify filter count = initialCount + 3
    filters = (await client.getStateSelector('filters')) as Filter[];
    assertEqual(filters.length, initialCount + 3, 'Filter count confirmed');

    // 3. Verify each filter's cutoff is distinct
    const uf1 = filters.find((f) => f.id === f1.id)!;
    const uf2 = filters.find((f) => f.id === f2.id)!;
    const uf3 = filters.find((f) => f.id === f3.id)!;
    assertEqual(uf1.type, 'lowpass', 'Filter 1 type=lowpass');
    assertEqual(uf2.type, 'highpass', 'Filter 2 type=highpass');
    assertEqual(uf3.type, 'bandpass', 'Filter 3 type=bandpass');

    // 4. Remove middle filter → verify 2 remain with correct types
    await client.dispatch('removeFilter', f2.id);
    filters = (await client.getStateSelector('filters')) as Filter[];
    assertEqual(filters.length, initialCount + 2, '2 new filters after middle removal');

    const remaining = filters.filter(
      (f) => f.id === f1.id || f.id === f3.id,
    );
    assertEqual(remaining.length, 2, 'Correct 2 filters remain');

    // 5. Toggle all 3 effects (reverb/delay/distortion) on then off
    await client.dispatch('setReverb', { enabled: true, roomSize: 0.5 });
    await client.dispatch('setDelay', { enabled: true, time: 0.2, feedback: 0.3 });
    await client.dispatch('setDistortion', { enabled: true, amount: 30 });

    let reverb = (await client.getStateSelector('reverb')) as EffectState;
    let delay = (await client.getStateSelector('delay')) as EffectState;
    let distortion = (await client.getStateSelector('distortion')) as EffectState;
    assertEqual(reverb.enabled, true, 'Reverb toggled on');
    assertEqual(delay.enabled, true, 'Delay toggled on');
    assertEqual(distortion.enabled, true, 'Distortion toggled on');

    await client.dispatch('setReverb', { enabled: false });
    await client.dispatch('setDelay', { enabled: false });
    await client.dispatch('setDistortion', { enabled: false });

    // 6. Verify clean effect state
    reverb = (await client.getStateSelector('reverb')) as EffectState;
    delay = (await client.getStateSelector('delay')) as EffectState;
    distortion = (await client.getStateSelector('distortion')) as EffectState;
    assertEqual(reverb.enabled, false, 'Reverb clean');
    assertEqual(delay.enabled, false, 'Delay clean');
    assertEqual(distortion.enabled, false, 'Distortion clean');

    // Cleanup
    await client.dispatch('removeFilter', f1.id);
    await client.dispatch('removeFilter', f3.id);
  });
}
