import { create } from 'zustand';
import type { VfxPreset, VfxLayer, VfxPhases, LayerType, Phase } from './types.js';

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

export interface VfxStoreState {
  // Data
  presets: VfxPreset[];
  selectedPresetId: string | null;
  selectedLayerId: string | null;

  // Playback
  playing: boolean;
  playbackTime: number;

  // Actions — presets
  addPreset: (name?: string) => void;
  removePreset: (id: string) => void;
  updatePreset: (id: string, patch: Partial<VfxPreset>) => void;
  selectPreset: (id: string | null) => void;

  // Actions — layers
  addLayer: (presetId: string, type: LayerType, name: string, start: number, duration: number, phase?: Phase) => void;
  updateLayer: (presetId: string, layerId: string, patch: Partial<VfxLayer>) => void;
  removeLayer: (presetId: string, layerId: string) => void;
  selectLayer: (id: string | null) => void;

  // Actions — playback
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPlaybackTime: (t: number) => void;

  // Getters
  selectedPreset: () => VfxPreset | undefined;
  selectedLayer: () => VfxLayer | undefined;
}

export const useVfxStore = create<VfxStoreState>((set, get) => ({
  presets: [],
  selectedPresetId: null,
  selectedLayerId: null,
  playing: false,
  playbackTime: 0,

  addPreset: (name?) => {
    const preset: VfxPreset = {
      id: genId('vfx'),
      name: name ?? 'New VFX',
      duration: 3.0,
      phases: { anticipation: 0.9, impact: 1.5 },
      layers: [],
    };
    set({ presets: [...get().presets, preset], selectedPresetId: preset.id });
  },

  removePreset: (id) => {
    const state = get();
    set({
      presets: state.presets.filter((p) => p.id !== id),
      selectedPresetId: state.selectedPresetId === id ? null : state.selectedPresetId,
    });
  },

  updatePreset: (id, patch) => set({
    presets: get().presets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }),

  selectPreset: (id) => set({ selectedPresetId: id, selectedLayerId: null }),

  addLayer: (presetId, type, name, start, duration, phase = 'custom') => {
    const layer: VfxLayer = {
      id: genId('layer'),
      name,
      type,
      phase,
      start,
      duration,
    };
    set({
      presets: get().presets.map((p) =>
        p.id === presetId ? { ...p, layers: [...p.layers, layer] } : p
      ),
      selectedLayerId: layer.id,
    });
  },

  updateLayer: (presetId, layerId, patch) => set({
    presets: get().presets.map((p) =>
      p.id === presetId
        ? { ...p, layers: p.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) }
        : p
    ),
  }),

  removeLayer: (presetId, layerId) => {
    const state = get();
    set({
      presets: state.presets.map((p) =>
        p.id === presetId ? { ...p, layers: p.layers.filter((l) => l.id !== layerId) } : p
      ),
      selectedLayerId: state.selectedLayerId === layerId ? null : state.selectedLayerId,
    });
  },

  selectLayer: (id) => set({ selectedLayerId: id }),

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  stop: () => set({ playing: false, playbackTime: 0 }),
  setPlaybackTime: (t) => set({ playbackTime: t }),

  selectedPreset: () => {
    const state = get();
    return state.presets.find((p) => p.id === state.selectedPresetId);
  },
  selectedLayer: () => {
    const state = get();
    const preset = state.presets.find((p) => p.id === state.selectedPresetId);
    return preset?.layers.find((l) => l.id === state.selectedLayerId);
  },
}));
