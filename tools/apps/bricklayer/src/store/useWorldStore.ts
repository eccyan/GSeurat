import { create } from 'zustand';
import type {
  WorldManifest,
  WorldChunk,
  StreamingVolumeData,
} from '@gseurat/project-root';
import { createEmptyManifest, chunkGridKey } from '@gseurat/project-root';

interface WorldSelection {
  type: 'chunk' | 'streaming_volume';
  id: string;
}

interface WorldStoreState {
  manifest: WorldManifest;
  loaded: boolean;
  dirty: boolean;
  selectedEntity: WorldSelection | null;
  editingChunkGrid: [number, number, number] | null;

  setGridCellSize: (size: [number, number, number]) => void;

  addChunk: (grid: [number, number, number]) => void;
  updateChunk: (gridKey: string, patch: Partial<WorldChunk>) => void;
  removeChunk: (gridKey: string) => void;

  addStreamingVolume: () => void;
  updateStreamingVolume: (id: string, patch: Partial<StreamingVolumeData>) => void;
  removeStreamingVolume: (id: string) => void;

  setSelectedEntity: (sel: WorldSelection | null) => void;

  enterChunk: (grid: [number, number, number]) => void;
  exitChunk: () => void;

  loadManifest: (data: WorldManifest) => void;
  saveManifest: () => WorldManifest;
  newWorld: () => void;
}

let nextSvId = 1;

export const useWorldStore = create<WorldStoreState>((set, get) => ({
  manifest: createEmptyManifest(),
  loaded: false,
  dirty: false,
  selectedEntity: null,
  editingChunkGrid: null,

  setGridCellSize: (size) =>
    set((s) => ({
      manifest: { ...s.manifest, grid_cell_size: size },
      dirty: true,
    })),

  addChunk: (grid) =>
    set((s) => {
      const key = chunkGridKey(grid);
      const exists = s.manifest.chunks.some((c) => chunkGridKey(c.grid) === key);
      if (exists) return s;
      const chunk: WorldChunk = { grid, ply_file: '' };
      return {
        manifest: { ...s.manifest, chunks: [...s.manifest.chunks, chunk] },
        dirty: true,
      };
    }),

  updateChunk: (gridKey, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        chunks: s.manifest.chunks.map((c) =>
          chunkGridKey(c.grid) === gridKey ? { ...c, ...patch } : c,
        ),
      },
      dirty: true,
    })),

  removeChunk: (gridKey) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        chunks: s.manifest.chunks.filter((c) => chunkGridKey(c.grid) !== gridKey),
      },
      selectedEntity:
        s.selectedEntity?.type === 'chunk' && s.selectedEntity.id === gridKey
          ? null
          : s.selectedEntity,
      dirty: true,
    })),

  addStreamingVolume: () =>
    set((s) => {
      const id = `sv_${nextSvId++}`;
      const vol: StreamingVolumeData = {
        id,
        shape: 'box',
        position: [0, 0, 0],
        half_extents: [8, 8, 8],
        preload_target_ids: [],
      };
      return {
        manifest: {
          ...s.manifest,
          streaming_volumes: [...s.manifest.streaming_volumes, vol],
        },
        selectedEntity: { type: 'streaming_volume', id },
        dirty: true,
      };
    }),

  updateStreamingVolume: (id, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        streaming_volumes: s.manifest.streaming_volumes.map((v: StreamingVolumeData) =>
          v.id === id ? { ...v, ...patch } : v,
        ),
      },
      dirty: true,
    })),

  removeStreamingVolume: (id) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        streaming_volumes: s.manifest.streaming_volumes.filter((v: StreamingVolumeData) => v.id !== id),
      },
      selectedEntity:
        s.selectedEntity?.type === 'streaming_volume' && s.selectedEntity.id === id
          ? null
          : s.selectedEntity,
      dirty: true,
    })),

  setSelectedEntity: (sel) => set({ selectedEntity: sel }),

  enterChunk: (grid) => set({ editingChunkGrid: grid }),
  exitChunk: () => set({ editingChunkGrid: null }),

  loadManifest: (data) => {
    const maxSv = data.streaming_volumes.reduce((max: number, v: StreamingVolumeData) => {
      const n = parseInt(v.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextSvId = maxSv + 1;
    set({ manifest: data, loaded: true, dirty: false, selectedEntity: null, editingChunkGrid: null });
  },

  saveManifest: () => get().manifest,

  newWorld: () => {
    nextSvId = 1;
    set({
      manifest: createEmptyManifest(),
      loaded: true,
      dirty: false,
      selectedEntity: null,
      editingChunkGrid: null,
    });
  },
}));
