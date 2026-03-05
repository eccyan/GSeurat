/**
 * Procedural music loop generator using OfflineAudioContext.
 * Generates WAV loops per layer type (bass, harmony, melody, percussion).
 */

import type { LoopStyle } from './music-presets.js';
import { audioBufferToWav } from './wav-utils.js';

const SAMPLE_RATE = 44100;

export interface GenerateLoopOptions {
  style: LoopStyle;
  duration: number; // seconds
  bpm: number;
}

/**
 * Generate a procedural audio loop and return WAV bytes.
 */
export async function generateLoop(opts: GenerateLoopOptions): Promise<ArrayBuffer> {
  const { style, duration, bpm } = opts;
  const totalSamples = Math.ceil(duration * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(1, totalSamples, SAMPLE_RATE);

  switch (style) {
    // -----------------------------------------------------------------------
    // Bass
    // -----------------------------------------------------------------------
    case 'ambient_drone':
      buildAmbientDrone(ctx, duration);
      break;
    case 'pulse_bass':
      buildPulseBass(ctx, duration, bpm);
      break;
    case 'dark_rumble':
      buildDarkRumble(ctx, duration);
      break;
    case 'walking_bass':
      buildWalkingBass(ctx, duration, bpm);
      break;

    // -----------------------------------------------------------------------
    // Harmony
    // -----------------------------------------------------------------------
    case 'ethereal_pad':
      buildEtherealPad(ctx, duration);
      break;
    case 'dark_minor':
      buildDarkMinor(ctx, duration);
      break;
    case 'fifth_drone':
      buildFifthDrone(ctx, duration);
      break;
    case 'mystery_sus4':
      buildMysterySus4(ctx, duration);
      break;

    // -----------------------------------------------------------------------
    // Melody
    // -----------------------------------------------------------------------
    case 'pentatonic_flow':
      buildPentatonicFlow(ctx, duration, bpm);
      break;
    case 'arpeggiated':
      buildArpeggiated(ctx, duration, bpm);
      break;
    case 'fantasy_motif':
      buildFantasyMotif(ctx, duration, bpm);
      break;
    case 'sparse_bells':
      buildSparseBells(ctx, duration, bpm);
      break;

    // -----------------------------------------------------------------------
    // Percussion
    // -----------------------------------------------------------------------
    case 'subtle_pulse':
      buildSubtlePulse(ctx, duration, bpm);
      break;
    case 'tribal':
      buildTribal(ctx, duration, bpm);
      break;
    case 'minimal_kick':
      buildMinimalKick(ctx, duration, bpm);
      break;
    case 'march':
      buildMarch(ctx, duration, bpm);
      break;
  }

  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}

// ===========================================================================
// Helpers
// ===========================================================================

function beatDuration(bpm: number): number {
  return 60 / bpm;
}

/** Create a simple oscillator playing for a duration. */
function simpleTone(
  ctx: OfflineAudioContext,
  type: OscillatorType,
  freq: number,
  gain: number,
  start: number,
  dur: number,
  dest: AudioNode,
  attack = 0.01,
  release = 0.05,
) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.setValueAtTime(gain, start + dur - release);
  g.gain.linearRampToValueAtTime(0, start + dur);

  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(start + dur);
}

/** Noise burst for percussion synthesis. */
function noiseBurst(
  ctx: OfflineAudioContext,
  start: number,
  dur: number,
  gain: number,
  dest: AudioNode,
  filterFreq?: number,
  filterType: BiquadFilterType = 'lowpass',
) {
  const bufferSize = Math.ceil(dur * ctx.sampleRate);
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + dur);

  if (filterFreq) {
    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.value = filterFreq;
    src.connect(flt);
    flt.connect(g);
  } else {
    src.connect(g);
  }

  g.connect(dest);
  src.start(start);
  src.stop(start + dur);
}

/** Synthesized kick drum. */
function synthKick(ctx: OfflineAudioContext, time: number, dest: AudioNode) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.8, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + 0.3);
}

/** Synthesized hi-hat (noise burst). */
function synthHihat(ctx: OfflineAudioContext, time: number, dest: AudioNode, volume = 0.3) {
  noiseBurst(ctx, time, 0.05, volume, dest, 8000, 'highpass');
}

/** Synthesized snare (noise + tone). */
function synthSnare(ctx: OfflineAudioContext, time: number, dest: AudioNode) {
  noiseBurst(ctx, time, 0.15, 0.5, dest, 3000, 'highpass');

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 200;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + 0.1);
}

/** Synthesized tom. */
function synthTom(ctx: OfflineAudioContext, time: number, dest: AudioNode, pitch = 100) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(pitch * 1.5, time);
  osc.frequency.exponentialRampToValueAtTime(pitch, time + 0.15);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.6, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + 0.25);
}

/** Shaker (short noise). */
function synthShaker(ctx: OfflineAudioContext, time: number, dest: AudioNode) {
  noiseBurst(ctx, time, 0.04, 0.2, dest, 6000, 'highpass');
}

// ===========================================================================
// Bass builders
// ===========================================================================

function buildAmbientDrone(ctx: OfflineAudioContext, duration: number) {
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);

  // Main sine
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 55; // A1

  // Detuned
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 55.5;

  const g1 = ctx.createGain();
  g1.gain.value = 0.5;
  const g2 = ctx.createGain();
  g2.gain.value = 0.35;

  osc1.connect(g1);
  osc2.connect(g2);
  g1.connect(master);
  g2.connect(master);

  // LFO on gain for slow pulsing
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.2; // slow
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.15;
  lfo.connect(lfoGain);
  lfoGain.connect(g1.gain);

  // Fade in/out
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.6, 0.5);
  master.gain.setValueAtTime(0.6, duration - 0.5);
  master.gain.linearRampToValueAtTime(0, duration);

  osc1.start(0);
  osc2.start(0);
  lfo.start(0);
  osc1.stop(duration);
  osc2.stop(duration);
  lfo.stop(duration);
}

function buildPulseBass(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  const eighthNote = beat / 2;
  const notes = [55, 55, 55, 55, 73.42, 73.42, 65.41, 65.41]; // A1, D2, C2 pattern
  let time = 0;
  let noteIdx = 0;

  while (time < duration) {
    const freq = notes[noteIdx % notes.length];
    const noteDur = Math.min(eighthNote * 0.8, duration - time);
    if (noteDur > 0) {
      simpleTone(ctx, 'sawtooth', freq, 0.6, time, noteDur, master, 0.005, 0.02);
    }
    time += eighthNote;
    noteIdx++;
  }
}

function buildDarkRumble(ctx: OfflineAudioContext, duration: number) {
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  // Low triangle
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 40;

  const g = ctx.createGain();
  g.gain.value = 0.5;
  osc.connect(g);
  g.connect(master);

  // Filtered noise layer
  const noiseLen = Math.ceil(duration * ctx.sampleRate);
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;

  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 200;

  const ng = ctx.createGain();
  ng.gain.value = 0.3;

  noiseSrc.connect(lpf);
  lpf.connect(ng);
  ng.connect(master);

  // Fade
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.5, 0.3);
  master.gain.setValueAtTime(0.5, duration - 0.3);
  master.gain.linearRampToValueAtTime(0, duration);

  osc.start(0);
  noiseSrc.start(0);
  osc.stop(duration);
  noiseSrc.stop(duration);
}

function buildWalkingBass(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  // A minor pentatonic bass notes
  const notes = [55, 65.41, 73.42, 82.41, 98, 82.41, 73.42, 65.41];
  let time = 0;
  let idx = 0;

  while (time < duration) {
    const freq = notes[idx % notes.length];
    const noteDur = Math.min(beat * 0.85, duration - time);
    if (noteDur > 0) {
      simpleTone(ctx, 'triangle', freq, 0.55, time, noteDur, master, 0.01, 0.04);
    }
    time += beat;
    idx++;
  }
}

// ===========================================================================
// Harmony builders
// ===========================================================================

function buildEtherealPad(ctx: OfflineAudioContext, duration: number) {
  const master = ctx.createGain();
  master.gain.value = 0.4;
  master.connect(ctx.destination);

  // C major triad: C4, E4, G4
  const freqs = [261.63, 329.63, 392.00];
  for (const freq of freqs) {
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.003; // slight detune

    const g = ctx.createGain();
    g.gain.value = 0.2;

    osc1.connect(g);
    osc2.connect(g);
    g.connect(master);

    osc1.start(0);
    osc2.start(0);
    osc1.stop(duration);
    osc2.stop(duration);
  }

  // Slow fade in/out
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.4, 1);
  master.gain.setValueAtTime(0.4, duration - 1);
  master.gain.linearRampToValueAtTime(0, duration);
}

function buildDarkMinor(ctx: OfflineAudioContext, duration: number) {
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);

  // A minor: A3, C4, E4
  const freqs = [220, 261.63, 329.63];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const g = ctx.createGain();
    g.gain.value = 0.25;

    // Tremolo via LFO
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 2.5;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.08;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);

    osc.connect(g);
    g.connect(master);

    osc.start(0);
    lfo.start(0);
    osc.stop(duration);
    lfo.stop(duration);
  }

  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.35, 0.8);
  master.gain.setValueAtTime(0.35, duration - 0.8);
  master.gain.linearRampToValueAtTime(0, duration);
}

function buildFifthDrone(ctx: OfflineAudioContext, duration: number) {
  const master = ctx.createGain();
  master.gain.value = 0.4;
  master.connect(ctx.destination);

  // Open fifth: A2, E3
  for (const freq of [110, 164.81]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 800;

    const g = ctx.createGain();
    g.gain.value = 0.3;

    osc.connect(lpf);
    lpf.connect(g);
    g.connect(master);

    osc.start(0);
    osc.stop(duration);
  }

  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.4, 0.5);
  master.gain.setValueAtTime(0.4, duration - 0.5);
  master.gain.linearRampToValueAtTime(0, duration);
}

function buildMysterySus4(ctx: OfflineAudioContext, duration: number) {
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);

  // Dsus4: D4, G4, A4
  const freqs = [293.66, 392.00, 440.00];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 0.998;

    const g = ctx.createGain();
    g.gain.value = 0.18;

    osc.connect(g);
    osc2.connect(g);
    g.connect(master);

    osc.start(0);
    osc2.start(0);
    osc.stop(duration);
    osc2.stop(duration);
  }

  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.35, 1.0);
  master.gain.setValueAtTime(0.35, duration - 1.0);
  master.gain.linearRampToValueAtTime(0, duration);
}

// ===========================================================================
// Melody builders
// ===========================================================================

/** Simple seeded PRNG for deterministic melodies. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildPentatonicFlow(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  // A minor pentatonic: A4 C5 D5 E5 G5
  const scale = [440, 523.25, 587.33, 659.25, 783.99];
  const rng = seededRandom(42);

  let time = 0;
  let idx = Math.floor(rng() * scale.length);

  while (time < duration) {
    const freq = scale[idx];
    const noteDur = Math.min(beat * 0.7, duration - time);
    if (noteDur > 0.01) {
      simpleTone(ctx, 'sine', freq, 0.4, time, noteDur, master, 0.01, 0.05);
    }
    // Random walk: stay, up, or down
    const step = Math.floor(rng() * 3) - 1; // -1, 0, 1
    idx = Math.max(0, Math.min(scale.length - 1, idx + step));
    time += beat;
  }
}

function buildArpeggiated(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.4;
  master.connect(ctx.destination);

  const eighth = beatDuration(bpm) / 2;
  // Am7 arpeggio: A4 C5 E5 G5
  const notes = [440, 523.25, 659.25, 783.99, 659.25, 523.25];
  let time = 0;
  let idx = 0;

  while (time < duration) {
    const freq = notes[idx % notes.length];
    const noteDur = Math.min(eighth * 0.8, duration - time);
    if (noteDur > 0.01) {
      simpleTone(ctx, 'triangle', freq, 0.35, time, noteDur, master, 0.005, 0.03);
    }
    time += eighth;
    idx++;
  }
}

function buildFantasyMotif(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.4;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  // Fixed 8-note phrase (Zelda-esque): D5, F5, A5, G5, F5, D5, C5, D5
  const phrase = [587.33, 698.46, 880, 783.99, 698.46, 587.33, 523.25, 587.33];
  const durations = [1, 1, 0.5, 0.5, 1, 1, 1, 2]; // in beats

  let time = 0;
  let idx = 0;

  while (time < duration) {
    const freq = phrase[idx % phrase.length];
    const noteDurBeats = durations[idx % durations.length];
    const noteDur = Math.min(noteDurBeats * beat * 0.85, duration - time);
    if (noteDur > 0.01) {
      simpleTone(ctx, 'sine', freq, 0.4, time, noteDur, master, 0.01, 0.05);
    }
    time += noteDurBeats * beat;
    idx++;
  }
}

function buildSparseBells(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  const scale = [523.25, 587.33, 659.25, 783.99, 880]; // C5-A5
  const rng = seededRandom(7);

  let time = 0;
  while (time < duration) {
    // ~60% chance to play a note each beat
    if (rng() < 0.6) {
      const freq = scale[Math.floor(rng() * scale.length)];
      const noteDur = Math.min(beat * 1.5, duration - time);
      if (noteDur > 0.01) {
        // Bell-like: sine with long release
        simpleTone(ctx, 'sine', freq, 0.3, time, noteDur, master, 0.002, noteDur * 0.6);
        // Add harmonic
        simpleTone(ctx, 'sine', freq * 2, 0.1, time, noteDur * 0.7, master, 0.002, noteDur * 0.4);
      }
    }
    time += beat;
  }
}

// ===========================================================================
// Percussion builders
// ===========================================================================

function buildSubtlePulse(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  let time = 0;
  let beatIdx = 0;

  while (time < duration) {
    // Kick on beats 1, 3
    if (beatIdx % 4 === 0 || beatIdx % 4 === 2) {
      synthKick(ctx, time, master);
    }
    // Hi-hat on every 8th note
    synthHihat(ctx, time, master, 0.15);
    if (time + beat / 2 < duration) {
      synthHihat(ctx, time + beat / 2, master, 0.1);
    }

    time += beat;
    beatIdx++;
  }
}

function buildTribal(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  let time = 0;
  let beatIdx = 0;

  while (time < duration) {
    const pos = beatIdx % 8;

    // Kick on 1, 4, 7
    if (pos === 0 || pos === 3 || pos === 6) {
      synthKick(ctx, time, master);
    }
    // Tom on 2, 5
    if (pos === 1 || pos === 4) {
      synthTom(ctx, time, master, 80);
    }
    // High tom on 3
    if (pos === 2) {
      synthTom(ctx, time, master, 120);
    }
    // Shaker on every 8th note
    synthShaker(ctx, time, master);
    if (time + beat / 2 < duration) {
      synthShaker(ctx, time + beat / 2, master);
    }

    time += beat;
    beatIdx++;
  }
}

function buildMinimalKick(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  let time = 0;

  while (time < duration) {
    synthKick(ctx, time, master);
    time += beat;
  }
}

function buildMarch(ctx: OfflineAudioContext, duration: number, bpm: number) {
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const beat = beatDuration(bpm);
  let time = 0;
  let beatIdx = 0;

  while (time < duration) {
    if (beatIdx % 2 === 0) {
      synthKick(ctx, time, master);
    } else {
      synthSnare(ctx, time, master);
    }
    // Hi-hat on every 8th
    synthHihat(ctx, time, master, 0.12);
    if (time + beat / 2 < duration) {
      synthHihat(ctx, time + beat / 2, master, 0.08);
    }

    time += beat;
    beatIdx++;
  }
}
