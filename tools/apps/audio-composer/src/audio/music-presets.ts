/**
 * Music loop presets per layer type.
 * Each preset describes the synthesis approach for generateLoop().
 */

import type { LayerId } from '../store/useComposerStore.js';

export type LoopStyle =
  // Bass
  | 'ambient_drone' | 'pulse_bass' | 'dark_rumble' | 'walking_bass'
  // Harmony
  | 'ethereal_pad' | 'dark_minor' | 'fifth_drone' | 'mystery_sus4'
  // Melody
  | 'pentatonic_flow' | 'arpeggiated' | 'fantasy_motif' | 'sparse_bells'
  // Percussion
  | 'subtle_pulse' | 'tribal' | 'minimal_kick' | 'march';

export interface MusicLoopPreset {
  id: LoopStyle;
  label: string;
  description: string;
}

export const LOOP_PRESETS: Record<LayerId, MusicLoopPreset[]> = {
  bass: [
    { id: 'ambient_drone', label: 'Ambient Drone', description: 'Low sine + detuned, gentle LFO' },
    { id: 'pulse_bass', label: 'Pulse Bass', description: '8th-note gated bass pulse' },
    { id: 'dark_rumble', label: 'Dark Rumble', description: 'Triangle + noise, ominous' },
    { id: 'walking_bass', label: 'Walking Bass', description: 'Ascending note sequence' },
  ],
  harmony: [
    { id: 'ethereal_pad', label: 'Ethereal Pad', description: 'Major triad, detuned and lush' },
    { id: 'dark_minor', label: 'Dark Minor', description: 'Minor triad, slow tremolo' },
    { id: 'fifth_drone', label: 'Fifth Drone', description: 'Open fifth, sustained' },
    { id: 'mystery_sus4', label: 'Mystery', description: 'Sus4 chord, ethereal' },
  ],
  melody: [
    { id: 'pentatonic_flow', label: 'Pentatonic Flow', description: 'Random walk on pentatonic scale' },
    { id: 'arpeggiated', label: 'Arpeggiated', description: 'Up/down arpeggio pattern' },
    { id: 'fantasy_motif', label: 'Fantasy Motif', description: 'Fixed melodic phrase' },
    { id: 'sparse_bells', label: 'Sparse Bells', description: 'Irregular bell-like notes' },
  ],
  percussion: [
    { id: 'subtle_pulse', label: 'Subtle Pulse', description: 'Kick + hi-hat pattern' },
    { id: 'tribal', label: 'Tribal', description: 'Kick + tom + shaker' },
    { id: 'minimal_kick', label: 'Minimal', description: 'Kick only, sparse' },
    { id: 'march', label: 'March', description: 'Kick-snare alternating' },
  ],
};
