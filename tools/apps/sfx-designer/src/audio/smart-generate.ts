/**
 * Keyword-based procedural SFX generation.
 *
 * Maps text prompts to synth parameters by matching keyword groups,
 * then applying modifier keywords (deep, high, long, short, echo).
 * Returns an SfxPreset that can be loaded directly into the editor store.
 */

import type { SfxPreset } from './presets.js';

// ---------------------------------------------------------------------------
// Keyword rules
// ---------------------------------------------------------------------------

interface KeywordRule {
  keywords: string[];
  preset: Omit<SfxPreset, 'name' | 'description'>;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    keywords: ['explosion', 'blast', 'boom', 'detonate'],
    preset: {
      oscillators: [
        { waveform: 'noise', frequency: 60, detune: 0, volume: 0.9, freqEnvStart: 60, freqEnvEnd: 20, freqEnvDuration: 0.5 },
        { waveform: 'sawtooth', frequency: 80, detune: 0, volume: 0.5, freqEnvStart: 200, freqEnvEnd: 40, freqEnvDuration: 0.3 },
      ],
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.8, duration: 1.5 },
      filters: [{ type: 'lowpass', cutoff: 600, q: 1.5 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.85, dampening: 0.3, mix: 0.45 },
      delay: { enabled: false, bypass: false, time: 0.15, feedback: 0.2, mix: 0.1 },
      distortion: { enabled: true, bypass: false, amount: 80, oversample: '4x', mix: 0.6 },
    },
  },
  {
    keywords: ['laser', 'zap', 'beam', 'phaser'],
    preset: {
      oscillators: [
        { waveform: 'sine', frequency: 1200, detune: 0, volume: 0.8, freqEnvStart: 2400, freqEnvEnd: 200, freqEnvDuration: 0.2 },
      ],
      envelope: { attack: 0.001, decay: 0.1, sustain: 0.0, release: 0.08, duration: 0.25 },
      filters: [{ type: 'highpass', cutoff: 300, q: 1.0 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.15, dampening: 0.7, mix: 0.1 },
      delay: { enabled: true, bypass: false, time: 0.08, feedback: 0.3, mix: 0.15 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['coin', 'pickup', 'gem', 'collect', 'item'],
    preset: {
      oscillators: [
        { waveform: 'sine', frequency: 1320, detune: 0, volume: 0.7, freqEnvStart: 1320, freqEnvEnd: 1760, freqEnvDuration: 0.1 },
        { waveform: 'triangle', frequency: 1980, detune: 5, volume: 0.3, freqEnvStart: 1980, freqEnvEnd: 1980, freqEnvDuration: 0 },
      ],
      envelope: { attack: 0.003, decay: 0.08, sustain: 0.15, release: 0.25, duration: 0.45 },
      filters: [{ type: 'highpass', cutoff: 600, q: 0.7 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.25, dampening: 0.4, mix: 0.2 },
      delay: { enabled: false, bypass: false, time: 0.25, feedback: 0.3, mix: 0.2 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['footstep', 'step', 'walk', 'stomp'],
    preset: {
      oscillators: [
        { waveform: 'noise', frequency: 200, detune: 0, volume: 0.7, freqEnvStart: 200, freqEnvEnd: 80, freqEnvDuration: 0.08 },
      ],
      envelope: { attack: 0.002, decay: 0.06, sustain: 0.0, release: 0.05, duration: 0.18 },
      filters: [{ type: 'lowpass', cutoff: 800, q: 1.0 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.2, dampening: 0.8, mix: 0.12 },
      delay: { enabled: false, bypass: false, time: 0.25, feedback: 0.3, mix: 0.2 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['water', 'splash', 'drip', 'bubble'],
    preset: {
      oscillators: [
        { waveform: 'noise', frequency: 400, detune: 0, volume: 0.6, freqEnvStart: 800, freqEnvEnd: 200, freqEnvDuration: 0.3 },
        { waveform: 'sine', frequency: 600, detune: 0, volume: 0.3, freqEnvStart: 1000, freqEnvEnd: 300, freqEnvDuration: 0.25 },
      ],
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.1, release: 0.4, duration: 0.7 },
      filters: [{ type: 'lowpass', cutoff: 2000, q: 1.2 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.6, dampening: 0.3, mix: 0.4 },
      delay: { enabled: false, bypass: false, time: 0.2, feedback: 0.3, mix: 0.15 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['sword', 'slash', 'swing', 'swipe', 'blade'],
    preset: {
      oscillators: [
        { waveform: 'noise', frequency: 440, detune: 0, volume: 0.8, freqEnvStart: 2000, freqEnvEnd: 300, freqEnvDuration: 0.2 },
        { waveform: 'sawtooth', frequency: 220, detune: 0, volume: 0.3, freqEnvStart: 800, freqEnvEnd: 100, freqEnvDuration: 0.15 },
      ],
      envelope: { attack: 0.002, decay: 0.08, sustain: 0.0, release: 0.1, duration: 0.3 },
      filters: [{ type: 'bandpass', cutoff: 1500, q: 0.6 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.2, dampening: 0.6, mix: 0.1 },
      delay: { enabled: false, bypass: false, time: 0.25, feedback: 0.3, mix: 0.2 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['magic', 'spell', 'enchant', 'cast', 'arcane'],
    preset: {
      oscillators: [
        { waveform: 'sine', frequency: 660, detune: 0, volume: 0.6, freqEnvStart: 440, freqEnvEnd: 880, freqEnvDuration: 0.4 },
        { waveform: 'triangle', frequency: 990, detune: 7, volume: 0.3, freqEnvStart: 660, freqEnvEnd: 1320, freqEnvDuration: 0.35 },
      ],
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.5, duration: 1.0 },
      filters: [{ type: 'highpass', cutoff: 300, q: 0.5 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.7, dampening: 0.3, mix: 0.4 },
      delay: { enabled: true, bypass: false, time: 0.15, feedback: 0.4, mix: 0.25 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['fire', 'flame', 'torch', 'burn'],
    preset: {
      oscillators: [
        { waveform: 'noise', frequency: 440, detune: 0, volume: 0.5, freqEnvStart: 440, freqEnvEnd: 440, freqEnvDuration: 0 },
      ],
      envelope: { attack: 0.05, decay: 0.1, sustain: 0.6, release: 0.15, duration: 1.0 },
      filters: [
        { type: 'bandpass', cutoff: 1200, q: 0.8 },
        { type: 'lowpass', cutoff: 3000, q: 0.5 },
      ],
      reverb: { enabled: true, bypass: false, roomSize: 0.15, dampening: 0.7, mix: 0.15 },
      delay: { enabled: false, bypass: false, time: 0.1, feedback: 0.2, mix: 0.1 },
      distortion: { enabled: true, bypass: false, amount: 30, oversample: '2x', mix: 0.25 },
    },
  },
  {
    keywords: ['wind', 'whoosh', 'gust', 'breeze'],
    preset: {
      oscillators: [
        { waveform: 'noise', frequency: 300, detune: 0, volume: 0.6, freqEnvStart: 200, freqEnvEnd: 600, freqEnvDuration: 0.8 },
      ],
      envelope: { attack: 0.2, decay: 0.3, sustain: 0.4, release: 0.5, duration: 1.5 },
      filters: [{ type: 'bandpass', cutoff: 1000, q: 0.5 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.5, dampening: 0.4, mix: 0.3 },
      delay: { enabled: false, bypass: false, time: 0.2, feedback: 0.3, mix: 0.15 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['click', 'ui', 'button', 'tap', 'menu'],
    preset: {
      oscillators: [
        { waveform: 'sine', frequency: 800, detune: 0, volume: 0.5, freqEnvStart: 800, freqEnvEnd: 800, freqEnvDuration: 0 },
      ],
      envelope: { attack: 0.001, decay: 0.03, sustain: 0.0, release: 0.02, duration: 0.06 },
      filters: [],
      reverb: { enabled: false, bypass: false, roomSize: 0.1, dampening: 0.5, mix: 0.1 },
      delay: { enabled: false, bypass: false, time: 0.1, feedback: 0.2, mix: 0.1 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['bell', 'chime', 'ding', 'ring'],
    preset: {
      oscillators: [
        { waveform: 'sine', frequency: 880, detune: 0, volume: 0.6, freqEnvStart: 880, freqEnvEnd: 880, freqEnvDuration: 0 },
        { waveform: 'sine', frequency: 1760, detune: 0, volume: 0.25, freqEnvStart: 1760, freqEnvEnd: 1760, freqEnvDuration: 0 },
        { waveform: 'sine', frequency: 2640, detune: 0, volume: 0.1, freqEnvStart: 2640, freqEnvEnd: 2640, freqEnvDuration: 0 },
      ],
      envelope: { attack: 0.001, decay: 0.3, sustain: 0.1, release: 1.0, duration: 1.5 },
      filters: [{ type: 'highpass', cutoff: 500, q: 0.5 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.5, dampening: 0.3, mix: 0.35 },
      delay: { enabled: false, bypass: false, time: 0.2, feedback: 0.3, mix: 0.15 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['thunder', 'rumble', 'quake'],
    preset: {
      oscillators: [
        { waveform: 'noise', frequency: 40, detune: 0, volume: 0.9, freqEnvStart: 80, freqEnvEnd: 30, freqEnvDuration: 0.8 },
        { waveform: 'sawtooth', frequency: 50, detune: 0, volume: 0.4, freqEnvStart: 100, freqEnvEnd: 30, freqEnvDuration: 0.6 },
      ],
      envelope: { attack: 0.01, decay: 0.4, sustain: 0.3, release: 1.2, duration: 2.0 },
      filters: [{ type: 'lowpass', cutoff: 400, q: 1.0 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.9, dampening: 0.2, mix: 0.5 },
      delay: { enabled: true, bypass: false, time: 0.3, feedback: 0.4, mix: 0.2 },
      distortion: { enabled: true, bypass: false, amount: 60, oversample: '4x', mix: 0.4 },
    },
  },
  {
    keywords: ['alarm', 'siren', 'alert', 'warning'],
    preset: {
      oscillators: [
        { waveform: 'square', frequency: 800, detune: 0, volume: 0.6, freqEnvStart: 600, freqEnvEnd: 1000, freqEnvDuration: 0.5 },
      ],
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.1, duration: 1.0 },
      filters: [{ type: 'bandpass', cutoff: 1200, q: 1.0 }],
      reverb: { enabled: false, bypass: false, roomSize: 0.3, dampening: 0.5, mix: 0.2 },
      delay: { enabled: false, bypass: false, time: 0.15, feedback: 0.3, mix: 0.15 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['powerup', 'levelup', 'upgrade', 'boost'],
    preset: {
      oscillators: [
        { waveform: 'sine', frequency: 440, detune: 0, volume: 0.7, freqEnvStart: 330, freqEnvEnd: 1320, freqEnvDuration: 0.4 },
        { waveform: 'triangle', frequency: 660, detune: 3, volume: 0.3, freqEnvStart: 440, freqEnvEnd: 1760, freqEnvDuration: 0.45 },
      ],
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.2, release: 0.3, duration: 0.8 },
      filters: [{ type: 'highpass', cutoff: 200, q: 0.5 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.4, dampening: 0.4, mix: 0.25 },
      delay: { enabled: true, bypass: false, time: 0.1, feedback: 0.3, mix: 0.15 },
      distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
    },
  },
  {
    keywords: ['hit', 'punch', 'thud', 'impact', 'smash'],
    preset: {
      oscillators: [
        { waveform: 'noise', frequency: 150, detune: 0, volume: 0.9, freqEnvStart: 300, freqEnvEnd: 60, freqEnvDuration: 0.08 },
        { waveform: 'sine', frequency: 100, detune: 0, volume: 0.6, freqEnvStart: 200, freqEnvEnd: 50, freqEnvDuration: 0.06 },
      ],
      envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.08, duration: 0.2 },
      filters: [{ type: 'lowpass', cutoff: 1000, q: 1.2 }],
      reverb: { enabled: true, bypass: false, roomSize: 0.3, dampening: 0.6, mix: 0.15 },
      delay: { enabled: false, bypass: false, time: 0.15, feedback: 0.2, mix: 0.1 },
      distortion: { enabled: true, bypass: false, amount: 40, oversample: '2x', mix: 0.3 },
    },
  },
];

// ---------------------------------------------------------------------------
// Modifier keywords
// ---------------------------------------------------------------------------

interface ModifierMatch {
  matched: string[];
}

function applyModifiers(preset: SfxPreset, words: string[]): ModifierMatch {
  const matched: string[] = [];

  const has = (...kw: string[]) => {
    for (const k of kw) {
      if (words.includes(k)) {
        matched.push(k);
        return true;
      }
    }
    return false;
  };

  // Pitch modifiers
  if (has('deep', 'low', 'bass')) {
    for (const osc of preset.oscillators) {
      osc.frequency = Math.max(20, osc.frequency * 0.5);
      osc.freqEnvStart = Math.max(20, osc.freqEnvStart * 0.5);
      osc.freqEnvEnd = Math.max(20, osc.freqEnvEnd * 0.5);
    }
    for (const f of preset.filters) {
      f.cutoff = Math.max(20, f.cutoff * 0.5);
    }
  }

  if (has('high', 'bright', 'sharp')) {
    for (const osc of preset.oscillators) {
      osc.frequency = Math.min(20000, osc.frequency * 2);
      osc.freqEnvStart = Math.min(20000, osc.freqEnvStart * 2);
      osc.freqEnvEnd = Math.min(20000, osc.freqEnvEnd * 2);
    }
    for (const f of preset.filters) {
      f.cutoff = Math.min(20000, f.cutoff * 2);
    }
  }

  // Duration modifiers
  if (has('long', 'sustained', 'slow')) {
    preset.envelope.duration *= 2;
    preset.envelope.release *= 1.5;
    preset.envelope.decay *= 1.5;
  }

  if (has('short', 'quick', 'fast')) {
    preset.envelope.duration *= 0.5;
    preset.envelope.release *= 0.5;
    preset.envelope.decay *= 0.5;
  }

  // Effect modifiers
  if (has('echo', 'reverb', 'spacious', 'hall')) {
    preset.reverb.enabled = true;
    preset.reverb.roomSize = Math.min(1, preset.reverb.roomSize + 0.3);
    preset.reverb.mix = Math.min(1, preset.reverb.mix + 0.2);
  }

  if (has('distorted', 'dirty', 'gritty', 'harsh')) {
    preset.distortion.enabled = true;
    preset.distortion.amount = Math.min(400, preset.distortion.amount + 50);
    preset.distortion.mix = Math.min(1, preset.distortion.mix + 0.3);
    preset.distortion.oversample = '2x';
  }

  if (has('delay', 'repeat')) {
    preset.delay.enabled = true;
    preset.delay.time = 0.2;
    preset.delay.feedback = 0.4;
    preset.delay.mix = 0.25;
  }

  return { matched };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SmartGenerateResult {
  preset: SfxPreset;
  matchedKeywords: string[];
  matchedModifiers: string[];
}

/**
 * Generate synth parameters from a text prompt via keyword matching.
 * Returns immediately (no async, no server).
 */
export function smartGenerate(prompt: string): SmartGenerateResult {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  // Find best matching rule (most keyword hits)
  let bestRule: KeywordRule | null = null;
  let bestCount = 0;
  let bestMatched: string[] = [];

  for (const rule of KEYWORD_RULES) {
    const hits = rule.keywords.filter((kw) => words.includes(kw));
    if (hits.length > bestCount) {
      bestCount = hits.length;
      bestRule = rule;
      bestMatched = hits;
    }
  }

  // Fallback: generic noise burst
  if (!bestRule) {
    bestRule = {
      keywords: [],
      preset: {
        oscillators: [
          { waveform: 'noise', frequency: 440, detune: 0, volume: 0.6, freqEnvStart: 440, freqEnvEnd: 220, freqEnvDuration: 0.2 },
        ],
        envelope: { attack: 0.01, decay: 0.15, sustain: 0.2, release: 0.3, duration: 0.8 },
        filters: [{ type: 'lowpass', cutoff: 4000, q: 1.0 }],
        reverb: { enabled: true, bypass: false, roomSize: 0.3, dampening: 0.5, mix: 0.2 },
        delay: { enabled: false, bypass: false, time: 0.2, feedback: 0.3, mix: 0.15 },
        distortion: { enabled: false, bypass: false, amount: 0, oversample: 'none', mix: 0 },
      },
    };
  }

  // Deep-clone the preset data
  const preset: SfxPreset = {
    name: 'generated',
    description: prompt,
    oscillators: bestRule.preset.oscillators.map((o) => ({ ...o })),
    envelope: { ...bestRule.preset.envelope },
    filters: bestRule.preset.filters.map((f) => ({ ...f })),
    reverb: { ...bestRule.preset.reverb },
    delay: { ...bestRule.preset.delay },
    distortion: { ...bestRule.preset.distortion },
  };

  // Apply modifier keywords
  const modResult = applyModifiers(preset, words);

  return {
    preset,
    matchedKeywords: bestMatched,
    matchedModifiers: modResult.matched,
  };
}
