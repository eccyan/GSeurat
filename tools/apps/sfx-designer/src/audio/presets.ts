/**
 * Built-in SFX presets matching the game's audio system (Phase 13).
 * Each preset fully describes oscillators, envelope, filters, and effects.
 */

import type { OscillatorDef, AdsrEnvelope, FilterDef, ReverbEffect, DelayEffect, DistortionEffect } from '../store/useSfxStore.js';

export interface SfxPreset {
  name: string;
  description: string;
  oscillators: Omit<OscillatorDef, 'id'>[];
  envelope: AdsrEnvelope;
  filters: Omit<FilterDef, 'id'>[];
  reverb: ReverbEffect;
  delay: DelayEffect;
  distortion: DistortionEffect;
}

export const SFX_PRESETS: SfxPreset[] = [
  {
    name: 'footstep',
    description: 'Soft thud footstep on stone floor',
    oscillators: [
      {
        waveform: 'noise',
        frequency: 200,
        detune: 0,
        volume: 0.7,
        freqEnvStart: 200,
        freqEnvEnd: 80,
        freqEnvDuration: 0.08,
      },
    ],
    envelope: {
      attack: 0.002,
      decay: 0.06,
      sustain: 0.0,
      release: 0.05,
      duration: 0.18,
    },
    filters: [
      { type: 'lowpass', cutoff: 800, q: 1.0 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.2, dampening: 0.8, mix: 0.12 },
    delay:  { enabled: false, bypass: false, time: 0.25, feedback: 0.3, mix: 0.2 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'dialog_open',
    description: 'UI open chime — soft sine bell',
    oscillators: [
      {
        waveform: 'sine',
        frequency: 880,
        detune: 0,
        volume: 0.6,
        freqEnvStart: 880,
        freqEnvEnd: 880,
        freqEnvDuration: 0,
      },
      {
        waveform: 'sine',
        frequency: 1320,
        detune: 0,
        volume: 0.3,
        freqEnvStart: 1320,
        freqEnvEnd: 1320,
        freqEnvDuration: 0,
      },
    ],
    envelope: {
      attack: 0.01,
      decay: 0.15,
      sustain: 0.2,
      release: 0.35,
      duration: 0.6,
    },
    filters: [
      { type: 'highpass', cutoff: 400, q: 0.7 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.35, dampening: 0.5, mix: 0.25 },
    delay:  { enabled: false, bypass: false, time: 0.25, feedback: 0.3, mix: 0.2 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'dialog_close',
    description: 'UI close chime — falling tone',
    oscillators: [
      {
        waveform: 'sine',
        frequency: 880,
        detune: 0,
        volume: 0.6,
        freqEnvStart: 880,
        freqEnvEnd: 440,
        freqEnvDuration: 0.25,
      },
    ],
    envelope: {
      attack: 0.005,
      decay: 0.1,
      sustain: 0.1,
      release: 0.2,
      duration: 0.4,
    },
    filters: [],
    reverb: { enabled: true, bypass: false, roomSize: 0.3, dampening: 0.5, mix: 0.2 },
    delay:  { enabled: false, bypass: false, time: 0.25, feedback: 0.3, mix: 0.2 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'dialog_blip',
    description: 'Text advance blip — short sine click',
    oscillators: [
      {
        waveform: 'sine',
        frequency: 660,
        detune: 0,
        volume: 0.4,
        freqEnvStart: 660,
        freqEnvEnd: 660,
        freqEnvDuration: 0,
      },
    ],
    envelope: {
      attack: 0.001,
      decay: 0.04,
      sustain: 0.0,
      release: 0.02,
      duration: 0.07,
    },
    filters: [],
    reverb: { enabled: false, bypass: false, roomSize: 0.2, dampening: 0.5, mix: 0.1 },
    delay:  { enabled: false, bypass: false, time: 0.1, feedback: 0.2, mix: 0.1 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'torch_crackle',
    description: 'Loopable torch fire crackle',
    oscillators: [
      {
        waveform: 'noise',
        frequency: 440,
        detune: 0,
        volume: 0.5,
        freqEnvStart: 440,
        freqEnvEnd: 440,
        freqEnvDuration: 0,
      },
    ],
    envelope: {
      attack: 0.05,
      decay: 0.1,
      sustain: 0.6,
      release: 0.15,
      duration: 1.0,
    },
    filters: [
      { type: 'bandpass', cutoff: 1200, q: 0.8 },
      { type: 'lowpass',  cutoff: 3000, q: 0.5 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.15, dampening: 0.7, mix: 0.15 },
    delay:  { enabled: false, bypass: false, time: 0.1, feedback: 0.2, mix: 0.1 },
    distortion: { enabled: true, bypass: false, amount: 30, oversample: '2x', mix: 0.25 },
  },

  {
    name: 'coin_pickup',
    description: 'Short bright coin jingle',
    oscillators: [
      {
        waveform: 'sine',
        frequency: 1320,
        detune: 0,
        volume: 0.7,
        freqEnvStart: 1320,
        freqEnvEnd: 1760,
        freqEnvDuration: 0.1,
      },
      {
        waveform: 'triangle',
        frequency: 1980,
        detune: 5,
        volume: 0.3,
        freqEnvStart: 1980,
        freqEnvEnd: 1980,
        freqEnvDuration: 0,
      },
    ],
    envelope: {
      attack: 0.003,
      decay: 0.08,
      sustain: 0.15,
      release: 0.25,
      duration: 0.45,
    },
    filters: [
      { type: 'highpass', cutoff: 600, q: 0.7 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.25, dampening: 0.4, mix: 0.2 },
    delay:  { enabled: false, bypass: false, time: 0.25, feedback: 0.3, mix: 0.2 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'explosion',
    description: 'Deep rumbling explosion',
    oscillators: [
      {
        waveform: 'noise',
        frequency: 60,
        detune: 0,
        volume: 0.9,
        freqEnvStart: 60,
        freqEnvEnd: 20,
        freqEnvDuration: 0.5,
      },
      {
        waveform: 'sawtooth',
        frequency: 80,
        detune: 0,
        volume: 0.5,
        freqEnvStart: 200,
        freqEnvEnd: 40,
        freqEnvDuration: 0.3,
      },
    ],
    envelope: {
      attack: 0.005,
      decay: 0.3,
      sustain: 0.2,
      release: 0.8,
      duration: 1.5,
    },
    filters: [
      { type: 'lowpass', cutoff: 600, q: 1.5 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.85, dampening: 0.3, mix: 0.45 },
    delay:  { enabled: false, bypass: false, time: 0.15, feedback: 0.2, mix: 0.1 },
    distortion: { enabled: true, bypass: false, amount: 80, oversample: '4x', mix: 0.6 },
  },

  {
    name: 'sword_slash',
    description: 'Metallic sword swing whoosh',
    oscillators: [
      {
        waveform: 'noise',
        frequency: 440,
        detune: 0,
        volume: 0.8,
        freqEnvStart: 2000,
        freqEnvEnd: 300,
        freqEnvDuration: 0.2,
      },
      {
        waveform: 'sawtooth',
        frequency: 220,
        detune: 0,
        volume: 0.3,
        freqEnvStart: 800,
        freqEnvEnd: 100,
        freqEnvDuration: 0.15,
      },
    ],
    envelope: {
      attack: 0.002,
      decay: 0.08,
      sustain: 0.0,
      release: 0.1,
      duration: 0.3,
    },
    filters: [
      { type: 'bandpass', cutoff: 1500, q: 0.6 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.2, dampening: 0.6, mix: 0.1 },
    delay:  { enabled: false, bypass: false, time: 0.25, feedback: 0.3, mix: 0.2 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'laser_shot',
    description: 'Sci-fi laser beam — fast sine sweep',
    oscillators: [
      {
        waveform: 'sine',
        frequency: 1200,
        detune: 0,
        volume: 0.8,
        freqEnvStart: 2400,
        freqEnvEnd: 200,
        freqEnvDuration: 0.2,
      },
    ],
    envelope: {
      attack: 0.001,
      decay: 0.1,
      sustain: 0.0,
      release: 0.08,
      duration: 0.25,
    },
    filters: [
      { type: 'highpass', cutoff: 300, q: 1.0 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.15, dampening: 0.7, mix: 0.1 },
    delay:  { enabled: true, bypass: false, time: 0.08, feedback: 0.3, mix: 0.15 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'magic_spell',
    description: 'Rising ethereal sparkle with delay',
    oscillators: [
      {
        waveform: 'sine',
        frequency: 660,
        detune: 0,
        volume: 0.6,
        freqEnvStart: 440,
        freqEnvEnd: 880,
        freqEnvDuration: 0.4,
      },
      {
        waveform: 'triangle',
        frequency: 990,
        detune: 7,
        volume: 0.3,
        freqEnvStart: 660,
        freqEnvEnd: 1320,
        freqEnvDuration: 0.35,
      },
    ],
    envelope: {
      attack: 0.02,
      decay: 0.2,
      sustain: 0.3,
      release: 0.5,
      duration: 1.0,
    },
    filters: [
      { type: 'highpass', cutoff: 300, q: 0.5 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.7, dampening: 0.3, mix: 0.4 },
    delay:  { enabled: true, bypass: false, time: 0.15, feedback: 0.4, mix: 0.25 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'water_splash',
    description: 'Short water impact with reverb tail',
    oscillators: [
      {
        waveform: 'noise',
        frequency: 400,
        detune: 0,
        volume: 0.6,
        freqEnvStart: 800,
        freqEnvEnd: 200,
        freqEnvDuration: 0.3,
      },
      {
        waveform: 'sine',
        frequency: 600,
        detune: 0,
        volume: 0.3,
        freqEnvStart: 1000,
        freqEnvEnd: 300,
        freqEnvDuration: 0.25,
      },
    ],
    envelope: {
      attack: 0.005,
      decay: 0.15,
      sustain: 0.1,
      release: 0.4,
      duration: 0.7,
    },
    filters: [
      { type: 'lowpass', cutoff: 2000, q: 1.2 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.6, dampening: 0.3, mix: 0.4 },
    delay:  { enabled: false, bypass: false, time: 0.2, feedback: 0.3, mix: 0.15 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'powerup',
    description: 'Rising sweep power-up jingle',
    oscillators: [
      {
        waveform: 'sine',
        frequency: 440,
        detune: 0,
        volume: 0.7,
        freqEnvStart: 330,
        freqEnvEnd: 1320,
        freqEnvDuration: 0.4,
      },
      {
        waveform: 'triangle',
        frequency: 660,
        detune: 3,
        volume: 0.3,
        freqEnvStart: 440,
        freqEnvEnd: 1760,
        freqEnvDuration: 0.45,
      },
    ],
    envelope: {
      attack: 0.01,
      decay: 0.15,
      sustain: 0.2,
      release: 0.3,
      duration: 0.8,
    },
    filters: [
      { type: 'highpass', cutoff: 200, q: 0.5 },
    ],
    reverb: { enabled: true, bypass: false, roomSize: 0.4, dampening: 0.4, mix: 0.25 },
    delay:  { enabled: true, bypass: false, time: 0.1, feedback: 0.3, mix: 0.15 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },

  {
    name: 'alarm_beep',
    description: 'Warning siren — oscillating square wave',
    oscillators: [
      {
        waveform: 'square',
        frequency: 800,
        detune: 0,
        volume: 0.6,
        freqEnvStart: 600,
        freqEnvEnd: 1000,
        freqEnvDuration: 0.5,
      },
    ],
    envelope: {
      attack: 0.01,
      decay: 0.1,
      sustain: 0.8,
      release: 0.1,
      duration: 1.0,
    },
    filters: [
      { type: 'bandpass', cutoff: 1200, q: 1.0 },
    ],
    reverb: { enabled: false, bypass: false, roomSize: 0.3, dampening: 0.5, mix: 0.2 },
    delay:  { enabled: false, bypass: false, time: 0.15, feedback: 0.3, mix: 0.15 },
    distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
  },
];
