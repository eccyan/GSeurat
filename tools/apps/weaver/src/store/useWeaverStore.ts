import { create } from 'zustand';
import type { StemState, MarkerState, MusicConfigV2 } from '../lib/types.js';
import { exportMusicConfig } from '../lib/exportConfig.js';
import { decodeStemFile } from '../lib/importConfig.js';

interface WeaverStore {
  groupId: number;
  groupName: string;
  sampleRate: number;
  bpm: number;
  setGroupId: (id: number) => void;
  setGroupName: (name: string) => void;
  setSampleRate: (sr: number) => void;
  setBpm: (bpm: number) => void;

  stems: StemState[];
  addStem: (file: File) => Promise<void>;
  removeStem: (index: number) => void;
  setStemVolume: (index: number, volume: number) => void;
  toggleMute: (index: number) => void;
  toggleSolo: (index: number) => void;

  loopStart: number;
  loopEnd: number;
  setLoopStart: (frame: number) => void;
  setLoopEnd: (frame: number) => void;
  loopEnabled: boolean;
  setLoopEnabled: (enabled: boolean) => void;

  markers: MarkerState[];
  addMarker: (frame: number, name?: string) => void;
  removeMarker: (index: number) => void;
  updateMarker: (index: number, patch: Partial<MarkerState>) => void;
  moveMarker: (index: number, frame: number) => void;

  isPlaying: boolean;
  playheadFrame: number;
  setIsPlaying: (playing: boolean) => void;
  setPlayheadFrame: (frame: number) => void;

  viewStartFrame: number;
  viewEndFrame: number;
  setView: (start: number, end: number) => void;
  zoomToFit: () => void;

  getExportData: () => MusicConfigV2;
  maxFrames: () => number;
}

let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export const useWeaverStore = create<WeaverStore>((set, get) => ({
  groupId: 1,
  groupName: 'untitled',
  sampleRate: 44100,
  bpm: 120,
  setGroupId: (id) => set({ groupId: id }),
  setGroupName: (name) => set({ groupName: name }),
  setSampleRate: (sr) => set({ sampleRate: sr }),
  setBpm: (bpm) => set({ bpm }),

  stems: [],
  addStem: async (file: File) => {
    const ctx = getAudioContext();
    const { audioBuffer, waveformPeaks } = await decodeStemFile(file, ctx);
    const stem: StemState = {
      fileName: file.name,
      sourcePath: `assets/audio/${get().groupName}/${file.name}`,
      initialVolume: 1.0,
      audioBuffer,
      waveformPeaks,
      muted: false,
      soloed: false,
    };
    set((s) => {
      const stems = [...s.stems, stem];
      const maxLen = Math.max(...stems.map(st => st.audioBuffer?.length ?? 0));
      return { stems, viewEndFrame: s.viewEndFrame === 0 ? maxLen : s.viewEndFrame };
    });
  },
  removeStem: (index) => set((s) => ({ stems: s.stems.filter((_, i) => i !== index) })),
  setStemVolume: (index, volume) =>
    set((s) => ({ stems: s.stems.map((st, i) => i === index ? { ...st, initialVolume: volume } : st) })),
  toggleMute: (index) =>
    set((s) => ({ stems: s.stems.map((st, i) => i === index ? { ...st, muted: !st.muted } : st) })),
  toggleSolo: (index) =>
    set((s) => ({ stems: s.stems.map((st, i) => i === index ? { ...st, soloed: !st.soloed } : st) })),

  loopStart: 0,
  loopEnd: 0,
  setLoopStart: (frame) => set({ loopStart: Math.max(0, frame) }),
  setLoopEnd: (frame) => set({ loopEnd: Math.max(0, frame) }),
  loopEnabled: true,
  setLoopEnabled: (enabled) => set({ loopEnabled: enabled }),

  markers: [],
  addMarker: (frame, name) =>
    set((s) => ({ markers: [...s.markers, { frame, name: name ?? `Marker ${s.markers.length + 1}` }] })),
  removeMarker: (index) => set((s) => ({ markers: s.markers.filter((_, i) => i !== index) })),
  updateMarker: (index, patch) =>
    set((s) => ({ markers: s.markers.map((m, i) => i === index ? { ...m, ...patch } : m) })),
  moveMarker: (index, frame) =>
    set((s) => ({ markers: s.markers.map((m, i) => i === index ? { ...m, frame } : m) })),

  isPlaying: false,
  playheadFrame: 0,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlayheadFrame: (frame) => set({ playheadFrame: frame }),

  viewStartFrame: 0,
  viewEndFrame: 0,
  setView: (start, end) => set({ viewStartFrame: start, viewEndFrame: end }),
  zoomToFit: () => {
    const max = get().maxFrames();
    set({ viewStartFrame: 0, viewEndFrame: max > 0 ? max : 44100 });
  },

  getExportData: () => {
    const s = get();
    return exportMusicConfig({
      groupId: s.groupId, groupName: s.groupName, sampleRate: s.sampleRate, bpm: s.bpm,
      loopStart: s.loopStart, loopEnd: s.loopEnd, markers: s.markers, stems: s.stems,
    });
  },

  maxFrames: () => {
    const s = get();
    if (s.stems.length === 0) return 0;
    return Math.max(...s.stems.map(st => st.audioBuffer?.length ?? 0));
  },
}));
