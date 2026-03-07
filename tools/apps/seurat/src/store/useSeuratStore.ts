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
  TreeSelection,
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
  treeSelection: TreeSelection;
  setTreeSelection: (s: TreeSelection) => void;

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
  uploadConceptImage: (file: File) => Promise<void>;
  loadConceptImage: () => void;

  // Generation
  aiConfig: AIConfig;
  setAIConfig: (config: Partial<AIConfig>) => void;
  generationJobs: GenerationJob[];
  addGenerationJob: (job: GenerationJob) => void;
  updateGenerationJob: (id: string, update: Partial<GenerationJob>) => void;
  clearCompletedJobs: () => void;
  generateFrames: (
    scope: 'single' | 'row' | 'all_pending',
    animName?: string,
    frameIndex?: number,
  ) => Promise<void>;
  frameRevision: number;

  // Review
  reviewFilter: ReviewFilter;
  setReviewFilter: (f: ReviewFilter) => void;
  updateFrameStatus: (anim: string, frame: number, status: FrameStatus, notes?: string) => Promise<void>;
  approveAnimation: (animName: string) => Promise<void>;
  rejectAnimation: (animName: string) => Promise<void>;
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
  treeSelection: { kind: 'manifest' } as TreeSelection,
  setTreeSelection: (s) => set({ treeSelection: s }),

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
    set({ treeSelection: { kind: 'character', characterId: id } });
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

      const loras = aiConfig.loras.filter((l) => l.name.trim());
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
          loras,
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

  uploadConceptImage: async (file) => {
    const { manifest } = get();
    if (!manifest) return;

    set({ conceptGenerating: true, conceptError: null });

    try {
      const arrayBuf = await file.arrayBuffer();
      const pngBytes = new Uint8Array(arrayBuf);

      await api.saveConceptImage(manifest.character_id, pngBytes);

      const updated = {
        ...manifest,
        concept: {
          ...manifest.concept,
          reference_images: ['concept.png'],
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

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
  frameRevision: 0,
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

  generateFrames: async (scope, animName, frameIndex) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const comfy = new ComfyUIClient(aiConfig.comfyUrl);
    const hasConceptImage = manifest.concept.reference_images.length > 0;

    // Load concept image bytes for img2img (if available)
    let conceptBytes: Uint8Array | null = null;
    if (hasConceptImage) {
      try {
        conceptBytes = await api.fetchConceptImageBytes(manifest.character_id);
        console.log(`[Seurat] Loaded concept image: ${conceptBytes.length} bytes`);
      } catch (err) {
        console.warn('[Seurat] Failed to load concept image, falling back to txt2img:', err);
      }
    } else {
      console.log('[Seurat] No concept image, using txt2img mode');
    }

    // Import prompt builders
    const { buildFramePrompt, buildSheetRowPrompt, buildNegativePrompt } = await import('../lib/ai-generate.js');
    const loras = aiConfig.loras.filter((l) => l.name.trim());
    const negative = buildNegativePrompt(manifest);

    if (scope === 'single' && animName !== undefined && frameIndex !== undefined) {
      // Single frame: generate one image
      const anim = manifest.animations.find((a) => a.name === animName);
      if (!anim) return;

      const jobId = `${animName}_${frameIndex}_${Date.now()}`;
      get().addGenerationJob({ id: jobId, animName, frameIndex, status: 'running' });

      try {
        const prompt = buildFramePrompt(manifest, anim, frameIndex);
        console.log('[Seurat] Single frame prompt:', prompt);
        const seed = aiConfig.seed === -1
          ? Math.floor(Math.random() * 2147483647)
          : aiConfig.seed + frameIndex;

        let pngBytes: Uint8Array;
        if (conceptBytes) {
          console.log('[Seurat] Generating single frame via img2img...');
          pngBytes = await comfy.generateImg2ImgWithRetry(prompt, conceptBytes, {
            width: manifest.spritesheet.frame_width, height: manifest.spritesheet.frame_height,
            steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
            negativePrompt: negative, denoise: aiConfig.denoise, loras,
          });
        } else {
          console.log('[Seurat] Generating single frame via txt2img...');
          pngBytes = await comfy.generateImageWithRetry(prompt, {
            width: manifest.spritesheet.frame_width, height: manifest.spritesheet.frame_height,
            steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
            negativePrompt: negative, loras,
          });
        }
        console.log(`[Seurat] Got ${pngBytes.length} bytes from ComfyUI, saving frame...`);

        await api.saveFrameImage(manifest.character_id, animName, frameIndex, pngBytes);
        console.log('[Seurat] Frame saved successfully');
        const current = get().manifest;
        if (current) {
          const updated = structuredClone(current);
          const f = updated.animations.find((x) => x.name === animName)?.frames.find((x) => x.index === frameIndex);
          if (f) { f.status = 'generated'; f.file = `${animName}/${animName}_${frameIndex}.png`; }
          set({ manifest: updated, frameRevision: get().frameRevision + 1 });
        }
        get().updateGenerationJob(jobId, { status: 'done' });
      } catch (err) {
        console.error('[Seurat] Single frame generation error:', err);
        get().updateGenerationJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      // Row or all_pending: generate each animation as a single wide image, then slice
      const animsToGenerate: string[] = [];
      if (scope === 'row' && animName) {
        animsToGenerate.push(animName);
      } else {
        // all_pending — collect animations that have pending frames
        for (const a of manifest.animations) {
          if (a.frames.some((f) => f.status === 'pending')) animsToGenerate.push(a.name);
        }
      }

      for (const an of animsToGenerate) {
        const anim = manifest.animations.find((a) => a.name === an);
        if (!anim) continue;

        const jobId = `row_${an}_${Date.now()}`;
        get().addGenerationJob({ id: jobId, animName: an, frameIndex: -1, status: 'running' });

        try {
          const prompt = buildSheetRowPrompt(manifest, anim);
          console.log(`[Seurat] Row "${an}" prompt:`, prompt);
          const seed = aiConfig.seed === -1
            ? Math.floor(Math.random() * 2147483647)
            : aiConfig.seed;
          const frameCount = anim.frames.length;
          const sheetWidth = manifest.spritesheet.frame_width * frameCount;
          const sheetHeight = manifest.spritesheet.frame_height;
          console.log(`[Seurat] Row "${an}": ${frameCount} frames, ${sheetWidth}x${sheetHeight}`);

          let pngBytes: Uint8Array;
          if (conceptBytes && aiConfig.controlNetModel) {
            console.log(`[Seurat] Row "${an}": ControlNet mode, tiling concept image...`);
            const tiledBytes = await tileImageHorizontally(conceptBytes, frameCount, sheetWidth, sheetHeight);
            console.log(`[Seurat] Tiled image: ${tiledBytes.length} bytes, sending to ComfyUI...`);
            pngBytes = await comfy.generateControlNetWithRetry(prompt, tiledBytes, {
              width: sheetWidth, height: sheetHeight,
              steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
              negativePrompt: negative, denoise: aiConfig.denoise, loras,
              controlNetModel: aiConfig.controlNetModel,
              controlStrength: aiConfig.controlStrength,
            });
          } else if (conceptBytes) {
            console.log(`[Seurat] Row "${an}": img2img mode, tiling concept image...`);
            const tiledBytes = await tileImageHorizontally(conceptBytes, frameCount, sheetWidth, sheetHeight);
            console.log(`[Seurat] Tiled image: ${tiledBytes.length} bytes, sending to ComfyUI...`);
            pngBytes = await comfy.generateImg2ImgWithRetry(prompt, tiledBytes, {
              width: sheetWidth, height: sheetHeight,
              steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
              negativePrompt: negative, denoise: aiConfig.denoise, loras,
            });
          } else {
            console.log(`[Seurat] Row "${an}": txt2img mode...`);
            pngBytes = await comfy.generateImageWithRetry(prompt, {
              width: sheetWidth, height: sheetHeight,
              steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
              negativePrompt: negative, loras,
            });
          }
          console.log(`[Seurat] Row "${an}": got ${pngBytes.length} bytes from ComfyUI, slicing...`);

          // Slice the wide image into individual frames
          const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
          const bitmap = await createImageBitmap(blob);
          console.log(`[Seurat] Row "${an}": bitmap ${bitmap.width}x${bitmap.height}, slicing into ${frameCount} frames of ${manifest.spritesheet.frame_width}x${manifest.spritesheet.frame_height}`);
          const fw = manifest.spritesheet.frame_width;
          const fh = manifest.spritesheet.frame_height;

          for (let i = 0; i < frameCount; i++) {
            const canvas = new OffscreenCanvas(fw, fh);
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(bitmap, i * fw, 0, fw, fh, 0, 0, fw, fh);
            const frameBlob = await canvas.convertToBlob({ type: 'image/png' });
            const frameBuf = await frameBlob.arrayBuffer();
            const frameBytes = new Uint8Array(frameBuf);
            console.log(`[Seurat] Row "${an}" frame ${i}: ${frameBytes.length} bytes, saving...`);

            await api.saveFrameImage(manifest.character_id, an, i, frameBytes);
            console.log(`[Seurat] Row "${an}" frame ${i}: saved successfully`);
            const current = get().manifest;
            if (current) {
              const updated = structuredClone(current);
              const f = updated.animations.find((x) => x.name === an)?.frames.find((x) => x.index === i);
              if (f) { f.status = 'generated'; f.file = `${an}/${an}_${i}.png`; }
              set({ manifest: updated });
            }
          }
          bitmap.close();
          set({ frameRevision: get().frameRevision + 1 });
          get().updateGenerationJob(jobId, { status: 'done' });
        } catch (err) {
          console.error(`[Seurat] Row "${an}" generation error:`, err);
          get().updateGenerationJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // Save final manifest state
    try { await api.saveManifest(get().manifest!); } catch { /* best effort */ }
  },

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

  approveAnimation: async (animName) => {
    const { manifest } = get();
    if (!manifest) return;
    const updated = structuredClone(manifest);
    const anim = updated.animations.find((a) => a.name === animName);
    if (!anim) return;
    for (const frame of anim.frames) {
      if (frame.status === 'generated' || frame.status === 'rejected') {
        frame.status = 'approved';
        try {
          await api.updateFrameStatus(manifest.character_id, animName, frame.index, 'approved');
        } catch { /* continue */ }
      }
    }
    set({ manifest: updated });
    try { await api.saveManifest(updated); } catch { /* best effort */ }
  },

  rejectAnimation: async (animName) => {
    const { manifest } = get();
    if (!manifest) return;
    const updated = structuredClone(manifest);
    const anim = updated.animations.find((a) => a.name === animName);
    if (!anim) return;
    for (const frame of anim.frames) {
      if (frame.status === 'generated' || frame.status === 'approved') {
        frame.status = 'rejected';
        try {
          await api.updateFrameStatus(manifest.character_id, animName, frame.index, 'rejected');
        } catch { /* continue */ }
      }
    }
    set({ manifest: updated });
    try { await api.saveManifest(updated); } catch { /* best effort */ }
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

/**
 * Tile a source image horizontally N times, resizing each tile to fit
 * within the target strip dimensions (targetWidth x targetHeight).
 * Returns PNG bytes of the tiled strip.
 */
async function tileImageHorizontally(
  sourceBytes: Uint8Array,
  tileCount: number,
  targetWidth: number,
  targetHeight: number,
): Promise<Uint8Array> {
  const blob = new Blob([sourceBytes as BlobPart], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d')!;

  const tileWidth = targetWidth / tileCount;

  // Scale source to fit each tile slot while maintaining aspect ratio
  const scale = Math.min(tileWidth / bitmap.width, targetHeight / bitmap.height);
  const drawW = bitmap.width * scale;
  const drawH = bitmap.height * scale;
  const offsetY = (targetHeight - drawH) / 2;

  for (let i = 0; i < tileCount; i++) {
    const offsetX = i * tileWidth + (tileWidth - drawW) / 2;
    ctx.drawImage(bitmap, offsetX, offsetY, drawW, drawH);
  }

  bitmap.close();
  const resultBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await resultBlob.arrayBuffer();
  return new Uint8Array(buf);
}
