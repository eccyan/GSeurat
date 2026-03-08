import { create } from 'zustand';
import type {
  CharacterManifest,
  ConceptArt,
  ChibiArt,
  PixelArt,
  FrameStatus,
  ViewDirection,
  DirectionCode,
} from '@vulkan-game-tools/asset-types';
import { createDefaultManifest, getManifestStats, VIEW_DIRECTIONS, DIRECTION_TO_VIEW } from '@vulkan-game-tools/asset-types';
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
  generateConceptArt: (overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string }) => Promise<void>;
  uploadConceptImage: (file: File) => Promise<void>;
  loadConceptImage: () => void;

  // Multi-view concept
  conceptViewUrls: Record<ViewDirection, string | null>;
  conceptViewsGenerating: boolean;
  conceptViewsError: string | null;
  conceptViewsProgress: string | null;
  generateConceptViews: (overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string }) => Promise<void>;
  loadConceptViewUrls: () => void;

  // Chibi
  saveChibi: (chibi: ChibiArt) => Promise<void>;
  chibiImageUrl: string | null;
  chibiGenerating: boolean;
  chibiError: string | null;
  generateChibiArt: (overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string; denoise?: number }) => Promise<void>;
  uploadChibiImage: (file: File) => Promise<void>;

  // Multi-view chibi
  chibiViewUrls: Record<ViewDirection, string | null>;
  chibiViewsGenerating: boolean;
  chibiViewsError: string | null;
  chibiViewsProgress: string | null;
  generateChibiViews: (overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string; denoise?: number }) => Promise<void>;
  loadChibiViewUrls: () => void;

  // Per-direction reference overrides (null = auto from DIRECTION_TO_VIEW)
  directionConceptOverride: Record<DirectionCode, ViewDirection | null>;
  directionChibiOverride: Record<DirectionCode, ViewDirection | null>;
  setDirectionConceptOverride: (dir: DirectionCode, view: ViewDirection | null) => void;
  setDirectionChibiOverride: (dir: DirectionCode, view: ViewDirection | null) => void;

  // Pixel
  savePixel: (pixel: PixelArt) => Promise<void>;
  pixelImageUrl: string | null;
  pixelGenerating: boolean;
  pixelError: string | null;
  generatePixelArt: (overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string; denoise?: number }) => Promise<void>;
  uploadPixelImage: (file: File) => Promise<void>;

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

  // Animate
  selectedClipName: string | null;
  selectClip: (name: string | null) => void;
  playbackState: PlaybackState;
  setPlaybackState: (s: PlaybackState) => void;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  updateFrameDuration: (anim: string, frame: number, duration: number) => void;

  // Pose editing
  poseOverrides: Record<string, ([number, number] | null)[]>;
  setPoseOverride: (animName: string, frameIndex: number, pose: ([number, number] | null)[]) => void;
  clearPoseOverride: (animName: string, frameIndex: number) => void;
  clearAllPoseOverrides: (animName: string) => void;

  // ComfyUI model lists
  availableCheckpoints: string[];
  availableLoras: string[];
  availableVaes: string[];
  availableSchedulers: string[];
  refreshComfyModels: () => Promise<void>;

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
      // Build view URLs from manifest reference_images
      const conceptViewUrls: Record<ViewDirection, string | null> = { front: null, back: null, right: null, left: null };
      const refs = manifest.concept.reference_images;
      for (const v of VIEW_DIRECTIONS) {
        if (refs.includes(`concept_${v}.png`)) {
          conceptViewUrls[v] = api.conceptImageUrl(id, v);
        }
      }
      const chibiViewUrls: Record<ViewDirection, string | null> = { front: null, back: null, right: null, left: null };
      const chibiRefs = manifest.chibi?.reference_images;
      if (chibiRefs) {
        for (const v of VIEW_DIRECTIONS) {
          if (chibiRefs[v]) {
            chibiViewUrls[v] = api.chibiImageUrl(id, v);
          }
        }
      }
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
        conceptViewUrls,
        chibiImageUrl: manifest.chibi?.reference_image
          ? api.chibiImageUrl(id)
          : null,
        chibiError: null,
        chibiViewUrls,
        pixelImageUrl: manifest.pixel?.reference_image
          ? api.pixelImageUrl(id)
          : null,
        pixelError: null,
        directionConceptOverride: { S: null, N: null, E: null, W: null },
        directionChibiOverride: { S: null, N: null, E: null, W: null },
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

  generateConceptArt: async (overrides) => {
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
      ].filter(Boolean).join(', ');

      const negative = concept.negative_prompt
        ? `${concept.negative_prompt}, watermark, text, signature, cropped, partial body`
        : 'blurry, watermark, text, signature, cropped, partial body';

      const steps = overrides?.steps ?? aiConfig.steps;
      const cfg = overrides?.cfg ?? aiConfig.cfg;
      const sampler = overrides?.sampler ?? aiConfig.sampler;
      const rawSeed = overrides?.seed ?? aiConfig.seed;
      const seed = rawSeed === -1 ? Math.floor(Math.random() * 2147483647) : rawSeed;
      const loras = overrides?.loras !== undefined
        ? overrides.loras.filter((l) => l.name.trim())
        : aiConfig.loras.filter((l) => l.name.trim());

      const checkpoint = overrides?.checkpoint ?? aiConfig.checkpoint;
      const scheduler = overrides?.scheduler;
      const vae = overrides?.vae;
      console.log('[Seurat] Concept prompt:', prompt);
      console.log('[Seurat] Concept negative:', negative);
      console.log('[Seurat] Concept settings:', { steps, cfg, sampler, scheduler, seed, checkpoint, vae, loras: loras.map(l => `${l.name}:${l.weight}`) });
      const pngBytes = await comfy.generateImageWithRetry(
        prompt,
        {
          width: 512,
          height: 512,
          steps,
          seed,
          cfgScale: cfg,
          samplerName: sampler,
          scheduler,
          checkpoint,
          vae,
          negativePrompt: negative,
          loras,
          removeBackground: aiConfig.removeBackground,
          remBgNodeType: aiConfig.remBgNodeType,
        },
        3, // maxRetries
        (attempt, max) => {
          set({ conceptError: `Blank image detected — retrying (${attempt}/${max})...` });
        },
      );

      // Save to bridge
      await api.saveConceptImage(manifest.character_id, pngBytes);

      // Update manifest reference_images + generation settings
      const updated = {
        ...manifest,
        concept: {
          ...manifest.concept,
          reference_images: ['concept.png'],
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, loras },
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

  // Multi-view concept
  conceptViewUrls: { front: null, back: null, right: null, left: null },
  conceptViewsGenerating: false,
  conceptViewsError: null,
  conceptViewsProgress: null,

  loadConceptViewUrls: () => {
    const { selectedCharacterId, manifest } = get();
    if (!selectedCharacterId) return;
    const urls: Record<ViewDirection, string | null> = { front: null, back: null, right: null, left: null };
    // Check manifest reference_images for view-specific files
    const refs = manifest?.concept.reference_images ?? [];
    for (const v of VIEW_DIRECTIONS) {
      if (refs.includes(`concept_${v}.png`)) {
        urls[v] = api.conceptImageUrl(selectedCharacterId, v);
      }
    }
    set({ conceptViewUrls: urls });
  },

  generateConceptViews: async (overrides) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const { concept } = manifest;
    if (!concept.description && !concept.style_prompt) {
      set({ conceptViewsError: 'Fill in a description or style prompt first.' });
      return;
    }

    set({ conceptViewsGenerating: true, conceptViewsError: null, conceptViewsProgress: 'Generating front view...' });

    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      const { CONCEPT_VIEW_PROMPTS } = await import('../lib/ai-generate.js');

      const basePrompt = [concept.style_prompt, concept.description].filter(Boolean).join(', ');
      const negative = concept.negative_prompt
        ? `${concept.negative_prompt}, watermark, text, signature, cropped, partial body`
        : 'blurry, watermark, text, signature, cropped, partial body';

      const steps = overrides?.steps ?? aiConfig.steps;
      const cfg = overrides?.cfg ?? aiConfig.cfg;
      const sampler = overrides?.sampler ?? aiConfig.sampler;
      const rawSeed = overrides?.seed ?? aiConfig.seed;
      const seed = rawSeed === -1 ? Math.floor(Math.random() * 2147483647) : rawSeed;
      const loras = overrides?.loras !== undefined
        ? overrides.loras.filter((l) => l.name.trim())
        : aiConfig.loras.filter((l) => l.name.trim());
      const checkpoint = overrides?.checkpoint ?? aiConfig.checkpoint;
      const scheduler = overrides?.scheduler;
      const vae = overrides?.vae;

      // 1. Front: txt2img
      const frontPrompt = `${basePrompt}, ${CONCEPT_VIEW_PROMPTS.front}`;
      console.log('[Seurat] Concept views — front prompt:', frontPrompt);
      const frontBytes = await comfy.generateImageWithRetry(frontPrompt, {
        width: 512, height: 512, steps, seed, cfgScale: cfg, samplerName: sampler,
        scheduler, checkpoint, vae, negativePrompt: negative, loras,
        removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
      }, 3, (attempt, max) => {
        set({ conceptViewsProgress: `Front: retrying (${attempt}/${max})...` });
      });
      await api.saveConceptImage(manifest.character_id, frontBytes, 'front');
      // Also save as default concept.png for backward compat
      await api.saveConceptImage(manifest.character_id, frontBytes);
      set({ conceptViewsProgress: 'Front done. Generating right view...' });

      // 2. Right: IP-Adapter from front + direction prompt
      const { getPose, renderPoseToPng } = await import('../lib/pose-templates.js');
      const rightPrompt = `${basePrompt}, ${CONCEPT_VIEW_PROMPTS.right}`;
      console.log('[Seurat] Concept views — right prompt:', rightPrompt);
      const idleRightPose = getPose('idle_right', 0);
      const rightPoseBytes = idleRightPose ? await renderPoseToPng(idleRightPose, 512, 512) : null;

      let rightBytes: Uint8Array;
      if (rightPoseBytes) {
        rightBytes = await comfy.generateIPAdapterWithRetry(rightPrompt, frontBytes, rightPoseBytes, {
          width: 512, height: 512, steps, seed: seed + 1, cfgScale: Math.min(cfg, 5), samplerName: sampler,
          checkpoint, negativePrompt: negative, denoise: 1.0, loras,
          ipAdapterWeight: 0.6, ipAdapterPreset: aiConfig.ipAdapterPreset,
          ipAdapterStartAt: 0.0, ipAdapterEndAt: 0.8,
          openPoseModel: aiConfig.openPoseModel, openPoseStrength: 0.8,
          removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
          outputWidth: 512, outputHeight: 512,
        });
      } else {
        // Fallback: img2img with direction prompt
        rightBytes = await comfy.generateImg2ImgWithRetry(rightPrompt, frontBytes, {
          width: 512, height: 512, steps, seed: seed + 1, cfgScale: cfg, samplerName: sampler,
          checkpoint, negativePrompt: negative, denoise: 0.65, loras,
          removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
        });
      }
      await api.saveConceptImage(manifest.character_id, rightBytes, 'right');
      set({ conceptViewsProgress: 'Right done. Generating back view...' });

      // 3. Back: IP-Adapter from front + back prompt
      const backPrompt = `${basePrompt}, ${CONCEPT_VIEW_PROMPTS.back}`;
      console.log('[Seurat] Concept views — back prompt:', backPrompt);
      const idleUpPose = getPose('idle_up', 0);
      const backPoseBytes = idleUpPose ? await renderPoseToPng(idleUpPose, 512, 512) : null;

      let backBytes: Uint8Array;
      if (backPoseBytes) {
        backBytes = await comfy.generateIPAdapterWithRetry(backPrompt, frontBytes, backPoseBytes, {
          width: 512, height: 512, steps, seed: seed + 2, cfgScale: Math.min(cfg, 5), samplerName: sampler,
          checkpoint, negativePrompt: negative, denoise: 1.0, loras,
          ipAdapterWeight: 0.5, ipAdapterPreset: aiConfig.ipAdapterPreset,
          ipAdapterStartAt: 0.0, ipAdapterEndAt: 0.8,
          openPoseModel: aiConfig.openPoseModel, openPoseStrength: 0.9,
          removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
          outputWidth: 512, outputHeight: 512,
        });
      } else {
        backBytes = await comfy.generateImg2ImgWithRetry(backPrompt, frontBytes, {
          width: 512, height: 512, steps, seed: seed + 2, cfgScale: cfg, samplerName: sampler,
          checkpoint, negativePrompt: negative, denoise: 0.7, loras,
          removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
        });
      }
      await api.saveConceptImage(manifest.character_id, backBytes, 'back');
      set({ conceptViewsProgress: 'Back done. Mirroring left from right...' });

      // 4. Left: mirror right horizontally
      const rightBlob = new Blob([rightBytes as BlobPart], { type: 'image/png' });
      const rightBitmap = await createImageBitmap(rightBlob);
      const canvas = new OffscreenCanvas(rightBitmap.width, rightBitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(rightBitmap, 0, 0);
      rightBitmap.close();
      const leftBlob = await canvas.convertToBlob({ type: 'image/png' });
      const leftBytes = new Uint8Array(await leftBlob.arrayBuffer());
      await api.saveConceptImage(manifest.character_id, leftBytes, 'left');

      // Update manifest
      const updated = {
        ...manifest,
        concept: {
          ...manifest.concept,
          reference_images: ['concept.png', 'concept_front.png', 'concept_back.png', 'concept_right.png', 'concept_left.png'],
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, loras },
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      // Reload URLs
      const id = manifest.character_id;
      set({
        conceptImageUrl: api.conceptImageUrl(id),
        conceptViewUrls: {
          front: api.conceptImageUrl(id, 'front'),
          back: api.conceptImageUrl(id, 'back'),
          right: api.conceptImageUrl(id, 'right'),
          left: api.conceptImageUrl(id, 'left'),
        },
        conceptViewsError: null,
        conceptViewsProgress: 'All 4 views generated.',
      });
    } catch (err) {
      set({ conceptViewsError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ conceptViewsGenerating: false });
    }
  },

  // Chibi
  saveChibi: async (chibi) => {
    const { manifest } = get();
    if (!manifest) return;
    const updated = { ...manifest, chibi };
    set({ manifest: updated });
    await api.saveManifest(updated);
  },

  chibiImageUrl: null,
  chibiGenerating: false,
  chibiError: null,

  generateChibiArt: async (overrides) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const chibi = manifest.chibi;
    const stylePrompt = chibi?.style_prompt || 'chibi, super deformed, 2-3 head body ratio, cute, simple features';
    const negPrompt = chibi?.negative_prompt || 'realistic, photograph, 3d render';

    set({ chibiGenerating: true, chibiError: null });

    try {
      // Load concept image for img2img
      const conceptBytes = await api.fetchConceptImageBytes(manifest.character_id);

      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      const prompt = [stylePrompt, manifest.concept.description].filter(Boolean).join(', ');
      const negative = `${negPrompt}, watermark, text, signature`;

      const steps = overrides?.steps ?? aiConfig.steps;
      const cfg = overrides?.cfg ?? aiConfig.cfg;
      const sampler = overrides?.sampler ?? aiConfig.sampler;
      const rawSeed = overrides?.seed ?? aiConfig.seed;
      const seed = rawSeed === -1 ? Math.floor(Math.random() * 2147483647) : rawSeed;
      const denoise = overrides?.denoise ?? 0.6;
      const loras = overrides?.loras !== undefined
        ? overrides.loras.filter((l) => l.name.trim())
        : aiConfig.loras.filter((l) => l.name.trim());
      const checkpoint = overrides?.checkpoint ?? aiConfig.checkpoint;
      const scheduler = overrides?.scheduler;
      const vae = overrides?.vae;

      console.log('[Seurat] Chibi prompt:', prompt);

      const pngBytes = await comfy.generateImg2ImgWithRetry(prompt, conceptBytes, {
        width: 512,
        height: 512,
        steps,
        seed,
        cfgScale: cfg,
        samplerName: sampler,
        scheduler,
        checkpoint,
        vae,
        negativePrompt: negative,
        denoise,
        loras,
        removeBackground: aiConfig.removeBackground,
        remBgNodeType: aiConfig.remBgNodeType,
      });

      await api.saveChibiImage(manifest.character_id, pngBytes);

      const updated = {
        ...manifest,
        chibi: {
          style_prompt: stylePrompt,
          negative_prompt: negPrompt,
          reference_image: 'chibi.png',
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, denoise, loras },
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      set({ chibiImageUrl: api.chibiImageUrl(manifest.character_id), chibiError: null });
    } catch (err) {
      set({ chibiError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ chibiGenerating: false });
    }
  },

  uploadChibiImage: async (file) => {
    const { manifest } = get();
    if (!manifest) return;

    set({ chibiGenerating: true, chibiError: null });

    try {
      const arrayBuf = await file.arrayBuffer();
      const pngBytes = new Uint8Array(arrayBuf);
      await api.saveChibiImage(manifest.character_id, pngBytes);

      const updated = {
        ...manifest,
        chibi: {
          style_prompt: manifest.chibi?.style_prompt || 'chibi, super deformed, 2-3 head body ratio, cute, simple features',
          negative_prompt: manifest.chibi?.negative_prompt || 'realistic, photograph, 3d render',
          reference_image: 'chibi.png',
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      set({ chibiImageUrl: api.chibiImageUrl(manifest.character_id), chibiError: null });
    } catch (err) {
      set({ chibiError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ chibiGenerating: false });
    }
  },

  // Multi-view chibi
  chibiViewUrls: { front: null, back: null, right: null, left: null },
  chibiViewsGenerating: false,
  chibiViewsError: null,
  chibiViewsProgress: null,

  loadChibiViewUrls: () => {
    const { selectedCharacterId, manifest } = get();
    if (!selectedCharacterId) return;
    const urls: Record<ViewDirection, string | null> = { front: null, back: null, right: null, left: null };
    const refs = manifest?.chibi?.reference_images;
    if (refs) {
      for (const v of VIEW_DIRECTIONS) {
        if (refs[v]) {
          urls[v] = api.chibiImageUrl(selectedCharacterId, v);
        }
      }
    }
    set({ chibiViewUrls: urls });
  },

  generateChibiViews: async (overrides) => {
    const { manifest, aiConfig, conceptViewUrls } = get();
    if (!manifest) return;

    const chibi = manifest.chibi;
    const stylePrompt = chibi?.style_prompt || 'chibi, super deformed, 2-3 head body ratio, cute, simple features';
    const negPrompt = chibi?.negative_prompt || 'realistic, photograph, 3d render';

    set({ chibiViewsGenerating: true, chibiViewsError: null, chibiViewsProgress: 'Starting chibi views...' });

    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      const prompt = [stylePrompt, manifest.concept.description].filter(Boolean).join(', ');
      const negative = `${negPrompt}, watermark, text, signature`;

      const steps = overrides?.steps ?? aiConfig.steps;
      const cfg = overrides?.cfg ?? aiConfig.cfg;
      const sampler = overrides?.sampler ?? aiConfig.sampler;
      const rawSeed = overrides?.seed ?? aiConfig.seed;
      const seed = rawSeed === -1 ? Math.floor(Math.random() * 2147483647) : rawSeed;
      const denoise = overrides?.denoise ?? 0.6;
      const loras = overrides?.loras !== undefined
        ? overrides.loras.filter((l) => l.name.trim())
        : aiConfig.loras.filter((l) => l.name.trim());
      const checkpoint = overrides?.checkpoint ?? aiConfig.checkpoint;
      const scheduler = overrides?.scheduler;
      const vae = overrides?.vae;

      const viewsToGenerate: ViewDirection[] = ['front', 'right', 'back'];
      const chibiRefImages: Partial<Record<ViewDirection, string>> = {};

      for (const view of viewsToGenerate) {
        set({ chibiViewsProgress: `Generating chibi ${view}...` });

        // Try to load the corresponding concept view as img2img source
        let conceptBytes: Uint8Array;
        try {
          conceptBytes = await api.fetchConceptImageBytes(manifest.character_id, view);
        } catch {
          // Fall back to default concept image
          conceptBytes = await api.fetchConceptImageBytes(manifest.character_id);
        }

        const viewSeed = seed + (['front', 'right', 'back'].indexOf(view));
        const pngBytes = await comfy.generateImg2ImgWithRetry(prompt, conceptBytes, {
          width: 512, height: 512, steps, seed: viewSeed, cfgScale: cfg, samplerName: sampler,
          scheduler, checkpoint, vae, negativePrompt: negative, denoise, loras,
          removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
        });

        await api.saveChibiImage(manifest.character_id, pngBytes, view);
        chibiRefImages[view] = `chibi_${view}.png`;

        // Mirror right → left
        if (view === 'right') {
          set({ chibiViewsProgress: 'Mirroring chibi left from right...' });
          const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
          const bmp = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d')!;
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          const leftBlob = await canvas.convertToBlob({ type: 'image/png' });
          const leftBytes = new Uint8Array(await leftBlob.arrayBuffer());
          await api.saveChibiImage(manifest.character_id, leftBytes, 'left');
          chibiRefImages.left = 'chibi_left.png';
        }
      }

      // Also save front as default chibi.png for backward compat
      try {
        const frontBytes = await api.fetchChibiImageBytes(manifest.character_id, 'front');
        await api.saveChibiImage(manifest.character_id, frontBytes);
      } catch { /* best effort */ }

      // Update manifest
      const updated = {
        ...manifest,
        chibi: {
          style_prompt: stylePrompt,
          negative_prompt: negPrompt,
          reference_image: 'chibi.png',
          reference_images: chibiRefImages,
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, denoise, loras },
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      const id = manifest.character_id;
      set({
        chibiImageUrl: api.chibiImageUrl(id),
        chibiViewUrls: {
          front: api.chibiImageUrl(id, 'front'),
          back: api.chibiImageUrl(id, 'back'),
          right: api.chibiImageUrl(id, 'right'),
          left: api.chibiImageUrl(id, 'left'),
        },
        chibiViewsError: null,
        chibiViewsProgress: 'All 4 chibi views generated.',
      });
    } catch (err) {
      set({ chibiViewsError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ chibiViewsGenerating: false });
    }
  },

  // Per-direction reference overrides
  directionConceptOverride: { S: null, N: null, E: null, W: null },
  directionChibiOverride: { S: null, N: null, E: null, W: null },
  setDirectionConceptOverride: (dir, view) => set((s) => ({
    directionConceptOverride: { ...s.directionConceptOverride, [dir]: view },
  })),
  setDirectionChibiOverride: (dir, view) => set((s) => ({
    directionChibiOverride: { ...s.directionChibiOverride, [dir]: view },
  })),

  // Pixel
  savePixel: async (pixel) => {
    const { manifest } = get();
    if (!manifest) return;
    const updated = { ...manifest, pixel };
    set({ manifest: updated });
    await api.saveManifest(updated);
  },

  pixelImageUrl: null,
  pixelGenerating: false,
  pixelError: null,

  generatePixelArt: async (overrides) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const pixel = manifest.pixel;
    const stylePrompt = pixel?.style_prompt || 'pixel art, 8-bit, clean edges, retro game sprite';
    const negPrompt = pixel?.negative_prompt || 'blurry, realistic, 3d render, smooth shading';

    set({ pixelGenerating: true, pixelError: null });

    try {
      // Load chibi image for img2img
      const chibiBytes = await api.fetchChibiImageBytes(manifest.character_id);

      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      const prompt = [stylePrompt, manifest.concept.description].filter(Boolean).join(', ');
      const negative = `${negPrompt}, watermark, text, signature`;

      const steps = overrides?.steps ?? aiConfig.steps;
      const cfg = overrides?.cfg ?? aiConfig.cfg;
      const sampler = overrides?.sampler ?? aiConfig.sampler;
      const rawSeed = overrides?.seed ?? aiConfig.seed;
      const seed = rawSeed === -1 ? Math.floor(Math.random() * 2147483647) : rawSeed;
      const denoise = overrides?.denoise ?? 0.55;
      const loras = overrides?.loras !== undefined
        ? overrides.loras.filter((l) => l.name.trim())
        : aiConfig.loras.filter((l) => l.name.trim());
      const checkpoint = overrides?.checkpoint ?? aiConfig.checkpoint;
      const scheduler = overrides?.scheduler;
      const vae = overrides?.vae;

      console.log('[Seurat] Pixel prompt:', prompt);

      const { frame_width, frame_height } = manifest.spritesheet;
      const pngBytes = await comfy.generateImg2ImgWithRetry(prompt, chibiBytes, {
        width: Math.max(frame_width, 256),
        height: Math.max(frame_height, 256),
        steps,
        seed,
        cfgScale: cfg,
        samplerName: sampler,
        scheduler,
        checkpoint,
        vae,
        negativePrompt: negative,
        denoise,
        loras,
        removeBackground: aiConfig.removeBackground,
        remBgNodeType: aiConfig.remBgNodeType,
      });

      await api.savePixelImage(manifest.character_id, pngBytes);

      const updated = {
        ...manifest,
        pixel: {
          style_prompt: stylePrompt,
          negative_prompt: negPrompt,
          reference_image: 'pixel.png',
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, denoise, loras },
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      set({ pixelImageUrl: api.pixelImageUrl(manifest.character_id), pixelError: null });
    } catch (err) {
      set({ pixelError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ pixelGenerating: false });
    }
  },

  uploadPixelImage: async (file) => {
    const { manifest } = get();
    if (!manifest) return;

    set({ pixelGenerating: true, pixelError: null });

    try {
      const arrayBuf = await file.arrayBuffer();
      const pngBytes = new Uint8Array(arrayBuf);
      await api.savePixelImage(manifest.character_id, pngBytes);

      const updated = {
        ...manifest,
        pixel: {
          style_prompt: manifest.pixel?.style_prompt || 'pixel art, 8-bit, clean edges, retro game sprite',
          negative_prompt: manifest.pixel?.negative_prompt || 'blurry, realistic, 3d render, smooth shading',
          reference_image: 'pixel.png',
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      set({ pixelImageUrl: api.pixelImageUrl(manifest.character_id), pixelError: null });
    } catch (err) {
      set({ pixelError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ pixelGenerating: false });
    }
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
    const { manifest: _manifest, aiConfig, directionConceptOverride, directionChibiOverride } = get();
    if (!_manifest) return;
    const manifest = _manifest; // non-null assertion for closures

    const comfy = new ComfyUIClient(aiConfig.comfyUrl);
    const hasConceptImage = manifest.concept.reference_images.length > 0;

    // Per-direction reference loading with cache
    const conceptCache: Partial<Record<ViewDirection | '_default', Uint8Array>> = {};
    const chibiCache: Partial<Record<ViewDirection | '_default', Uint8Array>> = {};

    // Helper: get concept bytes for a given direction code (with override support)
    async function getConceptBytesForDir(dir: DirectionCode): Promise<Uint8Array | null> {
      if (!hasConceptImage) return null;
      const overrideView = directionConceptOverride[dir];
      const view = overrideView ?? DIRECTION_TO_VIEW[dir];
      // Try direction-specific first, then fall back to default
      if (conceptCache[view]) return conceptCache[view]!;
      try {
        const bytes = await api.fetchConceptImageBytes(manifest.character_id, view);
        conceptCache[view] = bytes;
        console.log(`[Seurat] Loaded concept image (${view}): ${bytes.length} bytes`);
        return bytes;
      } catch {
        // Fall back to default concept image
        if (conceptCache['_default']) return conceptCache['_default']!;
        try {
          const bytes = await api.fetchConceptImageBytes(manifest.character_id);
          conceptCache['_default'] = bytes;
          console.log(`[Seurat] Loaded default concept image: ${bytes.length} bytes`);
          return bytes;
        } catch (err) {
          console.warn('[Seurat] Failed to load concept image:', err);
          return null;
        }
      }
    }

    async function getChibiBytesForDir(dir: DirectionCode): Promise<Uint8Array | null> {
      if (!manifest.chibi?.reference_image) return null;
      const overrideView = directionChibiOverride[dir];
      const view = overrideView ?? DIRECTION_TO_VIEW[dir];
      if (chibiCache[view]) return chibiCache[view]!;
      try {
        const bytes = await api.fetchChibiImageBytes(manifest.character_id, view);
        chibiCache[view] = bytes;
        console.log(`[Seurat] Loaded chibi image (${view}): ${bytes.length} bytes`);
        return bytes;
      } catch {
        if (chibiCache['_default']) return chibiCache['_default']!;
        try {
          const bytes = await api.fetchChibiImageBytes(manifest.character_id);
          chibiCache['_default'] = bytes;
          console.log(`[Seurat] Loaded default chibi image: ${bytes.length} bytes`);
          return bytes;
        } catch (err) {
          console.warn('[Seurat] Failed to load chibi image:', err);
          return null;
        }
      }
    }

    // Load default references for non-direction-aware paths
    let conceptBytes: Uint8Array | null = null;
    let chibiBytes: Uint8Array | null = null;

    if (hasConceptImage) {
      try {
        conceptBytes = await api.fetchConceptImageBytes(manifest.character_id);
        conceptCache['_default'] = conceptBytes;
        console.log(`[Seurat] Loaded concept image: ${conceptBytes.length} bytes`);
      } catch (err) {
        console.warn('[Seurat] Failed to load concept image:', err);
      }
    }
    if (manifest.chibi?.reference_image) {
      try {
        chibiBytes = await api.fetchChibiImageBytes(manifest.character_id);
        chibiCache['_default'] = chibiBytes;
        console.log(`[Seurat] Loaded chibi image: ${chibiBytes.length} bytes`);
      } catch (err) {
        console.warn('[Seurat] Failed to load chibi image:', err);
      }
    }

    // For single-pass modes: pick best available reference (chibi > concept)
    let singlePassRef: Uint8Array | null = chibiBytes ?? conceptBytes;

    if (!singlePassRef) {
      console.log('[Seurat] No reference image, using txt2img mode');
    }

    // Two-pass mode: available when both concept and chibi exist + IP-Adapter enabled
    const canTwoPass = !!(conceptBytes && chibiBytes && aiConfig.useIPAdapter);
    if (canTwoPass) {
      console.log('[Seurat] Two-pass mode available: Concept→Pose→Chibi→Pixel');
    }

    // Import prompt builders and pose templates
    const { buildFramePrompt, buildSheetRowPrompt, buildNegativePrompt } = await import('../lib/ai-generate.js');
    const { getPose, renderPoseToPng, getAnimationPoses, renderPoseStripToPng } = await import('../lib/pose-templates.js');
    const loras = aiConfig.loras.filter((l) => l.name.trim());
    let negative = buildNegativePrompt(manifest);
    // When IP-Adapter is active: skip LoRAs (conflict with IP-Adapter style),
    // cap CFG, force denoise=1.0 (EmptyLatentImage), add anti-saturation terms
    const ipaActive = aiConfig.useIPAdapter;
    const ipaCfg = ipaActive ? Math.min(aiConfig.cfg, 5) : aiConfig.cfg;
    const ipaDenoise = 1.0;
    const ipaLoras = loras;
    if (ipaActive) {
      negative += ', oversaturated, neon, vibrant colors, high contrast';
    }

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
        const pose = aiConfig.useIPAdapter
          ? (get().poseOverrides[`${animName}:${frameIndex}`] ?? getPose(animName, frameIndex))
          : null;

        if (canTwoPass && pose) {
          // Two-pass mode: Concept→Pose→Chibi→Pixel (direction-aware refs)
          const genSize = 512;
          const dirConceptBytes = await getConceptBytesForDir(anim.direction) ?? conceptBytes!;
          const dirChibiBytes = await getChibiBytesForDir(anim.direction) ?? chibiBytes!;
          console.log(`[Seurat] Generating single frame via two-pass (Concept→Pose→Chibi) (${genSize}x${genSize} → ${manifest.spritesheet.frame_width}x${manifest.spritesheet.frame_height})...`);
          const poseBytes = await renderPoseToPng(pose, genSize, genSize);
          pngBytes = await comfy.generateTwoPassIPAdapterWithRetry(prompt, dirConceptBytes, dirChibiBytes, poseBytes, {
            width: genSize, height: genSize,
            steps: aiConfig.steps, seed, cfgScale: ipaCfg, samplerName: aiConfig.sampler,
            checkpoint: aiConfig.checkpoint,
            negativePrompt: negative, denoise: ipaDenoise, loras: ipaLoras,
            ipAdapterWeight: aiConfig.ipAdapterWeight,
            ipAdapterPreset: aiConfig.ipAdapterPreset,
            ipAdapterStartAt: aiConfig.ipAdapterStartAt,
            ipAdapterEndAt: aiConfig.ipAdapterEndAt,
            openPoseModel: aiConfig.openPoseModel,
            openPoseStrength: aiConfig.openPoseStrength,
            chibiWeight: aiConfig.chibiWeight,
            chibiDenoise: aiConfig.chibiDenoise,
            pixelPassEnabled: aiConfig.pixelPassEnabled,
            pixelPassDenoise: aiConfig.pixelPassDenoise,
            pixelPassLoras: aiConfig.loras.filter((l) => l.name.trim()),
            removeBackground: aiConfig.removeBackground,
            remBgNodeType: aiConfig.remBgNodeType,
            outputWidth: manifest.spritesheet.frame_width,
            outputHeight: manifest.spritesheet.frame_height,
          });
        } else if (aiConfig.useIPAdapter && singlePassRef && pose) {
          // Single-pass IP-Adapter + OpenPose mode (direction-aware ref)
          const genSize = 512;
          const dirRef = await getConceptBytesForDir(anim.direction) ?? singlePassRef;
          console.log(`[Seurat] Generating single frame via IP-Adapter + OpenPose (${genSize}x${genSize} → ${manifest.spritesheet.frame_width}x${manifest.spritesheet.frame_height})...`);
          const poseBytes = await renderPoseToPng(pose, genSize, genSize);
          pngBytes = await comfy.generateIPAdapterWithRetry(prompt, dirRef, poseBytes, {
            width: genSize, height: genSize,
            steps: aiConfig.steps, seed, cfgScale: ipaCfg, samplerName: aiConfig.sampler,
            checkpoint: aiConfig.checkpoint,
            negativePrompt: negative, denoise: ipaDenoise, loras: ipaLoras,
            ipAdapterWeight: aiConfig.ipAdapterWeight,
            ipAdapterPreset: aiConfig.ipAdapterPreset,
            ipAdapterStartAt: aiConfig.ipAdapterStartAt,
            ipAdapterEndAt: aiConfig.ipAdapterEndAt,
            openPoseModel: aiConfig.openPoseModel,
            openPoseStrength: aiConfig.openPoseStrength,
            removeBackground: aiConfig.removeBackground,
            remBgNodeType: aiConfig.remBgNodeType,
            outputWidth: manifest.spritesheet.frame_width,
            outputHeight: manifest.spritesheet.frame_height,
          });
        } else if (singlePassRef) {
          console.log('[Seurat] Generating single frame via img2img...');
          pngBytes = await comfy.generateImg2ImgWithRetry(prompt, singlePassRef, {
            width: manifest.spritesheet.frame_width, height: manifest.spritesheet.frame_height,
            steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
            checkpoint: aiConfig.checkpoint,
            negativePrompt: negative, denoise: aiConfig.denoise, loras,
            removeBackground: aiConfig.removeBackground,
            remBgNodeType: aiConfig.remBgNodeType,
          });
        } else {
          console.log('[Seurat] Generating single frame via txt2img...');
          pngBytes = await comfy.generateImageWithRetry(prompt, {
            width: manifest.spritesheet.frame_width, height: manifest.spritesheet.frame_height,
            steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
            checkpoint: aiConfig.checkpoint,
            negativePrompt: negative, loras,
            removeBackground: aiConfig.removeBackground,
            remBgNodeType: aiConfig.remBgNodeType,
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
          const frameCount = anim.frames.length;
          const fw = manifest.spritesheet.frame_width;
          const fh = manifest.spritesheet.frame_height;
          const seed = aiConfig.seed === -1
            ? Math.floor(Math.random() * 2147483647)
            : aiConfig.seed;

          // Check if IP-Adapter per-frame mode applies (with pose overrides)
          const overrides = get().poseOverrides;
          const animPoses = aiConfig.useIPAdapter ? getAnimationPoses(an, frameCount)?.map(
            (p, i) => overrides[`${an}:${i}`] ?? p
          ) ?? null : null;

          if (aiConfig.useAnimateDiff && singlePassRef) {
            // AnimateDiff mode: generate animation frames via motion model, then slice
            const genSize = 512;
            console.log(`[Seurat] Row "${an}": AnimateDiff mode, ${frameCount} frames at ${genSize}x${genSize}...`);

            const animResult = await comfy.generateAnimateDiffWithRetry(
              buildSheetRowPrompt(manifest, anim),
              singlePassRef,
              {
                width: genSize,
                height: genSize,
                steps: aiConfig.steps,
                seed,
                cfgScale: aiConfig.cfg,
                samplerName: aiConfig.sampler,
                checkpoint: aiConfig.checkpoint,
                negativePrompt: negative,
                denoise: aiConfig.denoise,
                loras,
                motionModel: aiConfig.motionModel,
                frameCount,
                frameRate: aiConfig.animFrameRate,
                contextLength: aiConfig.animContextLength,
                outputFormat: 'image/gif',
                loopCount: 0,
              },
            );
            console.log(`[Seurat] Row "${an}": AnimateDiff returned ${animResult.length} bytes (first frame PNG)`);

            // AnimateDiff saves individual frames as vulkan_game_anim_frame_*.png in ComfyUI output.
            // The API returns the first frame; fetch remaining frames from ComfyUI output via history.
            // For now, save the returned frame as frame 0 and fetch the rest from SaveImage outputs.
            await api.saveFrameImage(manifest.character_id, an, 0, animResult);
            const current0 = get().manifest;
            if (current0) {
              const updated = structuredClone(current0);
              const f = updated.animations.find((x) => x.name === an)?.frames.find((x) => x.index === 0);
              if (f) { f.status = 'generated'; f.file = `${an}/${an}_0.png`; }
              set({ manifest: updated });
            }

            // Fetch remaining frames from ComfyUI output (SaveImage node saves each batch frame)
            for (let i = 1; i < frameCount; i++) {
              try {
                // The SaveImage node uses filename_prefix "vulkan_game_anim_frame_" and
                // each batch image is numbered sequentially. We fetch via /view endpoint.
                const paddedIdx = String(i + 1).padStart(5, '0');
                const filename = `vulkan_game_anim_frame__${paddedIdx}_.png`;
                const viewUrl = `${aiConfig.comfyUrl}/view?filename=${encodeURIComponent(filename)}&type=output`;
                const res = await fetch(viewUrl);
                if (!res.ok) {
                  console.warn(`[Seurat] Row "${an}" frame ${i}: failed to fetch ${filename}`);
                  continue;
                }
                const buf = await res.arrayBuffer();
                const frameBytes = new Uint8Array(buf);

                await api.saveFrameImage(manifest.character_id, an, i, frameBytes);
                const curr = get().manifest;
                if (curr) {
                  const upd = structuredClone(curr);
                  const f = upd.animations.find((x) => x.name === an)?.frames.find((x) => x.index === i);
                  if (f) { f.status = 'generated'; f.file = `${an}/${an}_${i}.png`; }
                  set({ manifest: upd });
                }
              } catch (err) {
                console.warn(`[Seurat] Row "${an}" frame ${i}: fetch error:`, err);
              }
            }
          } else if (canTwoPass && animPoses) {
            // Two-pass mode: Concept→Pose→Chibi→Pixel per-frame (direction-aware refs)
            const genSize = 512;
            console.log(`[Seurat] Row "${an}": Two-pass mode (Concept→Pose→Chibi), ${frameCount} frames (${genSize}x${genSize} → ${fw}x${fh})...`);

            // Load direction-specific references
            const dirConceptBytes = await getConceptBytesForDir(anim.direction) ?? conceptBytes!;
            const dirChibiBytes = await getChibiBytesForDir(anim.direction) ?? chibiBytes!;

            for (let i = 0; i < frameCount; i++) {
              const framePrompt = buildFramePrompt(manifest, anim, i);
              const frameSeed = aiConfig.consistentSeed ? seed : seed + i;
              const poseBytes = await renderPoseToPng(animPoses[i], genSize, genSize);
              console.log(`[Seurat] Row "${an}" frame ${i}: generating via two-pass (seed=${frameSeed}, consistent=${aiConfig.consistentSeed})...`);

              const frameBytes = await comfy.generateTwoPassIPAdapterWithRetry(framePrompt, dirConceptBytes, dirChibiBytes, poseBytes, {
                width: genSize, height: genSize,
                steps: aiConfig.steps, seed: frameSeed, cfgScale: ipaCfg, samplerName: aiConfig.sampler,
                checkpoint: aiConfig.checkpoint,
                negativePrompt: negative, denoise: ipaDenoise, loras: ipaLoras,
                ipAdapterWeight: aiConfig.ipAdapterWeight,
                ipAdapterPreset: aiConfig.ipAdapterPreset,
                ipAdapterStartAt: aiConfig.ipAdapterStartAt,
                ipAdapterEndAt: aiConfig.ipAdapterEndAt,
                openPoseModel: aiConfig.openPoseModel,
                openPoseStrength: aiConfig.openPoseStrength,
                chibiWeight: aiConfig.chibiWeight,
                chibiDenoise: aiConfig.chibiDenoise,
                pixelPassEnabled: aiConfig.pixelPassEnabled,
                pixelPassDenoise: aiConfig.pixelPassDenoise,
                pixelPassLoras: aiConfig.loras.filter((l) => l.name.trim()),
                removeBackground: aiConfig.removeBackground,
                remBgNodeType: aiConfig.remBgNodeType,
                outputWidth: fw,
                outputHeight: fh,
              });

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
          } else if (aiConfig.useIPAdapter && singlePassRef && animPoses) {
            // Single-pass IP-Adapter + OpenPose fallback (direction-aware refs)
            const genSize = 512;
            console.log(`[Seurat] Row "${an}": IP-Adapter + OpenPose mode, ${frameCount} frames (${genSize}x${genSize} → ${fw}x${fh})...`);

            // Load direction-specific reference (concept or chibi for this direction)
            const dirRef = await getConceptBytesForDir(anim.direction) ?? singlePassRef;

            for (let i = 0; i < frameCount; i++) {
              const framePrompt = buildFramePrompt(manifest, anim, i);
              const frameSeed = aiConfig.consistentSeed ? seed : seed + i;
              const poseBytes = await renderPoseToPng(animPoses[i], genSize, genSize);
              console.log(`[Seurat] Row "${an}" frame ${i}: generating via IP-Adapter (seed=${frameSeed}, consistent=${aiConfig.consistentSeed})...`);

              const frameBytes = await comfy.generateIPAdapterWithRetry(framePrompt, dirRef, poseBytes, {
                width: genSize, height: genSize,
                steps: aiConfig.steps, seed: frameSeed, cfgScale: ipaCfg, samplerName: aiConfig.sampler,
                checkpoint: aiConfig.checkpoint,
                negativePrompt: negative, denoise: ipaDenoise, loras: ipaLoras,
                ipAdapterWeight: aiConfig.ipAdapterWeight,
                ipAdapterPreset: aiConfig.ipAdapterPreset,
                ipAdapterStartAt: aiConfig.ipAdapterStartAt,
                ipAdapterEndAt: aiConfig.ipAdapterEndAt,
                openPoseModel: aiConfig.openPoseModel,
                openPoseStrength: aiConfig.openPoseStrength,
                removeBackground: aiConfig.removeBackground,
                remBgNodeType: aiConfig.remBgNodeType,
                outputWidth: fw,
                outputHeight: fh,
              });

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
          } else {
            // Existing row-based generation (tiled strip)
            const prompt = buildSheetRowPrompt(manifest, anim);
            console.log(`[Seurat] Row "${an}" prompt:`, prompt);
            const sheetWidth = fw * frameCount;
            const sheetHeight = fh;
            console.log(`[Seurat] Row "${an}": ${frameCount} frames, ${sheetWidth}x${sheetHeight}`);

            let pngBytes: Uint8Array;
            if (singlePassRef && aiConfig.controlNetModel) {
              console.log(`[Seurat] Row "${an}": ControlNet mode, tiling reference image...`);
              const tiledBytes = await tileImageHorizontally(singlePassRef, frameCount, sheetWidth, sheetHeight);
              pngBytes = await comfy.generateControlNetWithRetry(prompt, tiledBytes, {
                width: sheetWidth, height: sheetHeight,
                steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
                checkpoint: aiConfig.checkpoint,
                negativePrompt: negative, denoise: aiConfig.denoise, loras,
                controlNetModel: aiConfig.controlNetModel,
                controlStrength: aiConfig.controlStrength,
                removeBackground: aiConfig.removeBackground,
                remBgNodeType: aiConfig.remBgNodeType,
              });
            } else if (singlePassRef) {
              console.log(`[Seurat] Row "${an}": img2img mode, tiling reference image...`);
              const tiledBytes = await tileImageHorizontally(singlePassRef, frameCount, sheetWidth, sheetHeight);
              pngBytes = await comfy.generateImg2ImgWithRetry(prompt, tiledBytes, {
                width: sheetWidth, height: sheetHeight,
                steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
                checkpoint: aiConfig.checkpoint,
                negativePrompt: negative, denoise: aiConfig.denoise, loras,
                removeBackground: aiConfig.removeBackground,
                remBgNodeType: aiConfig.remBgNodeType,
              });
            } else {
              console.log(`[Seurat] Row "${an}": txt2img mode...`);
              pngBytes = await comfy.generateImageWithRetry(prompt, {
                width: sheetWidth, height: sheetHeight,
                steps: aiConfig.steps, seed, cfgScale: aiConfig.cfg, samplerName: aiConfig.sampler,
                checkpoint: aiConfig.checkpoint,
                negativePrompt: negative, loras,
                removeBackground: aiConfig.removeBackground,
                remBgNodeType: aiConfig.remBgNodeType,
              });
            }
            console.log(`[Seurat] Row "${an}": got ${pngBytes.length} bytes from ComfyUI, slicing...`);

            // Slice the wide image into individual frames
            const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
            const bitmap = await createImageBitmap(blob);
            console.log(`[Seurat] Row "${an}": bitmap ${bitmap.width}x${bitmap.height}, slicing into ${frameCount} frames of ${fw}x${fh}`);

            for (let i = 0; i < frameCount; i++) {
              const canvas = new OffscreenCanvas(fw, fh);
              const ctx = canvas.getContext('2d')!;
              ctx.drawImage(bitmap, i * fw, 0, fw, fh, 0, 0, fw, fh);
              const frameBlob = await canvas.convertToBlob({ type: 'image/png' });
              const frameBuf = await frameBlob.arrayBuffer();
              const frameBytes = new Uint8Array(frameBuf);

              await api.saveFrameImage(manifest.character_id, an, i, frameBytes);
              const current = get().manifest;
              if (current) {
                const updated = structuredClone(current);
                const f = updated.animations.find((x) => x.name === an)?.frames.find((x) => x.index === i);
                if (f) { f.status = 'generated'; f.file = `${an}/${an}_${i}.png`; }
                set({ manifest: updated });
              }
            }
            bitmap.close();
          }
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

  // Pose editing
  poseOverrides: {},
  setPoseOverride: (animName, frameIndex, pose) => {
    const key = `${animName}:${frameIndex}`;
    set({ poseOverrides: { ...get().poseOverrides, [key]: pose } });
  },
  clearPoseOverride: (animName, frameIndex) => {
    const key = `${animName}:${frameIndex}`;
    const overrides = { ...get().poseOverrides };
    delete overrides[key];
    set({ poseOverrides: overrides });
  },
  clearAllPoseOverrides: (animName) => {
    const overrides = { ...get().poseOverrides };
    for (const key of Object.keys(overrides)) {
      if (key.startsWith(`${animName}:`)) delete overrides[key];
    }
    set({ poseOverrides: overrides });
  },

  // ComfyUI model lists
  availableCheckpoints: [],
  availableLoras: [],
  availableVaes: [],
  availableSchedulers: [],
  refreshComfyModels: async () => {
    const { aiConfig } = get();
    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      const [checkpoints, loras, vaes, schedulers] = await Promise.all([
        comfy.listCheckpoints(),
        comfy.listLoras(),
        comfy.listVaes(),
        comfy.listSchedulers(),
      ]);
      set({ availableCheckpoints: checkpoints, availableLoras: loras, availableVaes: vaes, availableSchedulers: schedulers });
    } catch {
      // ComfyUI not reachable — keep empty lists
    }
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
          generatedFrames: 0,
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
