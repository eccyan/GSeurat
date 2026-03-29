import { create } from 'zustand';
import type { VfxPreset, VfxElement, VfxProject, ElementType, PlyReference } from './types.js';
// Keep aliases for compatibility during migration
type VfxLayer = VfxElement;
type LayerType = ElementType;
import type { PlyPoint } from '../lib/plyLoader.js';

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

/**
 * Mutable ref for high-frequency playback time updates.
 * R3F useFrame callbacks read this directly (no React re-render).
 * Zustand state is synced at lower frequency (~10Hz) for UI updates.
 */
export const playbackTimeRef = { current: 0 };

/** In-memory cache of loaded PLY points per scene ID (not persisted). */
export const scenePointsCache = new Map<string, PlyPoint[]>();

export interface VfxStoreState {
  // Data
  presets: VfxPreset[];
  selectedPresetId: string | null;
  selectedLayerId: string | null;

  // Project
  projectHandle: FileSystemDirectoryHandle | null;
  projectName: string;
  isDirty: boolean;

  // Scenes (PLY)
  scenes: PlyReference[];
  activeSceneId: string | null;
  scenePoints: PlyPoint[];

  // UI
  selectedView: 'layer' | 'preset-settings';

  // Visibility
  showGizmos: boolean;
  showPointCloud: boolean;
  mutedLayerIds: string[];
  soloLayerIds: string[];

  // Playback
  playing: boolean;
  playbackTime: number;

  // Actions — project
  setProjectHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setProjectName: (name: string) => void;
  saveProjectData: () => VfxProject;
  loadProjectData: (data: VfxProject) => void;

  // Actions — presets
  addPreset: (name?: string) => void;
  removePreset: (id: string) => void;
  updatePreset: (id: string, patch: Partial<VfxPreset>) => void;
  selectPreset: (id: string | null) => void;

  // Actions — layers
  addLayer: (presetId: string, type: LayerType, name: string, start: number, duration: number) => void;
  updateLayer: (presetId: string, layerId: string, patch: Partial<VfxLayer>) => void;
  removeLayer: (presetId: string, layerId: string) => void;
  selectLayer: (id: string | null) => void;
  setSelectedView: (view: 'layer' | 'preset-settings') => void;

  // Actions — scenes
  addScene: (ref: PlyReference) => void;
  removeScene: (id: string) => void;
  setActiveScene: (id: string | null) => void;
  setScenePoints: (points: PlyPoint[]) => void;

  // Actions — visibility
  toggleGizmos: () => void;
  togglePointCloud: () => void;
  toggleLayerMute: (layerId: string) => void;
  toggleLayerSolo: (layerId: string) => void;
  isLayerVisible: (layerId: string) => boolean;

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
  projectHandle: null,
  projectName: 'Untitled',
  isDirty: false,
  selectedPresetId: null,
  selectedLayerId: null,
  scenes: [] as PlyReference[],
  activeSceneId: null,
  scenePoints: [] as PlyPoint[],
  selectedView: 'layer' as const,
  showGizmos: true,
  showPointCloud: true,
  mutedLayerIds: [] as string[],
  soloLayerIds: [] as string[],
  playing: false,
  playbackTime: 0,

  setProjectHandle: (handle) => set({ projectHandle: handle }),
  setProjectName: (name) => set({ projectName: name }),

  saveProjectData: () => ({
    version: 2 as const,
    presets: get().presets,
    scenes: get().scenes.length > 0 ? get().scenes : undefined,
    activeSceneId: get().activeSceneId ?? undefined,
  }),

  loadProjectData: (data) => {
    // Migrate v1 presets: "layers" → "elements"
    const presets = (data.presets ?? []).map((p: any) => ({
      ...p,
      elements: p.elements ?? p.layers ?? [],
      layers: undefined,
    }));
    set({
      presets,
      scenes: data.scenes ?? [],
      activeSceneId: data.activeSceneId ?? null,
      selectedPresetId: data.presets.length > 0 ? data.presets[0].id : null,
      selectedLayerId: null,
      isDirty: false,
    });
  },

  addPreset: (name?) => {
    const preset: VfxPreset = {
      id: genId('vfx'),
      name: name ?? 'New VFX',
      duration: 3.0,
      elements: [],
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

  addLayer: (presetId, type, name, start, duration) => {
    const layer: VfxLayer = {
      id: genId('layer'),
      name,
      type,
      start,
      duration,
    };
    set({
      presets: get().presets.map((p) =>
        p.id === presetId ? { ...p, elements: [...p.elements, layer] } : p
      ),
      selectedLayerId: layer.id,
    });
  },

  updateLayer: (presetId, layerId, patch) => set({
    presets: get().presets.map((p) =>
      p.id === presetId
        ? { ...p, elements: p.elements.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) }
        : p
    ),
  }),

  removeLayer: (presetId, layerId) => {
    const state = get();
    set({
      presets: state.presets.map((p) =>
        p.id === presetId ? { ...p, elements: p.elements.filter((l) => l.id !== layerId) } : p
      ),
      selectedLayerId: state.selectedLayerId === layerId ? null : state.selectedLayerId,
    });
  },

  selectLayer: (id) => set({ selectedLayerId: id, selectedView: 'layer' }),
  setSelectedView: (view) => set({ selectedView: view }),

  addScene: (ref) => set((s) => ({ scenes: [...s.scenes, ref] })),
  removeScene: (id) => {
    scenePointsCache.delete(id);
    set((s) => ({
      scenes: s.scenes.filter((sc) => sc.id !== id),
      activeSceneId: s.activeSceneId === id ? null : s.activeSceneId,
      scenePoints: s.activeSceneId === id ? [] : s.scenePoints,
    }));
  },
  setActiveScene: (id) => {
    const cached = id ? scenePointsCache.get(id) : undefined;
    set({ activeSceneId: id, scenePoints: cached ?? [] });
  },
  setScenePoints: (points) => {
    const id = get().activeSceneId;
    if (id) scenePointsCache.set(id, points);
    set({ scenePoints: points });
  },

  toggleGizmos: () => set((s) => ({ showGizmos: !s.showGizmos })),
  togglePointCloud: () => set((s) => ({ showPointCloud: !s.showPointCloud })),
  toggleLayerMute: (layerId) => set((s) => {
    const muted = [...s.mutedLayerIds];
    const idx = muted.indexOf(layerId);
    if (idx >= 0) muted.splice(idx, 1); else muted.push(layerId);
    return { mutedLayerIds: muted };
  }),
  toggleLayerSolo: (layerId) => set((s) => {
    const solo = [...s.soloLayerIds];
    const idx = solo.indexOf(layerId);
    if (idx >= 0) solo.splice(idx, 1); else solo.push(layerId);
    return { soloLayerIds: solo };
  }),
  isLayerVisible: (layerId) => {
    const s = get();
    if (s.mutedLayerIds.includes(layerId)) return false;
    if (s.soloLayerIds.length > 0 && !s.soloLayerIds.includes(layerId)) return false;
    return true;
  },

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  stop: () => { playbackTimeRef.current = 0; set({ playing: false, playbackTime: 0 }); },
  setPlaybackTime: (t) => { playbackTimeRef.current = t; set({ playbackTime: t }); },

  selectedPreset: () => {
    const state = get();
    return state.presets.find((p) => p.id === state.selectedPresetId);
  },
  selectedLayer: () => {
    const state = get();
    const preset = state.presets.find((p) => p.id === state.selectedPresetId);
    return preset?.elements.find((l) => l.id === state.selectedLayerId);
  },
}));
