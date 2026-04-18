import { create } from 'zustand';
import type {
  WorldManifest,
  WorldChunk,
  StreamingVolumeData,
  WorldInstance,
  WorldPortal,
} from '@gseurat/project-root';
import { createEmptyManifest, chunkGridKey } from '@gseurat/project-root';

interface WorldSelection {
  type: 'chunk' | 'streaming_volume' | 'instance' | 'portal';
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

  addInstance: (displayName: string, sceneFile: string) => void;
  updateInstance: (id: string, patch: Partial<WorldInstance>) => void;
  removeInstance: (id: string) => void;

  addPortal: () => void;
  updatePortal: (id: string, patch: Partial<WorldPortal>) => void;
  removePortal: (id: string) => void;

  setSelectedEntity: (sel: WorldSelection | null) => void;

  enterChunk: (grid: [number, number, number]) => void;
  exitChunk: () => void;

  loadManifest: (data: WorldManifest) => void;
  saveManifest: () => WorldManifest;
  newWorld: () => void;
}

let nextSvId = 1;
let nextInstId = 1;
let nextPortalId = 1;

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

  addInstance: (displayName, sceneFile) =>
    set((s) => {
      const id = `inst_${nextInstId++}`;
      const inst: WorldInstance = { id, display_name: displayName, scene_file: sceneFile };
      return {
        manifest: {
          ...s.manifest,
          instances: [...s.manifest.instances, inst],
        },
        selectedEntity: { type: 'instance', id },
        dirty: true,
      };
    }),

  updateInstance: (id, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        instances: s.manifest.instances.map((i) =>
          i.id === id ? { ...i, ...patch } : i,
        ),
      },
      dirty: true,
    })),

  removeInstance: (id) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        instances: s.manifest.instances.filter((i) => i.id !== id),
      },
      selectedEntity:
        s.selectedEntity?.type === 'instance' && s.selectedEntity.id === id
          ? null
          : s.selectedEntity,
      dirty: true,
    })),

  addPortal: () =>
    set((s) => {
      const id = `portal_${nextPortalId++}`;
      const portal: WorldPortal = {
        id,
        display_name: 'New Portal',
        position: [0, 0, 0],
        half_extents: [1, 2, 0.5],
        source_chunk: '0,0,0',
        target_instance: '',
        target_spawn: [0, 0, 0],
      };
      return {
        manifest: {
          ...s.manifest,
          portals: [...s.manifest.portals, portal],
        },
        selectedEntity: { type: 'portal', id },
        dirty: true,
      };
    }),

  updatePortal: (id, patch) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        portals: s.manifest.portals.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      },
      dirty: true,
    })),

  removePortal: (id) =>
    set((s) => ({
      manifest: {
        ...s.manifest,
        portals: s.manifest.portals.filter((p) => p.id !== id),
      },
      selectedEntity:
        s.selectedEntity?.type === 'portal' && s.selectedEntity.id === id
          ? null
          : s.selectedEntity,
      dirty: true,
    })),

  setSelectedEntity: (sel) => set({ selectedEntity: sel }),

  enterChunk: (grid) => set({ editingChunkGrid: grid }),
  exitChunk: () => set({ editingChunkGrid: null }),

  loadManifest: (data) => {
    // Back-compat: older world.json files may lack instances/portals arrays
    const safeData: WorldManifest = {
      ...data,
      instances: data.instances ?? [],
      portals: data.portals ?? [],
    };

    const maxSv = safeData.streaming_volumes.reduce((max: number, v: StreamingVolumeData) => {
      const n = parseInt(v.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextSvId = maxSv + 1;

    const maxInst = safeData.instances.reduce((max: number, i: WorldInstance) => {
      const n = parseInt(i.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextInstId = maxInst + 1;

    const maxPortal = safeData.portals.reduce((max: number, p: WorldPortal) => {
      const n = parseInt(p.id.replace(/\D/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    nextPortalId = maxPortal + 1;

    set({ manifest: safeData, loaded: true, dirty: false, selectedEntity: null, editingChunkGrid: null });
  },

  saveManifest: () => get().manifest,

  newWorld: () => {
    nextSvId = 1;
    nextInstId = 1;
    nextPortalId = 1;
    set({
      manifest: createEmptyManifest(),
      loaded: true,
      dirty: false,
      selectedEntity: null,
      editingChunkGrid: null,
    });
  },
}));
