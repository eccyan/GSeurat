import { create } from 'zustand';
import type {
  CharacterManifest,
  ConceptArt,
  FrameStatus,
} from '@vulkan-game-tools/asset-types';
import { createDefaultManifest, getManifestStats } from '@vulkan-game-tools/asset-types';
import { ComfyUIClient } from '@vulkan-game-tools/ai-providers';
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
  conceptImageUrl: string | null;
  conceptGenerating: boolean;
  conceptError: string | null;
  generateConceptArt: () => Promise<void>;
  loadConceptImage: () => void;

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

  // Test helpers (inject manifest directly without bridge)
  selectCharacterDirect: (manifest: CharacterManifest) => void;
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
    } catch {
      // Bridge not running — silently keep empty list
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
        conceptImageUrl: manifest.concept.reference_images.length > 0
          ? api.conceptImageUrl(id)
          : null,
        conceptError: null,
      });
    } catch {
      console.warn(`[Seurat] Could not load manifest for "${id}" — is the bridge running?`);
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

  conceptImageUrl: null,
  conceptGenerating: false,
  conceptError: null,

  generateConceptArt: async () => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const { concept, spritesheet } = manifest;
    if (!concept.description && !concept.style_prompt) {
      set({ conceptError: 'Fill in a description or style prompt first.' });
      return;
    }

    set({ conceptGenerating: true, conceptError: null });

    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);

      const prompt = [
        concept.style_prompt,
        concept.description,
        'full body character portrait',
        'front view',
        'standing pose',
        `${spritesheet.frame_width * 4}x${spritesheet.frame_height * 4}`,
        'pixel art, game character concept art, clean edges, centered, transparent background',
      ].filter(Boolean).join(', ');

      const negative = concept.negative_prompt
        ? `${concept.negative_prompt}, watermark, text, signature, cropped, partial`
        : 'blurry, realistic, 3d render, watermark, text, signature, cropped, partial';

      const seed = aiConfig.seed === -1 ? Math.floor(Math.random() * 2147483647) : aiConfig.seed;

      const pngBytes = await comfy.generateImageWithRetry(
        prompt,
        {
          width: 512,
          height: 512,
          steps: aiConfig.steps,
          seed,
          cfgScale: aiConfig.cfg,
          samplerName: aiConfig.sampler,
          negativePrompt: negative,
        },
        3, // maxRetries
        (attempt, max) => {
          set({ conceptError: `Blank image detected — retrying (${attempt}/${max})...` });
        },
      );

      // Save to bridge
      await api.saveConceptImage(manifest.character_id, pngBytes);

      // Update manifest reference_images
      const updated = {
        ...manifest,
        concept: {
          ...manifest.concept,
          reference_images: ['concept.png'],
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      // Reload the concept image URL
      set({ conceptImageUrl: api.conceptImageUrl(manifest.character_id), conceptError: null });
    } catch (err) {
      set({ conceptError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ conceptGenerating: false });
    }
  },

  loadConceptImage: () => {
    const { selectedCharacterId } = get();
    if (!selectedCharacterId) return;
    set({ conceptImageUrl: api.conceptImageUrl(selectedCharacterId) });
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

  // Test helpers
  selectCharacterDirect: (manifest) => {
    set({
      selectedCharacterId: manifest.character_id,
      manifest,
      selectedClipName: manifest.animations[0]?.name ?? null,
      assemblyResult: null,
      spriteSheetUrl: null,
    });
  },
}));
