import { create } from 'zustand';
import type {
  CharacterManifest,
  ConceptArt,
  FrameStatus,
} from '@vulkan-game-tools/asset-types';
import { createDefaultManifest, getManifestStats } from '@vulkan-game-tools/asset-types';
import type {
  Section,
  AIConfig,
  GenerationJob,
  PlaybackState,
  ReviewFilter,
  AssembleResult,
} from './types.js';
import { DEFAULT_AI_CONFIG } from './types.js';
import * as api from '../lib/bridge-api.js';

export { getManifestStats };

export interface SeuratState {
  // Navigation
  activeSection: Section;
  setActiveSection: (s: Section) => void;

  // Characters
  characters: string[];
  selectedCharacterId: string | null;
  manifest: CharacterManifest | null;
  refreshCharacters: () => Promise<void>;
  selectCharacter: (id: string) => Promise<void>;
  createCharacter: (id: string, name: string) => Promise<void>;
  saveManifest: () => Promise<void>;

  // Concept
  saveConcept: (concept: ConceptArt) => Promise<void>;

  // Generation
  aiConfig: AIConfig;
  setAIConfig: (config: Partial<AIConfig>) => void;
  generationJobs: GenerationJob[];
  addGenerationJob: (job: GenerationJob) => void;
  updateGenerationJob: (id: string, update: Partial<GenerationJob>) => void;
  clearCompletedJobs: () => void;

  // Review
  reviewFilter: ReviewFilter;
  setReviewFilter: (f: ReviewFilter) => void;
  updateFrameStatus: (anim: string, frame: number, status: FrameStatus, notes?: string) => Promise<void>;
  batchApproveGenerated: () => Promise<void>;

  // Animate
  selectedClipName: string | null;
  selectClip: (name: string | null) => void;
  playbackState: PlaybackState;
  setPlaybackState: (s: PlaybackState) => void;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  updateFrameDuration: (anim: string, frame: number, duration: number) => void;

  // Atlas
  assemblyResult: AssembleResult | null;
  assembleAtlas: (validateOnly?: boolean) => Promise<void>;

  // Sprite sheet
  spriteSheetUrl: string | null;
  loadSpriteSheet: () => void;
}

export const useSeuratStore = create<SeuratState>((set, get) => ({
  // Navigation
  activeSection: 'dashboard',
  setActiveSection: (s) => set({ activeSection: s }),

  // Characters
  characters: [],
  selectedCharacterId: null,
  manifest: null,

  refreshCharacters: async () => {
    try {
      const characters = await api.fetchCharacters();
      set({ characters });
    } catch (err) {
      console.error('Failed to refresh characters:', err);
    }
  },

  selectCharacter: async (id) => {
    try {
      const manifest = await api.fetchManifest(id);
      set({
        selectedCharacterId: id,
        manifest,
        selectedClipName: manifest.animations[0]?.name ?? null,
        assemblyResult: null,
        spriteSheetUrl: null,
      });
    } catch (err) {
      console.error('Failed to select character:', err);
    }
  },

  createCharacter: async (id, name) => {
    const manifest = createDefaultManifest(id, name);
    await api.createCharacter(id, name, manifest);
    await get().refreshCharacters();
    await get().selectCharacter(id);
    set({ activeSection: 'concept' });
  },

  saveManifest: async () => {
    const { manifest } = get();
    if (!manifest) return;
    try {
      await api.saveManifest(manifest);
    } catch (err) {
      console.error('Failed to save manifest:', err);
    }
  },

  // Concept
  saveConcept: async (concept) => {
    const { manifest } = get();
    if (!manifest) return;
    const updated = { ...manifest, concept };
    set({ manifest: updated });
    await api.saveManifest(updated);
  },

  // Generation
  aiConfig: DEFAULT_AI_CONFIG,
  setAIConfig: (config) => set((s) => ({ aiConfig: { ...s.aiConfig, ...config } })),
  generationJobs: [],
  addGenerationJob: (job) => set((s) => ({ generationJobs: [...s.generationJobs, job] })),
  updateGenerationJob: (id, update) =>
    set((s) => ({
      generationJobs: s.generationJobs.map((j) =>
        j.id === id ? { ...j, ...update } : j,
      ),
    })),
  clearCompletedJobs: () =>
    set((s) => ({
      generationJobs: s.generationJobs.filter((j) => j.status !== 'done' && j.status !== 'error'),
    })),

  // Review
  reviewFilter: 'all',
  setReviewFilter: (f) => set({ reviewFilter: f }),

  updateFrameStatus: async (animName, frameIndex, status, notes) => {
    const { manifest } = get();
    if (!manifest) return;
    await api.updateFrameStatus(manifest.character_id, animName, frameIndex, status, notes);
    const updated = structuredClone(manifest);
    const anim = updated.animations.find((a) => a.name === animName);
    const frame = anim?.frames.find((f) => f.index === frameIndex);
    if (frame) {
      frame.status = status;
      if (notes !== undefined) {
        if (!frame.review) frame.review = { reviewer: 'human', notes };
        else frame.review.notes = notes;
      }
    }
    set({ manifest: updated });
  },

  batchApproveGenerated: async () => {
    const { manifest } = get();
    if (!manifest) return;
    const updated = structuredClone(manifest);
    for (const anim of updated.animations) {
      for (const frame of anim.frames) {
        if (frame.status === 'generated') {
          frame.status = 'approved';
          try {
            await api.updateFrameStatus(manifest.character_id, anim.name, frame.index, 'approved');
          } catch { /* continue */ }
        }
      }
    }
    set({ manifest: updated });
  },

  // Animate
  selectedClipName: null,
  selectClip: (name) => set({ selectedClipName: name, currentTime: 0, playbackState: 'stopped' }),
  playbackState: 'stopped',
  setPlaybackState: (s) => set({ playbackState: s }),
  currentTime: 0,
  setCurrentTime: (t) => set({ currentTime: t }),

  updateFrameDuration: (animName, frameIndex, duration) => {
    const { manifest } = get();
    if (!manifest) return;
    const updated = structuredClone(manifest);
    const anim = updated.animations.find((a) => a.name === animName);
    const frame = anim?.frames.find((f) => f.index === frameIndex);
    if (frame) frame.duration = duration;
    set({ manifest: updated });
  },

  // Atlas
  assemblyResult: null,
  assembleAtlas: async (validateOnly) => {
    const { manifest } = get();
    if (!manifest) return;
    try {
      const result = await api.assembleAtlas(manifest.character_id, validateOnly);
      set({ assemblyResult: result });
      if (!validateOnly) {
        get().loadSpriteSheet();
      }
    } catch (err) {
      set({
        assemblyResult: {
          totalFrames: 0,
          approvedFrames: 0,
          errors: [err instanceof Error ? err.message : String(err)],
        },
      });
    }
  },

  // Sprite sheet
  spriteSheetUrl: null,
  loadSpriteSheet: () => {
    const { selectedCharacterId } = get();
    if (!selectedCharacterId) return;
    set({ spriteSheetUrl: api.spriteSheetUrl(selectedCharacterId) });
  },
}));
