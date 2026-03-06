import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnimFrame {
  id: string;
  tile_id: number;
  duration: number; // seconds
}

export interface AnimClip {
  id: string;
  name: string;
  loop: boolean;
  frames: AnimFrame[];
}

export interface StateMachineNode {
  id: string;    // clip id
  x: number;
  y: number;
}

export interface StateMachineEdge {
  id: string;
  from: string;  // clip id
  to: string;    // clip id
  condition: string; // e.g. "speed > 0", "dir == north"
}

export interface TilesetConfig {
  tile_width: number;
  tile_height: number;
  columns: number;
  sheet_width: number;
  sheet_height: number;
  image_url: string; // data URL or blob URL for the sprite sheet
}

export type PlaybackState = 'stopped' | 'playing' | 'paused';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface AnimatorState {
  // Clips
  clips: AnimClip[];
  selectedClipId: string | null;
  selectedFrameIndex: number | null;

  // Playback
  playbackState: PlaybackState;
  currentTime: number;       // seconds into the current clip
  timelineZoom: number;      // pixels per second

  // Tileset
  tileset: TilesetConfig;

  // State machine nodes/edges
  smNodes: StateMachineNode[];
  smEdges: StateMachineEdge[];
  selectedEdgeId: string | null;

  // Sprite sheet image
  spriteSheetUrl: string | null;

  // Actions
  addClip: (name?: string) => void;
  removeClip: (id: string) => void;
  renameClip: (id: string, name: string) => void;
  selectClip: (id: string | null) => void;
  toggleClipLoop: (id: string) => void;

  addFrame: (clipId: string, tileId?: number) => void;
  removeFrame: (clipId: string, frameIndex: number) => void;
  updateFrame: (clipId: string, frameIndex: number, patch: Partial<AnimFrame>) => void;
  selectFrame: (index: number | null) => void;
  moveFrame: (clipId: string, fromIndex: number, toIndex: number) => void;

  setPlaybackState: (state: PlaybackState) => void;
  setCurrentTime: (t: number) => void;
  setTimelineZoom: (zoom: number) => void;

  updateTileset: (patch: Partial<TilesetConfig>) => void;
  setSpriteSheetUrl: (url: string | null) => void;

  addSmNode: (clipId: string) => void;
  moveSmNode: (clipId: string, x: number, y: number) => void;
  addSmEdge: (from: string, to: string) => void;
  removeSmEdge: (edgeId: string) => void;
  updateSmEdge: (edgeId: string, condition: string) => void;
  selectSmEdge: (edgeId: string | null) => void;
  autoLayoutSmNodes: () => void;

  importClipsFromJson: (json: AnimClip[]) => void;
  exportClipsToJson: () => string;

  // Character manifest sync
  characterId: string | null;
  setCharacterId: (id: string | null) => void;
  loadFromCharacter: (id: string) => Promise<void>;
  saveToCharacter: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Default 12 clips: idle/walk/run × north/south/east/west
function makeDefaultClips(): AnimClip[] {
  const states = ['idle', 'walk', 'run'];
  const dirs = ['south', 'north', 'east', 'west'];
  const clips: AnimClip[] = [];
  let tileRow = 0;
  for (const state of states) {
    for (const dir of dirs) {
      const frameCount = state === 'idle' ? 1 : state === 'walk' ? 4 : 4;
      const dur = state === 'idle' ? 0.3 : state === 'walk' ? 0.12 : 0.07;
      clips.push({
        id: makeId(),
        name: `${state}_${dir}`,
        loop: true,
        frames: Array.from({ length: frameCount }, (_, fi) => ({
          id: makeId(),
          tile_id: tileRow * 4 + fi,
          duration: dur,
        })),
      });
      tileRow++;
    }
  }
  return clips;
}

function makeDefaultSmNodes(clips: AnimClip[]): StateMachineNode[] {
  const states = ['idle', 'walk', 'run'];
  const dirs = ['south', 'north', 'east', 'west'];
  const nodes: StateMachineNode[] = [];
  let row = 0;
  for (const _state of states) {
    for (let col = 0; col < dirs.length; col++) {
      const clip = clips[row * dirs.length + col];
      if (clip) {
        nodes.push({ id: clip.id, x: 80 + col * 160, y: 60 + row * 120 });
      }
    }
    row++;
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const defaultClips = makeDefaultClips();

export const useAnimatorStore = create<AnimatorState>((set, get) => ({
  clips: defaultClips,
  selectedClipId: defaultClips[0]?.id ?? null,
  selectedFrameIndex: null,

  playbackState: 'stopped',
  currentTime: 0,
  timelineZoom: 120, // 120 px per second

  tileset: {
    tile_width: 16,
    tile_height: 16,
    columns: 4,
    sheet_width: 64,
    sheet_height: 192,
    image_url: '',
  },

  smNodes: makeDefaultSmNodes(defaultClips),
  smEdges: [],
  selectedEdgeId: null,

  spriteSheetUrl: null,

  // ---- Clip actions -------------------------------------------------------

  addClip: (name = 'new_clip') =>
    set((s) => {
      const clip: AnimClip = {
        id: makeId(),
        name,
        loop: true,
        frames: [{ id: makeId(), tile_id: 0, duration: 0.1 }],
      };
      return {
        clips: [...s.clips, clip],
        smNodes: [...s.smNodes, { id: clip.id, x: 200, y: 200 }],
        selectedClipId: clip.id,
      };
    }),

  removeClip: (id) =>
    set((s) => {
      const clips = s.clips.filter((c) => c.id !== id);
      const smNodes = s.smNodes.filter((n) => n.id !== id);
      const smEdges = s.smEdges.filter((e) => e.from !== id && e.to !== id);
      return {
        clips,
        smNodes,
        smEdges,
        selectedClipId: clips[0]?.id ?? null,
        selectedFrameIndex: null,
      };
    }),

  renameClip: (id, name) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, name } : c)),
    })),

  selectClip: (id) =>
    set({ selectedClipId: id, selectedFrameIndex: null, currentTime: 0 }),

  toggleClipLoop: (id) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, loop: !c.loop } : c)),
    })),

  // ---- Frame actions -------------------------------------------------------

  addFrame: (clipId, tileId = 0) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === clipId
          ? { ...c, frames: [...c.frames, { id: makeId(), tile_id: tileId, duration: 0.1 }] }
          : c,
      ),
    })),

  removeFrame: (clipId, frameIndex) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === clipId
          ? { ...c, frames: c.frames.filter((_, i) => i !== frameIndex) }
          : c,
      ),
      selectedFrameIndex: null,
    })),

  updateFrame: (clipId, frameIndex, patch) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              frames: c.frames.map((f, i) =>
                i === frameIndex ? { ...f, ...patch } : f,
              ),
            }
          : c,
      ),
    })),

  selectFrame: (index) => set({ selectedFrameIndex: index }),

  moveFrame: (clipId, fromIndex, toIndex) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== clipId) return c;
        const frames = [...c.frames];
        const [removed] = frames.splice(fromIndex, 1);
        frames.splice(toIndex, 0, removed);
        return { ...c, frames };
      }),
    })),

  // ---- Playback actions ---------------------------------------------------

  setPlaybackState: (state) => set({ playbackState: state }),

  setCurrentTime: (t) => set({ currentTime: t }),

  setTimelineZoom: (zoom) => set({ timelineZoom: Math.max(20, Math.min(600, zoom)) }),

  // ---- Tileset actions ----------------------------------------------------

  updateTileset: (patch) =>
    set((s) => ({ tileset: { ...s.tileset, ...patch } })),

  setSpriteSheetUrl: (url) => set({ spriteSheetUrl: url }),

  // ---- State machine actions ----------------------------------------------

  addSmNode: (clipId) =>
    set((s) => {
      if (s.smNodes.find((n) => n.id === clipId)) return s;
      return { smNodes: [...s.smNodes, { id: clipId, x: 100, y: 100 }] };
    }),

  moveSmNode: (clipId, x, y) =>
    set((s) => ({
      smNodes: s.smNodes.map((n) => (n.id === clipId ? { ...n, x, y } : n)),
    })),

  addSmEdge: (from, to) =>
    set((s) => {
      const exists = s.smEdges.find((e) => e.from === from && e.to === to);
      if (exists) return s;
      return {
        smEdges: [...s.smEdges, { id: makeId(), from, to, condition: '' }],
      };
    }),

  removeSmEdge: (edgeId) =>
    set((s) => ({
      smEdges: s.smEdges.filter((e) => e.id !== edgeId),
      selectedEdgeId: s.selectedEdgeId === edgeId ? null : s.selectedEdgeId,
    })),

  updateSmEdge: (edgeId, condition) =>
    set((s) => ({
      smEdges: s.smEdges.map((e) => (e.id === edgeId ? { ...e, condition } : e)),
    })),

  selectSmEdge: (edgeId) => set({ selectedEdgeId: edgeId }),

  autoLayoutSmNodes: () =>
    set((s) => {
      const states = ['idle', 'walk', 'run'];
      const dirs = ['south', 'north', 'east', 'west'];
      const nodes = [...s.smNodes];
      for (let si = 0; si < states.length; si++) {
        for (let di = 0; di < dirs.length; di++) {
          const name = `${states[si]}_${dirs[di]}`;
          const clip = s.clips.find((c) => c.name === name);
          if (!clip) continue;
          const node = nodes.find((n) => n.id === clip.id);
          if (node) {
            node.x = 80 + di * 160;
            node.y = 60 + si * 120;
          }
        }
      }
      // Layout non-standard clips below
      const standardNames = new Set(
        states.flatMap((st) => dirs.map((d) => `${st}_${d}`)),
      );
      const nonStandard = s.clips.filter((c) => !standardNames.has(c.name));
      nonStandard.forEach((c, i) => {
        const node = nodes.find((n) => n.id === c.id);
        if (node) {
          node.x = 80 + (i % 4) * 160;
          node.y = 60 + (3 + Math.floor(i / 4)) * 120;
        }
      });
      return { smNodes: nodes };
    }),

  // ---- Import/Export ------------------------------------------------------

  importClipsFromJson: (newClips) =>
    set((s) => {
      const merged = [...s.clips];
      for (const nc of newClips) {
        const idx = merged.findIndex((c) => c.id === nc.id);
        if (idx >= 0) merged[idx] = nc;
        else merged.push(nc);
      }
      const existingNodeIds = new Set(s.smNodes.map((n) => n.id));
      const newNodes = newClips
        .filter((c) => !existingNodeIds.has(c.id))
        .map((c, i) => ({ id: c.id, x: 100 + i * 40, y: 100 + i * 40 }));
      return { clips: merged, smNodes: [...s.smNodes, ...newNodes] };
    }),

  exportClipsToJson: () => {
    const { clips } = get();
    return JSON.stringify(clips, null, 2);
  },

  // Character manifest sync
  characterId: null,

  setCharacterId: (id) => set({ characterId: id }),

  loadFromCharacter: async (id: string) => {
    const BRIDGE_URL = 'http://localhost:9101';
    try {
      const res = await fetch(`${BRIDGE_URL}/api/characters/${id}`);
      if (!res.ok) throw new Error(`Character not found: ${id}`);
      const manifest = await res.json();

      // Convert manifest animations to AnimClips
      const clips: AnimClip[] = (manifest.animations ?? []).map((anim: { name: string; loop: boolean; frames: { tile_id: number; duration: number }[] }) => ({
        id: makeId(),
        name: anim.name,
        loop: anim.loop,
        frames: anim.frames.map((f: { tile_id: number; duration: number }) => ({
          id: makeId(),
          tile_id: f.tile_id,
          duration: f.duration,
        })),
      }));

      // Configure tileset from manifest spritesheet
      const ss = manifest.spritesheet;
      const totalRows = manifest.animations?.length ?? 12;
      const columns = ss?.columns ?? 4;

      set({
        characterId: id,
        clips,
        tileset: {
          tile_width: ss?.frame_width ?? 128,
          tile_height: ss?.frame_height ?? 128,
          columns,
          sheet_width: (ss?.frame_width ?? 128) * columns,
          sheet_height: (ss?.frame_height ?? 128) * totalRows,
          image_url: get().tileset.image_url,
        },
        smNodes: makeDefaultSmNodes(clips),
        smEdges: [],
        selectedClipId: clips[0]?.id ?? null,
      });
    } catch (err) {
      console.error('Failed to load character:', err);
    }
  },

  saveToCharacter: async () => {
    const { characterId, clips, tileset } = get();
    if (!characterId) return;
    const BRIDGE_URL = 'http://localhost:9101';
    try {
      // Fetch current manifest
      const res = await fetch(`${BRIDGE_URL}/api/characters/${characterId}`);
      if (!res.ok) throw new Error('Failed to load manifest');
      const manifest = await res.json();

      // Update animations from clips
      manifest.animations = clips.map((clip, row) => {
        // Try to match existing animation by name to preserve metadata
        const existing = manifest.animations?.find((a: { name: string }) => a.name === clip.name);
        return {
          name: clip.name,
          state: existing?.state ?? clip.name.split('_')[0] ?? 'idle',
          direction: existing?.direction ?? 'S',
          row,
          loop: clip.loop,
          frames: clip.frames.map((f, idx) => {
            const existingFrame = existing?.frames?.[idx];
            return {
              index: idx,
              tile_id: f.tile_id,
              duration: f.duration,
              status: existingFrame?.status ?? 'pending',
              source: existingFrame?.source ?? 'placeholder',
              file: existingFrame?.file ?? `${clip.name}_f${idx}.png`,
              ...(existingFrame?.generation && { generation: existingFrame.generation }),
              ...(existingFrame?.review && { review: existingFrame.review }),
            };
          }),
        };
      });

      // Update spritesheet config
      manifest.spritesheet = {
        frame_width: tileset.tile_width,
        frame_height: tileset.tile_height,
        columns: tileset.columns,
      };

      // Save back
      await fetch(`${BRIDGE_URL}/api/characters/${characterId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest, null, 2),
      });
    } catch (err) {
      console.error('Failed to save to character:', err);
    }
  },
}));

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function getSelectedClip(state: AnimatorState): AnimClip | null {
  if (!state.selectedClipId) return null;
  return state.clips.find((c) => c.id === state.selectedClipId) ?? null;
}

export function getClipDuration(clip: AnimClip): number {
  return clip.frames.reduce((sum, f) => sum + f.duration, 0);
}

export function getFrameAtTime(clip: AnimClip, t: number): number {
  const total = getClipDuration(clip);
  if (total === 0) return 0;
  let time = clip.loop ? t % total : Math.min(t, total - 0.001);
  for (let i = 0; i < clip.frames.length; i++) {
    time -= clip.frames[i].duration;
    if (time < 0) return i;
  }
  return clip.frames.length - 1;
}

export function tileUVs(
  tileId: number,
  tileset: TilesetConfig,
): { u: number; v: number; w: number; h: number } {
  const col = tileId % tileset.columns;
  const row = Math.floor(tileId / tileset.columns);
  return {
    u: col * tileset.tile_width,
    v: row * tileset.tile_height,
    w: tileset.tile_width,
    h: tileset.tile_height,
  };
}
