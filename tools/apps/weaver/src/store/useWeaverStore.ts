import { create } from 'zustand';
import type { StemState, MarkerState } from '../lib/types.js';
import type { WeaverGroupConfig, WeaverProjectFile } from '../lib/projectTypes.js';
import { createEmptyGroup, createEmptyProject } from '../lib/projectTypes.js';
import { uniqueSlug } from '../lib/slugify.js';
import { decodeStemFile } from '../lib/importConfig.js';
import { computeWaveformPeaks } from '../lib/waveformPeaks.js';
import {
  saveWeaverProject,
  loadWeaverProject,
  listWeaverProjects,
  loadStemAudio,
  saveStemFile,
} from '../lib/projectFs.js';

let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

// ── Undo/Redo snapshot (lightweight — no AudioBuffers) ──

interface UndoSnapshot {
  stems: { sourcePath: string; initialVolume: number; muted: boolean; soloed: boolean }[];
  bpm: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  markers: MarkerState[];
}

const MAX_UNDO = 50;

function captureSnapshot(s: Pick<WeaverStore, 'stems' | 'bpm' | 'loopStart' | 'loopEnd' | 'loopEnabled' | 'markers'>): UndoSnapshot {
  return {
    stems: s.stems.map((st) => ({
      sourcePath: st.sourcePath, initialVolume: st.initialVolume,
      muted: st.muted, soloed: st.soloed,
    })),
    bpm: s.bpm,
    loopStart: s.loopStart,
    loopEnd: s.loopEnd,
    loopEnabled: s.loopEnabled,
    markers: s.markers.map((m) => ({ ...m })),
  };
}

interface WeaverStore {
  // === Project-level ===
  projectName: string;
  sampleRate: number;
  groups: WeaverGroupConfig[];
  dirty: boolean;

  projectRootHandle: FileSystemDirectoryHandle | null;
  setProjectRootHandle: (h: FileSystemDirectoryHandle | null) => void;
  saveProject: () => Promise<void>;
  loadProject: (name: string) => Promise<void>;
  listProjects: () => Promise<string[]>;
  newProject: (name: string) => void;

  addGroup: (name: string) => void;
  duplicateGroup: (id: string) => void;
  deleteGroup: (id: string) => void;
  renameGroup: (id: string, name: string) => void;

  // === Active group ===
  activeGroupId: string | null;
  switchGroup: (id: string) => Promise<void>;
  flushActiveGroup: () => void;

  stems: StemState[];
  bpm: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  markers: MarkerState[];
  isPlaying: boolean;
  playheadFrame: number;

  addStem: (file: File) => Promise<void>;
  removeStem: (index: number) => void;
  setStemVolume: (index: number, volume: number) => void;
  toggleMute: (index: number) => void;
  toggleSolo: (index: number) => void;
  setLoopStart: (frame: number) => void;
  setLoopEnd: (frame: number) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setBpm: (bpm: number) => void;
  setGroupName: (name: string) => void;
  addMarker: (frame: number, name?: string) => void;
  removeMarker: (index: number) => void;
  updateMarker: (index: number, patch: Partial<MarkerState>) => void;
  moveMarker: (index: number, frame: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlayheadFrame: (frame: number) => void;

  // Undo/Redo
  undoStack: UndoSnapshot[];
  redoStack: UndoSnapshot[];
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  viewStartFrame: number;
  viewEndFrame: number;
  setView: (start: number, end: number) => void;
  zoomToFit: () => void;
  maxFrames: () => number;
}

export const useWeaverStore = create<WeaverStore>((set, get) => ({
  projectName: 'untitled',
  sampleRate: 44100,
  groups: [],
  dirty: false,

  projectRootHandle: null,
  setProjectRootHandle: (h) => set({ projectRootHandle: h }),

  newProject: (name) => {
    const project = createEmptyProject(name, get().sampleRate);
    set({
      projectName: project.name,
      sampleRate: project.sample_rate,
      groups: [],
      activeGroupId: null,
      stems: [],
      bpm: 120,
      loopStart: 0,
      loopEnd: 0,
      loopEnabled: true,
      markers: [],
      playheadFrame: 0,
      isPlaying: false,
      viewStartFrame: 0,
      viewEndFrame: 0,
      dirty: false,
    });
  },

  saveProject: async () => {
    const s = get();
    if (!s.projectRootHandle) {
      console.warn('[weaver] Cannot save: no project root handle');
      return;
    }
    s.flushActiveGroup();
    const state = get();
    const project: WeaverProjectFile = {
      version: 1,
      name: state.projectName,
      sample_rate: state.sampleRate,
      groups: state.groups,
    };
    try {
      await saveWeaverProject(state.projectRootHandle!, project);
      set({ dirty: false });
      console.info(`[weaver] Saved to: tools_data/weaver/${project.name}.weaver (${project.groups.length} groups)`);
    } catch (e) {
      console.error('[weaver] Failed to save project:', e);
    }
  },

  loadProject: async (name) => {
    const s = get();
    if (!s.projectRootHandle) {
      console.warn('[weaver] Cannot load: no project root handle');
      return;
    }
    console.info(`[weaver] Loading project: ${name}`);
    const project = await loadWeaverProject(s.projectRootHandle, name);
    console.info(`[weaver] Loaded: ${name}, ${project.groups.length} groups`);
    // Use the filename as projectName (it's the key for save/load)
    set({
      projectName: name,
      sampleRate: project.sample_rate,
      groups: project.groups,
      activeGroupId: null,
      stems: [],
      bpm: 120,
      loopStart: 0,
      loopEnd: 0,
      loopEnabled: true,
      markers: [],
      playheadFrame: 0,
      isPlaying: false,
      viewStartFrame: 0,
      viewEndFrame: 0,
      dirty: false,
    });
    if (project.groups.length > 0) {
      await get().switchGroup(project.groups[0].id);
    }
  },

  listProjects: async () => {
    const s = get();
    if (!s.projectRootHandle) return [];
    return listWeaverProjects(s.projectRootHandle);
  },

  addGroup: (name) => {
    const s = get();
    const existingIds = s.groups.map((g) => g.id);
    const id = uniqueSlug(name, existingIds);
    const group = createEmptyGroup(id, name);
    set((prev) => ({ groups: [...prev.groups, group], dirty: true }));
  },

  duplicateGroup: (id) => {
    const s = get();
    const source = s.groups.find((g) => g.id === id);
    if (!source) return;
    if (s.activeGroupId === id) s.flushActiveGroup();
    const updated = get();
    const freshSource = updated.groups.find((g) => g.id === id)!;
    const newName = `${freshSource.name} (copy)`;
    const existingIds = updated.groups.map((g) => g.id);
    const newId = uniqueSlug(newName, existingIds);
    const copy: WeaverGroupConfig = {
      ...JSON.parse(JSON.stringify(freshSource)),
      id: newId,
      name: newName,
    };
    set((prev) => ({ groups: [...prev.groups, copy], dirty: true }));
  },

  deleteGroup: (id) => {
    const s = get();
    const remaining = s.groups.filter((g) => g.id !== id);
    const wasActive = s.activeGroupId === id;
    set({
      groups: remaining,
      dirty: true,
      ...(wasActive
        ? {
            activeGroupId: null,
            stems: [],
            bpm: 120,
            loopStart: 0,
            loopEnd: 0,
            loopEnabled: true,
            markers: [],
            playheadFrame: 0,
            isPlaying: false,
            viewStartFrame: 0,
            viewEndFrame: 0,
          }
        : {}),
    });
  },

  renameGroup: (id, name) => {
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, name } : g)),
      dirty: true,
    }));
  },

  activeGroupId: null,

  flushActiveGroup: () => {
    const s = get();
    if (!s.activeGroupId) return;
    const updated = s.groups.map((g) => {
      if (g.id !== s.activeGroupId) return g;
      return {
        ...g,
        bpm: s.bpm,
        loop_start: s.loopStart,
        loop_end: s.loopEnd,
        loop_enabled: s.loopEnabled,
        markers: s.markers.map((m) => ({ frame: m.frame, name: m.name })),
        stems: s.stems.map((st) => ({
          source: st.sourcePath,
          initial_volume: st.initialVolume,
          muted: st.muted,
          soloed: st.soloed,
        })),
      };
    });
    set({ groups: updated });
  },

  switchGroup: async (id) => {
    const s = get();
    if (s.activeGroupId) s.flushActiveGroup();
    set({ isPlaying: false });
    const state = get();
    const group = state.groups.find((g) => g.id === id);
    if (!group) return;
    const ctx = getAudioContext();
    const loadedStems: StemState[] = [];
    for (const stemCfg of group.stems) {
      let audioBuffer: AudioBuffer | null = null;
      let waveformPeaks: Float32Array | null = null;
      try {
        if (state.projectRootHandle) {
          audioBuffer = await loadStemAudio(
            state.projectRootHandle,
            stemCfg.source,
            ctx,
          );
          waveformPeaks = computeWaveformPeaks(audioBuffer);
        }
      } catch (e) {
        console.warn(`[weaver] Failed to load stem: ${stemCfg.source}`, e);
      }
      loadedStems.push({
        fileName: stemCfg.source.split('/').pop() ?? stemCfg.source,
        sourcePath: stemCfg.source,
        initialVolume: stemCfg.initial_volume,
        audioBuffer,
        waveformPeaks,
        muted: stemCfg.muted,
        soloed: stemCfg.soloed,
      });
    }
    const maxLen = Math.max(0, ...loadedStems.map((st) => st.audioBuffer?.length ?? 0));
    set({
      activeGroupId: id,
      stems: loadedStems,
      bpm: group.bpm,
      loopStart: group.loop_start,
      loopEnd: group.loop_end,
      loopEnabled: group.loop_enabled,
      markers: group.markers.map((m) => ({ ...m })),
      playheadFrame: 0,
      viewStartFrame: 0,
      viewEndFrame: maxLen > 0 ? maxLen : 44100,
      undoStack: [],
      redoStack: [],
    });
  },

  stems: [],
  bpm: 120,
  loopStart: 0,
  loopEnd: 0,
  loopEnabled: true,
  markers: [],
  isPlaying: false,
  playheadFrame: 0,

  addStem: async (file: File) => {
    get().pushUndo();
    const ctx = getAudioContext();
    const { audioBuffer, waveformPeaks } = await decodeStemFile(file, ctx);
    const s = get();
    const sourcePath = `assets/audio/${s.activeGroupId ?? s.projectName}/${file.name}`;

    // Copy audio file into project directory so it persists across sessions
    if (s.projectRootHandle) {
      try {
        await saveStemFile(s.projectRootHandle, sourcePath, file);
      } catch (e) {
        console.warn(`[weaver] Failed to copy stem to project: ${sourcePath}`, e);
      }
    }

    const stem: StemState = {
      fileName: file.name,
      sourcePath,
      initialVolume: 1.0,
      audioBuffer,
      waveformPeaks,
      muted: false,
      soloed: false,
    };
    set((prev) => {
      const stems = [...prev.stems, stem];
      const maxLen = Math.max(...stems.map((st) => st.audioBuffer?.length ?? 0));
      return {
        stems,
        viewEndFrame: prev.viewEndFrame === 0 ? maxLen : prev.viewEndFrame,
        dirty: true,
      };
    });
  },

  removeStem: (index) => {
    get().pushUndo();
    set((s) => ({ stems: s.stems.filter((_, i) => i !== index), dirty: true }));
  },

  setStemVolume: (index, volume) =>
    set((s) => ({
      stems: s.stems.map((st, i) => i === index ? { ...st, initialVolume: volume } : st),
      dirty: true,
    })),

  toggleMute: (index) => {
    get().pushUndo();
    set((s) => ({
      stems: s.stems.map((st, i) => i === index ? { ...st, muted: !st.muted } : st),
      dirty: true,
    }));
  },

  toggleSolo: (index) => {
    get().pushUndo();
    set((s) => ({
      stems: s.stems.map((st, i) => i === index ? { ...st, soloed: !st.soloed } : st),
      dirty: true,
    }));
  },

  setLoopStart: (frame) => { get().pushUndo(); set({ loopStart: Math.max(0, frame), dirty: true }); },
  setLoopEnd: (frame) => { get().pushUndo(); set({ loopEnd: Math.max(0, frame), dirty: true }); },
  setLoopEnabled: (enabled) => set({ loopEnabled: enabled, dirty: true }),
  setBpm: (bpm) => { get().pushUndo(); set({ bpm: Math.max(1, Math.min(999, bpm || 120)), dirty: true }); },
  setGroupName: (name) => {
    const s = get();
    if (s.activeGroupId) s.renameGroup(s.activeGroupId, name);
  },

  addMarker: (frame, name) => {
    get().pushUndo();
    set((s) => ({
      markers: [...s.markers, { frame, name: name ?? `Marker ${s.markers.length + 1}` }],
      dirty: true,
    }));
  },
  removeMarker: (index) => {
    get().pushUndo();
    set((s) => ({ markers: s.markers.filter((_, i) => i !== index), dirty: true }));
  },
  updateMarker: (index, patch) =>
    set((s) => ({
      markers: s.markers.map((m, i) => i === index ? { ...m, ...patch } : m),
      dirty: true,
    })),
  moveMarker: (index, frame) => {
    get().pushUndo();
    set((s) => ({
      markers: s.markers.map((m, i) => i === index ? { ...m, frame } : m),
      dirty: true,
    }));
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlayheadFrame: (frame) => set({ playheadFrame: frame }),

  // Undo/Redo
  undoStack: [],
  redoStack: [],
  pushUndo: () => {
    const s = get();
    const snapshot = captureSnapshot(s);
    set((prev) => ({
      undoStack: [...prev.undoStack.slice(-(MAX_UNDO - 1)), snapshot],
      redoStack: [],
    }));
  },
  undo: () => {
    const s = get();
    if (s.undoStack.length === 0) return;
    const current = captureSnapshot(s);
    const prev = s.undoStack[s.undoStack.length - 1];
    // Restore stems: match by sourcePath to preserve AudioBuffers
    const restoredStems = prev.stems.map((ps) => {
      const existing = s.stems.find((st) => st.sourcePath === ps.sourcePath);
      return {
        fileName: existing?.fileName ?? ps.sourcePath.split('/').pop() ?? '',
        sourcePath: ps.sourcePath,
        initialVolume: ps.initialVolume,
        audioBuffer: existing?.audioBuffer ?? null,
        waveformPeaks: existing?.waveformPeaks ?? null,
        muted: ps.muted,
        soloed: ps.soloed,
      };
    });
    set({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, current],
      stems: restoredStems,
      bpm: prev.bpm,
      loopStart: prev.loopStart,
      loopEnd: prev.loopEnd,
      loopEnabled: prev.loopEnabled,
      markers: prev.markers.map((m) => ({ ...m })),
      dirty: true,
    });
  },
  redo: () => {
    const s = get();
    if (s.redoStack.length === 0) return;
    const current = captureSnapshot(s);
    const next = s.redoStack[s.redoStack.length - 1];
    const restoredStems = next.stems.map((ns) => {
      const existing = s.stems.find((st) => st.sourcePath === ns.sourcePath);
      return {
        fileName: existing?.fileName ?? ns.sourcePath.split('/').pop() ?? '',
        sourcePath: ns.sourcePath,
        initialVolume: ns.initialVolume,
        audioBuffer: existing?.audioBuffer ?? null,
        waveformPeaks: existing?.waveformPeaks ?? null,
        muted: ns.muted,
        soloed: ns.soloed,
      };
    });
    set({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, current],
      stems: restoredStems,
      bpm: next.bpm,
      loopStart: next.loopStart,
      loopEnd: next.loopEnd,
      loopEnabled: next.loopEnabled,
      markers: next.markers.map((m) => ({ ...m })),
      dirty: true,
    });
  },
  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  viewStartFrame: 0,
  viewEndFrame: 0,
  setView: (start, end) => set({ viewStartFrame: start, viewEndFrame: end }),
  zoomToFit: () => {
    const max = get().maxFrames();
    set({ viewStartFrame: 0, viewEndFrame: max > 0 ? max : 44100 });
  },
  maxFrames: () => {
    const s = get();
    if (s.stems.length === 0) return 0;
    return Math.max(...s.stems.map((st) => st.audioBuffer?.length ?? 0));
  },
}));
