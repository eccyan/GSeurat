import { create } from 'zustand';
import type {
  CharacterManifest,
  ConceptArt,
  ChibiArt,
  PixelArt,
  FrameStatus,
  PipelineStage,
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
  JobSource,
  ClipboardFrame,
  PlaybackState,
  ReviewFilter,
  AssembleResult,
  ProjectMeta,
  RecentProject,
} from './types.js';
import { DEFAULT_AI_CONFIG } from './types.js';

/** Create a generation job and add it to the store. Returns the job ID. */
function createJob(
  get: () => SeuratState,
  source: JobSource,
  label: string,
  extra?: Partial<GenerationJob>,
): string {
  const id = `${source}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const job: GenerationJob = { id, source, label, status: 'running', ...extra };
  get().addGenerationJob(job);
  return id;
}
import * as api from '../lib/bridge-api.js';

export { getManifestStats };

/** Map ViewDirection to template direction suffix (front→down, back→up, etc.) */
const VIEW_TO_TEMPLATE_DIR: Record<string, string> = {
  front: 'down', back: 'up', right: 'right', left: 'left',
};

/**
 * Resolve derived poses for an animation, respecting the reference direction override.
 * E.g., if run_right is overridden to use 'front', looks up derivedAnimPoses['run_down'].
 */
function resolveDerivedPose(
  derivedAnimPoses: Record<string, ([number, number] | null)[][]>,
  animName: string,
  frameIndex: number,
  animRefOverride: Record<string, ViewDirection | null>,
  animDirection?: DirectionCode,
): ([number, number] | null)[] | undefined {
  const override = animRefOverride[animName];
  let lookupName = animName;
  if (override) {
    // Remap animation name to the overridden direction
    const parts = animName.split('_');
    if (parts.length >= 2) {
      const state = parts[0];
      const newDir = VIEW_TO_TEMPLATE_DIR[override];
      if (newDir) lookupName = `${state}_${newDir}`;
    }
  }
  const dp = derivedAnimPoses[lookupName];
  return dp?.length ? dp[frameIndex % dp.length] : undefined;
}


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
  renameCharacter: (oldId: string, newId: string) => Promise<void>;

  // Cancel
  cancelGeneration: () => Promise<void>;

  // Concept
  saveConcept: (concept: ConceptArt) => Promise<void>;
  conceptImageUrl: string | null;
  conceptGenerating: boolean;
  conceptError: string | null;
  hasConceptBase: boolean;
  generateConceptArt: (overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string }) => Promise<void>;
  uploadConceptImage: (file: File) => Promise<void>;
  uploadConceptImageForView: (file: File, view: ViewDirection) => Promise<void>;
  loadConceptImage: () => void;
  detectedPoseUrl: string | null;
  detectedPoseBytes: Uint8Array | null;
  detectedViewPoseUrls: Record<ViewDirection, string | null>;
  detectedViewPoseBytes: Record<ViewDirection, Uint8Array | null>;
  detectingPose: boolean;
  detectConceptPose: () => Promise<void>;
  deriveDirectionalFromDetected: () => Promise<void>;
  detectConceptViewPoses: () => Promise<void>;

  // Directional poses
  conceptViewUrls: Record<ViewDirection, string | null>;
  conceptPoseGenerating: boolean;
  conceptPoseCurrentView: ViewDirection | null;
  conceptPoseError: string | null;
  conceptPoseProgress: string | null;
  generateConceptPoses: (views?: ViewDirection[], overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string }) => Promise<void>;
  loadConceptViewUrls: () => void;

  // Chibi
  saveChibi: (chibi: ChibiArt) => Promise<void>;
  chibiImageUrl: string | null;
  chibiGenerating: boolean;
  chibiError: string | null;
  generateChibiArt: (view: ViewDirection, overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string; denoise?: number; ipAdapterWeight?: number; ipAdapterEndAt?: number }) => Promise<void>;
  uploadChibiImage: (file: File) => Promise<void>;
  uploadChibiImageForView: (file: File, view: ViewDirection) => Promise<void>;

  // Multi-view chibi
  chibiViewUrls: Record<ViewDirection, string | null>;
  chibiViewsGenerating: boolean;
  chibiViewsError: string | null;
  chibiViewsProgress: string | null;
  generateChibiViews: (overrides?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; seed?: number; loras?: { name: string; weight: number }[]; checkpoint?: string; vae?: string; denoise?: number; ipAdapterWeight?: number; ipAdapterEndAt?: number }) => Promise<void>;
  loadChibiViewUrls: () => void;

  // Per-animation reference override — selects which direction's concept + chibi to use (null = auto)
  animRefOverride: Record<string, ViewDirection | null>;
  setAnimRefOverride: (animName: string, view: ViewDirection | null) => void;

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

  // Prompt override — if non-empty, replaces the auto-generated frame prompt
  promptOverride: string;
  setPromptOverride: (prompt: string) => void;

  // Frame selection (for pipeline grid row checkboxes)
  selectedFrames: Set<number>;
  toggleFrameSelection: (frameIndex: number) => void;
  selectAllFrames: (frameCount: number) => void;
  clearFrameSelection: () => void;

  // Pipeline (step-by-step)
  editingFrame: { animName: string; frameIndex: number; pass: PipelineStage } | null;
  setEditingFrame: (frame: { animName: string; frameIndex: number; pass: PipelineStage } | null) => void;
  clipboard: ClipboardFrame | null;
  copyFrame: (animName: string, frameIndex: number, pass: PipelineStage) => Promise<void>;
  pasteFrame: (animName: string, frameIndex: number, pass: PipelineStage) => Promise<void>;
  generatePass: (
    pass: 'pass1' | 'pass2' | 'pass3',
    animName: string,
    frameIndices?: number[],
  ) => Promise<void>;
  saveEditedFrame: (animName: string, frameIndex: number, pass: PipelineStage, pngBytes: Uint8Array) => Promise<void>;

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

  // Derived animation poses (from anchor skeleton)
  derivedAnimPoses: Record<string, ([number, number] | null)[][]>;
  derivingAnimPoses: boolean;
  deriveAnimationPoses: () => Promise<void>;

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

  // Interpolation
  interpProgress: string | null;
  interpolateAnimation: (animName: string, startFrame?: number, endFrame?: number) => Promise<void>;
  interpolateOddFrames: (animName: string) => Promise<void>;
  revertInterpolation: (animName: string) => Promise<void>;

  // Project
  project: ProjectMeta | null;
  projectPath: string | null;
  projectDirty: boolean;
  recentProjects: RecentProject[];
  exportProgress: string | null;
  exportError: string | null;
  createProject: (dirPath: string, name: string) => Promise<void>;
  openProject: (dirPath: string) => Promise<void>;
  closeProject: () => Promise<void>;
  saveProject: () => Promise<void>;
  exportCharacters: (opts: { characterIds?: string[]; format?: string; outputDir?: string }) => Promise<void>;

  // Test helpers (inject manifest directly without bridge)
  selectCharacterDirect: (manifest: CharacterManifest) => void;
}

export const useSeuratStore = create<SeuratState>((set, get) => ({
  // Navigation
  activeSection: 'dashboard',
  setActiveSection: (s) => set({ activeSection: s }),
  treeSelection: { kind: 'manifest' } as TreeSelection,
  setTreeSelection: (s) => set({ treeSelection: s }),

  // Cancel
  cancelGeneration: async () => {
    const { aiConfig } = get();
    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      await comfy.interrupt();
    } catch { /* best effort */ }
    set({
      conceptGenerating: false,
      conceptPoseGenerating: false,
      conceptPoseCurrentView: null,
      chibiGenerating: false,
      chibiViewsGenerating: false,
      conceptError: 'Cancelled.',
      conceptPoseError: null,
      chibiError: null,
      chibiViewsError: null,
    });
  },

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
      // Check if concept.png exists
      const hasConceptBase = refs.includes('concept.png') || refs.length > 0;
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
        hasConceptBase,
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
        animRefOverride: {},
        derivedAnimPoses: manifest.derived_poses ?? {},
        poseOverrides: manifest.pose_overrides ?? {},
      });

      // Restore skeleton files from disk (non-blocking)
      (async () => {
        try {
          const skeletonBytes = await api.fetchCharacterFile(id, 'skeleton.png');
          const blob = new Blob([skeletonBytes as BlobPart], { type: 'image/png' });
          set({ detectedPoseUrl: URL.createObjectURL(blob), detectedPoseBytes: skeletonBytes });
        } catch { /* no skeleton saved yet */ }

        const viewUrls = { ...get().detectedViewPoseUrls };
        const viewBytes = { ...get().detectedViewPoseBytes };
        for (const v of VIEW_DIRECTIONS) {
          try {
            const bytes = await api.fetchCharacterFile(id, `skeleton_${v}.png`);
            const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
            viewUrls[v] = URL.createObjectURL(blob);
            viewBytes[v] = bytes;
          } catch { /* not saved yet */ }
        }
        if (Object.values(viewBytes).some(Boolean)) {
          set({ detectedViewPoseUrls: viewUrls, detectedViewPoseBytes: viewBytes });
        }
      })();
    } catch {
      console.warn(`[Seurat] Could not load manifest for "${id}" — is the bridge running?`);
    }
  },

  createCharacter: async (id, name) => {
    const { aiConfig } = get();
    const manifest = createDefaultManifest(id, name, 128, 128, 4, 4, aiConfig.interpMultiplier);
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

  renameCharacter: async (oldId, newId) => {
    await api.renameCharacter(oldId, newId);
    await get().refreshCharacters();
    await get().selectCharacter(newId);
    set({ treeSelection: { kind: 'character', characterId: newId } });
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
  hasConceptBase: false,

  generateConceptArt: async (overrides) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const { concept } = manifest;
    if (!concept.description && !concept.style_prompt) {
      set({ conceptError: 'Fill in a description or style prompt first.' });
      return;
    }

    set({ conceptGenerating: true, conceptError: null });
    const jobId = createJob(get, 'concept', 'Generate concept art');

    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);

      const { DEFAULT_NEGATIVE_PROMPT, CONCEPT_VIEW_PROMPTS, sanitizeStylePrompt } = await import('../lib/ai-generate.js');

      const prompt = [
        sanitizeStylePrompt(concept.style_prompt),
        concept.description,
        CONCEPT_VIEW_PROMPTS.front,
      ].filter(Boolean).join(', ');

      const negative = concept.negative_prompt
        ? `${concept.negative_prompt}, ${DEFAULT_NEGATIVE_PROMPT}, cropped, partial body`
        : `${DEFAULT_NEGATIVE_PROMPT}, cropped, partial body`;

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

      // Save as concept.png (identity anchor)
      await api.saveConceptImage(manifest.character_id, pngBytes);

      // Update manifest reference_images + generation settings
      const existingImages = manifest.concept.reference_images || [];
      const updatedImages = existingImages.includes('concept.png') ? existingImages : [...existingImages, 'concept.png'];
      const updated = {
        ...manifest,
        concept: {
          ...manifest.concept,
          reference_images: updatedImages,
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, loras },
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      const cb = `?t=${Date.now()}`;
      set({
        conceptImageUrl: api.conceptImageUrl(manifest.character_id) + cb,
        hasConceptBase: true,
        conceptError: null,
      });
      get().updateGenerationJob(jobId, { status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ conceptError: msg });
      get().updateGenerationJob(jobId, { status: 'error', error: msg });
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

      set({ conceptImageUrl: api.conceptImageUrl(manifest.character_id), hasConceptBase: true, conceptError: null });
    } catch (err) {
      set({ conceptError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ conceptGenerating: false });
    }
  },

  uploadConceptImageForView: async (file, view) => {
    const { manifest } = get();
    if (!manifest) return;

    set({ conceptGenerating: true, conceptError: null });

    try {
      const arrayBuf = await file.arrayBuffer();
      const pngBytes = new Uint8Array(arrayBuf);

      await api.saveConceptImage(manifest.character_id, pngBytes, view);

      const viewFile = `concept_${view}.png`;
      const existingRefs = manifest.concept.reference_images;
      const refs = existingRefs.includes(viewFile) ? existingRefs : [...existingRefs, viewFile];

      const updated = {
        ...manifest,
        concept: {
          ...manifest.concept,
          reference_images: refs,
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      const { conceptViewUrls } = get();
      set({
        conceptViewUrls: {
          ...conceptViewUrls,
          [view]: api.conceptImageUrl(manifest.character_id, view) + '&t=' + Date.now(),
        },
        conceptError: null,
      });
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

  detectedPoseUrl: null,
  detectedPoseBytes: null,
  detectedViewPoseUrls: { front: null, back: null, right: null, left: null },
  detectedViewPoseBytes: { front: null, back: null, right: null, left: null },
  detectingPose: false,
  detectConceptPose: async () => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    let conceptBytes: Uint8Array | null = null;
    try {
      conceptBytes = await api.fetchConceptImageBytes(manifest.character_id);
    } catch { /* missing */ }
    if (!conceptBytes) {
      set({ conceptError: 'No concept image to detect pose from.' });
      return;
    }

    set({ detectingPose: true, detectedPoseUrl: null });
    const skelJobId = createJob(get, 'detect_skeleton', 'Detect skeleton');
    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);

      // Remove background, then composite on white for cleaner pose detection.
      // OpenPose needs a solid background — transparent PNGs produce blank results.
      let cleanBytes = conceptBytes;
      if (aiConfig.removeBackground) {
        try {
          const rmbgBytes = await comfy.removeBackground(conceptBytes, aiConfig.remBgNodeType);
          // Composite on white background
          const blob = new Blob([rmbgBytes as BlobPart], { type: 'image/png' });
          const bmp = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          const whiteBlob = await canvas.convertToBlob({ type: 'image/png' });
          cleanBytes = new Uint8Array(await whiteBlob.arrayBuffer());
        } catch {
          console.warn('[Seurat] Background removal failed before pose detection, using original image');
        }
      }

      const poseBytes = await comfy.detectOpenPose(cleanBytes, { resolution: 512 });
      const blob = new Blob([poseBytes as BlobPart], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      set({ detectedPoseUrl: url, detectedPoseBytes: poseBytes });

      // Persist skeleton to disk
      await api.saveCharacterFile(manifest.character_id, 'skeleton.png', poseBytes);
      get().updateGenerationJob(skelJobId, { status: 'done' });
    } catch (err) {
      const msg = `Pose detection failed: ${err instanceof Error ? err.message : String(err)}`;
      set({ conceptError: msg });
      get().updateGenerationJob(skelJobId, { status: 'error', error: msg });
    } finally {
      set({ detectingPose: false });
    }
  },

  deriveDirectionalFromDetected: async () => {
    const { detectedPoseBytes } = get();
    if (!detectedPoseBytes) {
      set({ conceptError: 'Detect the concept pose first.' });
      return;
    }

    set({ detectingPose: true, conceptPoseProgress: 'Extracting keypoints from detected pose...' });
    const deriveJobId = createJob(get, 'derive_poses', 'Derive view skeletons');
    try {
      const { extractKeypointsFromPoseImage, deriveDirectionalPoses } = await import('../lib/pose-templates.js');

      const keypoints = await extractKeypointsFromPoseImage(detectedPoseBytes);
      const validCount = keypoints.filter((k) => k !== null).length;
      console.log(`[Seurat] Extracted ${validCount}/14 keypoints from detected pose`);

      if (validCount < 5) {
        set({ conceptPoseError: `Only ${validCount} keypoints detected — not enough to derive poses.` });
        return;
      }

      set({ conceptPoseProgress: 'Deriving directional poses...' });
      const dirPoses = await deriveDirectionalPoses(keypoints);

      const updatedUrls = { ...get().detectedViewPoseUrls };
      const updatedBytes = { ...get().detectedViewPoseBytes };

      // Front: use the original DWPreprocessor image directly (not re-rendered)
      const frontBlob = new Blob([detectedPoseBytes as BlobPart], { type: 'image/png' });
      updatedUrls.front = URL.createObjectURL(frontBlob);
      updatedBytes.front = detectedPoseBytes;

      // Other directions: use derived poses
      for (const [dir, pngBytes] of Object.entries(dirPoses)) {
        if (dir === 'front') continue; // already set above
        const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
        updatedUrls[dir as ViewDirection] = URL.createObjectURL(blob);
        updatedBytes[dir as ViewDirection] = pngBytes;
      }

      set({
        detectedViewPoseUrls: updatedUrls,
        detectedViewPoseBytes: updatedBytes,
        conceptPoseProgress: `Derived ${Object.keys(dirPoses).length} directional poses from concept.`,
      });

      // Persist view skeletons to disk
      const { manifest: m } = get();
      if (m) {
        await api.saveCharacterFile(m.character_id, 'skeleton_front.png', detectedPoseBytes);
        for (const [dir, pngBytes] of Object.entries(dirPoses)) {
          if (dir === 'front') continue;
          await api.saveCharacterFile(m.character_id, `skeleton_${dir}.png`, pngBytes);
        }
      }
      get().updateGenerationJob(deriveJobId, { status: 'done' });
    } catch (err) {
      const msg = `Pose derivation failed: ${err instanceof Error ? err.message : String(err)}`;
      set({ conceptPoseError: msg });
      get().updateGenerationJob(deriveJobId, { status: 'error', error: msg });
    } finally {
      set({ detectingPose: false });
    }
  },

  detectConceptViewPoses: async () => {
    const { manifest, aiConfig, conceptViewUrls } = get();
    if (!manifest) return;

    const comfy = new ComfyUIClient(aiConfig.comfyUrl);
    const views: ViewDirection[] = ['front', 'back', 'right', 'left'];

    set({ detectingPose: true, conceptPoseProgress: 'Detecting poses from directional views...' });

    const updatedUrls = { ...get().detectedViewPoseUrls };
    const updatedBytes = { ...get().detectedViewPoseBytes };

    try {
      for (const view of views) {
        const viewUrl = conceptViewUrls[view];
        if (!viewUrl) continue;

        set({ conceptPoseProgress: `Detecting ${view} pose...`, conceptPoseCurrentView: view });

        try {
          // Fetch the directional concept image
          const resp = await fetch(viewUrl);
          if (!resp.ok) continue;
          let imageBytes = new Uint8Array(await resp.arrayBuffer());

          // RemBG → composite on white
          if (aiConfig.removeBackground) {
            try {
              const rmbgBytes = await comfy.removeBackground(imageBytes, aiConfig.remBgNodeType);
              const blob = new Blob([rmbgBytes as BlobPart], { type: 'image/png' });
              const bmp = await createImageBitmap(blob);
              const canvas = new OffscreenCanvas(bmp.width, bmp.height);
              const ctx = canvas.getContext('2d')!;
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(bmp, 0, 0);
              bmp.close();
              const whiteBlob = await canvas.convertToBlob({ type: 'image/png' });
              imageBytes = new Uint8Array(await whiteBlob.arrayBuffer());
            } catch {
              console.warn(`[Seurat] RemBG failed for ${view} pose detection, using original`);
            }
          }

          const poseBytes = await comfy.detectOpenPose(imageBytes, { resolution: 512 });
          const blob = new Blob([poseBytes as BlobPart], { type: 'image/png' });
          updatedUrls[view] = URL.createObjectURL(blob);
          updatedBytes[view] = poseBytes;
          // Persist to disk
          await api.saveCharacterFile(manifest.character_id, `skeleton_${view}.png`, poseBytes);
          console.log(`[Seurat] Detected pose for ${view} view`);
        } catch (err) {
          console.warn(`[Seurat] Pose detection failed for ${view}:`, err);
        }
      }

      set({
        detectedViewPoseUrls: updatedUrls,
        detectedViewPoseBytes: updatedBytes,
        conceptPoseProgress: 'Pose detection complete.',
      });
    } catch (err) {
      set({ conceptPoseError: `View pose detection failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      set({ detectingPose: false, conceptPoseCurrentView: null });
    }
  },

  // Directional poses
  conceptViewUrls: { front: null, back: null, right: null, left: null },
  conceptPoseGenerating: false,
  conceptPoseCurrentView: null,
  conceptPoseError: null,
  conceptPoseProgress: null,

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

  generateConceptPoses: async (views, overrides) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const { concept } = manifest;
    if (!concept.description && !concept.style_prompt) {
      set({ conceptPoseError: 'Fill in a description or style prompt first.' });
      return;
    }

    // Require concept.png to exist
    let conceptBytes: Uint8Array | null = null;
    try {
      conceptBytes = await api.fetchConceptImageBytes(manifest.character_id);
    } catch { /* missing */ }
    if (!conceptBytes) {
      set({ conceptPoseError: 'Generate or upload a concept image first.' });
      return;
    }

    const targetViews: ViewDirection[] = views ?? (['front', 'back', 'right', 'left'] as ViewDirection[]);
    set({ conceptPoseGenerating: true, conceptPoseError: null, conceptPoseProgress: `Generating ${targetViews.join(', ')}...` });
    const cpJobId = createJob(get, 'concept_pose', `Generate concept views (${targetViews.join(', ')})`);

    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      const { CONCEPT_VIEW_PROMPTS, DEFAULT_NEGATIVE_PROMPT, sanitizeStylePrompt } = await import('../lib/ai-generate.js');

      const basePrompt = [sanitizeStylePrompt(concept.style_prompt), concept.description].filter(Boolean).join(', ');
      const negative = concept.negative_prompt
        ? `${concept.negative_prompt}, ${DEFAULT_NEGATIVE_PROMPT}, cropped, partial body`
        : `${DEFAULT_NEGATIVE_PROMPT}, cropped, partial body`;

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

      const { getPose, renderPoseToPng, CONCEPT_VIEW_POSES } = await import('../lib/pose-templates.js');

      const seedOffsets: Record<ViewDirection, number> = { front: 0, right: 1, back: 2, left: 3 };
      const ipWeights: Record<ViewDirection, number> = { front: 0.7, right: 0.6, back: 0.5, left: 0.6 };
      const poseStrengths: Record<ViewDirection, number> = { front: 0.8, right: 0.8, back: 0.9, left: 0.8 };

      // Track generated bytes for potential left mirror from right
      let rightBytes: Uint8Array | null = null;

      const generatedRefs: string[] = [];

      for (const view of targetViews) {
        set({ conceptPoseCurrentView: view, conceptPoseProgress: `Generating ${view} view...` });

        // Left view: mirror from right if right was generated (or exists)
        if (view === 'left') {
          let sourceBytes = rightBytes;
          if (!sourceBytes) {
            // Try to fetch existing right image
            try {
              const rightUrl = api.conceptImageUrl(manifest.character_id, 'right');
              const resp = await fetch(rightUrl);
              if (resp.ok) sourceBytes = new Uint8Array(await resp.arrayBuffer());
            } catch { /* no right image */ }
          }
          if (sourceBytes) {
            const rightBlob = new Blob([sourceBytes as BlobPart], { type: 'image/png' });
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
            generatedRefs.push('concept_left.png');
            set({ conceptPoseProgress: 'Left done (mirrored from right).' });
            continue;
          }
          // Fall through to IP-Adapter generation if no right source
        }

        const viewPrompt = `${basePrompt}, ${CONCEPT_VIEW_PROMPTS[view]}`;
        console.log(`[Seurat] Concept pose — ${view} prompt:`, viewPrompt);

        // Prefer: pose overrides > detected view pose > detected concept pose > template
        const { detectedPoseBytes: frontDetected, detectedViewPoseBytes, poseOverrides: overrides } = get();
        let poseBytes: Uint8Array | null = null;
        const poseDef = CONCEPT_VIEW_POSES[view];
        const overrideKey = poseDef ? `${poseDef.animName}:${poseDef.frameIndex}` : null;
        const poseOverride = overrideKey ? overrides[overrideKey] : null;

        if (poseOverride) {
          console.log(`[Seurat] Concept pose — ${view}: using edited skeleton override`);
          poseBytes = await renderPoseToPng(poseOverride, 512, 512);
        } else if (detectedViewPoseBytes[view]) {
          console.log(`[Seurat] Concept pose — ${view}: using detected pose from directional view`);
          poseBytes = detectedViewPoseBytes[view];
        } else if (view === 'front' && frontDetected) {
          console.log('[Seurat] Concept pose — front: using detected pose from concept image');
          poseBytes = frontDetected;
        } else {
          const pose = poseDef ? getPose(poseDef.animName, poseDef.frameIndex) : null;
          poseBytes = pose ? await renderPoseToPng(pose, 512, 512) : null;
        }

        let resultBytes: Uint8Array;
        if (poseBytes) {
          resultBytes = await comfy.generateIPAdapterWithRetry(viewPrompt, conceptBytes, poseBytes, {
            width: 512, height: 512, steps, seed: seed + seedOffsets[view], cfgScale: Math.min(cfg, 5), samplerName: sampler,
            checkpoint, negativePrompt: negative, denoise: 1.0, loras,
            ipAdapterWeight: ipWeights[view], ipAdapterPreset: aiConfig.ipAdapterPreset,
            ipAdapterStartAt: 0.0, ipAdapterEndAt: 0.8,
            openPoseModel: aiConfig.openPoseModel, openPoseStrength: poseStrengths[view],
            removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
            outputWidth: 512, outputHeight: 512,
          });
        } else {
          resultBytes = await comfy.generateImg2ImgWithRetry(viewPrompt, conceptBytes, {
            width: 512, height: 512, steps, seed: seed + seedOffsets[view], cfgScale: cfg, samplerName: sampler,
            checkpoint, negativePrompt: negative, denoise: 0.65, loras,
            removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
          });
        }

        await api.saveConceptImage(manifest.character_id, resultBytes, view);
        generatedRefs.push(`concept_${view}.png`);

        if (view === 'right') rightBytes = resultBytes;

        set({ conceptPoseProgress: `${view} done.` });
      }

      // Update manifest
      const existingRefs = manifest.concept.reference_images;
      const allRefs = [...new Set([...existingRefs, 'concept.png', ...generatedRefs])];
      const updated = {
        ...manifest,
        concept: {
          ...manifest.concept,
          reference_images: allRefs,
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, loras },
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      // Reload URLs
      const id = manifest.character_id;
      const cb = `?t=${Date.now()}`;
      const updatedUrls = { ...get().conceptViewUrls };
      for (const v of targetViews) {
        updatedUrls[v] = api.conceptImageUrl(id, v) + cb;
      }
      set({
        conceptViewUrls: updatedUrls,
        conceptPoseError: null,
        conceptPoseProgress: `${targetViews.length} view(s) generated.`,
      });
      get().updateGenerationJob(cpJobId, { status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ conceptPoseError: msg });
      get().updateGenerationJob(cpJobId, { status: 'error', error: msg });
    } finally {
      set({ conceptPoseGenerating: false, conceptPoseCurrentView: null });
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

  generateChibiArt: async (view, overrides) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const chibi = manifest.chibi;
    const stylePrompt = chibi?.style_prompt || 'chibi, super deformed, 1.5 head body ratio, big head, small body, cute, simple features, short limbs';
    const negPrompt = chibi?.negative_prompt || 'realistic, photograph, 3d render, tall, long legs, long limbs, realistic proportions, normal proportions';

    set({ chibiGenerating: true, chibiError: null });
    const chibiJobId = createJob(get, 'chibi', `Generate chibi (${view})`);

    try {
      // Load view-specific concept image as IP-Adapter reference (preserves identity)
      let conceptBytes: Uint8Array;
      try {
        conceptBytes = await api.fetchConceptImageBytes(manifest.character_id, view);
      } catch {
        conceptBytes = await api.fetchConceptImageBytes(manifest.character_id);
      }

      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      const { CONCEPT_VIEW_PROMPTS, DEFAULT_NEGATIVE_PROMPT, sanitizeStylePrompt } = await import('../lib/ai-generate.js');
      const prompt = [sanitizeStylePrompt(stylePrompt), manifest.concept.description, CONCEPT_VIEW_PROMPTS[view]].filter(Boolean).join(', ');
      const negative = `${negPrompt}, ${DEFAULT_NEGATIVE_PROMPT}`;

      const steps = overrides?.steps ?? aiConfig.steps;
      const cfg = overrides?.cfg ?? aiConfig.cfg;
      const sampler = overrides?.sampler ?? aiConfig.sampler;
      const rawSeed = overrides?.seed ?? aiConfig.seed;
      const seed = rawSeed === -1 ? Math.floor(Math.random() * 2147483647) : rawSeed;
      const denoise = overrides?.denoise ?? 0.75;
      const loras = overrides?.loras !== undefined
        ? overrides.loras.filter((l) => l.name.trim())
        : aiConfig.loras.filter((l) => l.name.trim());
      const checkpoint = overrides?.checkpoint ?? aiConfig.checkpoint;
      const scheduler = overrides?.scheduler;
      const vae = overrides?.vae;

      console.log('[Seurat] Chibi prompt:', prompt);

      const ipWeight = overrides?.ipAdapterWeight ?? 0.6;
      const ipEndAt = overrides?.ipAdapterEndAt ?? 0.7;

      // Use txt2img + IP-Adapter: prompt controls chibi proportions,
      // IP-Adapter preserves character identity from concept image
      const pngBytes = await comfy.generateIPAdapterOnlyWithRetry(prompt, conceptBytes, {
        width: 512, height: 512, steps, seed, cfgScale: cfg, samplerName: sampler,
        scheduler, checkpoint, vae, negativePrompt: negative, loras,
        ipAdapterWeight: ipWeight, ipAdapterEndAt: ipEndAt,
        removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
      });

      await api.saveChibiImage(manifest.character_id, pngBytes, view);

      // Also save as default chibi.png if generating front view
      if (view === 'front') {
        await api.saveChibiImage(manifest.character_id, pngBytes);
      }

      const updated = {
        ...manifest,
        chibi: {
          style_prompt: stylePrompt,
          negative_prompt: negPrompt,
          reference_image: manifest.chibi?.reference_image || 'chibi.png',
          reference_images: { ...(manifest.chibi?.reference_images || {}), [view]: `chibi_${view}.png` },
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, denoise, loras, ipAdapterWeight: ipWeight, ipAdapterEndAt: ipEndAt },
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      const cb = `?t=${Date.now()}`;
      set({
        chibiViewUrls: { ...get().chibiViewUrls, [view]: api.chibiImageUrl(manifest.character_id, view) + cb },
        chibiError: null,
      });
      if (view === 'front') {
        set({ chibiImageUrl: api.chibiImageUrl(manifest.character_id) + cb });
      }
      get().updateGenerationJob(chibiJobId, { status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ chibiError: msg });
      get().updateGenerationJob(chibiJobId, { status: 'error', error: msg });
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

  uploadChibiImageForView: async (file, view) => {
    const { manifest } = get();
    if (!manifest) return;

    set({ chibiGenerating: true, chibiError: null });

    try {
      const arrayBuf = await file.arrayBuffer();
      const pngBytes = new Uint8Array(arrayBuf);

      await api.saveChibiImage(manifest.character_id, pngBytes, view);

      const viewFile = `chibi_${view}.png`;
      const existingRefs = manifest.chibi?.reference_images ?? {};
      const updated = {
        ...manifest,
        chibi: {
          style_prompt: manifest.chibi?.style_prompt || 'chibi, super deformed, 2-3 head body ratio, cute, simple features',
          negative_prompt: manifest.chibi?.negative_prompt || 'realistic, photograph, 3d render',
          reference_image: manifest.chibi?.reference_image || 'chibi.png',
          reference_images: { ...existingRefs, [view]: viewFile },
        },
      };
      set({ manifest: updated });
      await api.saveManifest(updated);

      const { chibiViewUrls } = get();
      set({
        chibiViewUrls: {
          ...chibiViewUrls,
          [view]: api.chibiImageUrl(manifest.character_id, view) + '&t=' + Date.now(),
        },
        chibiError: null,
      });
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
    const stylePrompt = chibi?.style_prompt || 'chibi, super deformed, 1.5 head body ratio, big head, small body, cute, simple features, short limbs';
    const negPrompt = chibi?.negative_prompt || 'realistic, photograph, 3d render, tall, long legs, long limbs, realistic proportions, normal proportions';

    set({ chibiViewsGenerating: true, chibiViewsError: null, chibiViewsProgress: 'Starting chibi views...' });
    const cvJobId = createJob(get, 'chibi', 'Generate all chibi views');

    try {
      const comfy = new ComfyUIClient(aiConfig.comfyUrl);
      const { CONCEPT_VIEW_PROMPTS, DEFAULT_NEGATIVE_PROMPT, sanitizeStylePrompt } = await import('../lib/ai-generate.js');
      const basePrompt = [sanitizeStylePrompt(stylePrompt), manifest.concept.description].filter(Boolean).join(', ');
      const negative = `${negPrompt}, ${DEFAULT_NEGATIVE_PROMPT}`;

      const steps = overrides?.steps ?? aiConfig.steps;
      const cfg = overrides?.cfg ?? aiConfig.cfg;
      const sampler = overrides?.sampler ?? aiConfig.sampler;
      const rawSeed = overrides?.seed ?? aiConfig.seed;
      const seed = rawSeed === -1 ? Math.floor(Math.random() * 2147483647) : rawSeed;
      const denoise = overrides?.denoise ?? 0.75;
      const loras = overrides?.loras !== undefined
        ? overrides.loras.filter((l) => l.name.trim())
        : aiConfig.loras.filter((l) => l.name.trim());
      const checkpoint = overrides?.checkpoint ?? aiConfig.checkpoint;
      const scheduler = overrides?.scheduler;
      const vae = overrides?.vae;

      const ipWeight = overrides?.ipAdapterWeight ?? 0.6;
      const ipEndAt = overrides?.ipAdapterEndAt ?? 0.7;

      const viewsToGenerate: ViewDirection[] = ['front', 'right', 'back'];
      const chibiRefImages: Partial<Record<ViewDirection, string>> = {};

      for (const view of viewsToGenerate) {
        set({ chibiViewsProgress: `Generating chibi ${view}...` });

        // Load the corresponding concept view as IP-Adapter reference
        let conceptBytes: Uint8Array;
        try {
          conceptBytes = await api.fetchConceptImageBytes(manifest.character_id, view);
        } catch {
          conceptBytes = await api.fetchConceptImageBytes(manifest.character_id);
        }

        const viewSeed = seed + (['front', 'right', 'back'].indexOf(view));
        const prompt = `${basePrompt}, ${CONCEPT_VIEW_PROMPTS[view]}`;

        // txt2img + IP-Adapter: prompt controls chibi proportions,
        // IP-Adapter preserves character identity from concept image
        const pngBytes = await comfy.generateIPAdapterOnlyWithRetry(prompt, conceptBytes, {
          width: 512, height: 512, steps, seed: viewSeed, cfgScale: cfg, samplerName: sampler,
          scheduler, checkpoint, vae, negativePrompt: negative, loras,
          ipAdapterWeight: ipWeight, ipAdapterEndAt: ipEndAt,
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
          generation_settings: { checkpoint, vae, steps, cfg, sampler, scheduler, seed: rawSeed, denoise, loras, ipAdapterWeight: ipWeight, ipAdapterEndAt: ipEndAt },
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
      get().updateGenerationJob(cvJobId, { status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ chibiViewsError: msg });
      get().updateGenerationJob(cvJobId, { status: 'error', error: msg });
    } finally {
      set({ chibiViewsGenerating: false });
    }
  },

  // Per-animation reference override (concept + chibi use same direction)
  animRefOverride: {},
  setAnimRefOverride: (animName, view) => set((s) => ({
    animRefOverride: { ...s.animRefOverride, [animName]: view },
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
    const stylePrompt = pixel?.style_prompt || 'game sprite, clean edges, simple shading, flat color';
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
          style_prompt: manifest.pixel?.style_prompt || 'game sprite, clean edges, simple shading, flat color',
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
  aiConfig: (() => {
    try {
      const saved = localStorage.getItem('seurat-ai-config');
      if (saved) return { ...DEFAULT_AI_CONFIG, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_AI_CONFIG;
  })(),
  setAIConfig: (config) => set((s) => {
    const aiConfig = { ...s.aiConfig, ...config };
    try { localStorage.setItem('seurat-ai-config', JSON.stringify(aiConfig)); } catch { /* ignore */ }
    return { aiConfig, projectDirty: s.project ? true : s.projectDirty };
  }),
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

  // Prompt override
  promptOverride: '',
  setPromptOverride: (prompt) => set({ promptOverride: prompt }),

  // Frame selection
  selectedFrames: new Set<number>(),
  toggleFrameSelection: (frameIndex) => set((s) => {
    const next = new Set(s.selectedFrames);
    if (next.has(frameIndex)) next.delete(frameIndex);
    else next.add(frameIndex);
    return { selectedFrames: next };
  }),
  selectAllFrames: (frameCount) => set({
    selectedFrames: new Set(Array.from({ length: frameCount }, (_, i) => i)),
  }),
  clearFrameSelection: () => set({ selectedFrames: new Set() }),

  // Pipeline (step-by-step)
  editingFrame: null,
  setEditingFrame: (frame) => set({ editingFrame: frame }),
  clipboard: null,

  copyFrame: async (animName, frameIndex, pass) => {
    const { manifest } = get();
    if (!manifest) return;
    try {
      let pngBytes: Uint8Array;
      if (pass === 'pass3') {
        // Final frame
        const res = await fetch(api.frameThumbnailUrl(manifest.character_id, animName, frameIndex));
        if (!res.ok) throw new Error('Frame not found');
        pngBytes = new Uint8Array(await res.arrayBuffer());
      } else if (pass === 'pending') {
        return; // nothing to copy
      } else {
        pngBytes = await api.fetchPassImageBytes(manifest.character_id, animName, frameIndex, pass);
      }
      set({ clipboard: { animName, frameIndex, pass, pngBytes } });
    } catch (err) {
      console.warn('[Seurat] Copy failed:', err);
    }
  },

  pasteFrame: async (animName, frameIndex, pass) => {
    const { manifest, clipboard } = get();
    if (!manifest || !clipboard) return;
    try {
      if (pass === 'pass3') {
        await api.saveFrameImage(manifest.character_id, animName, frameIndex, clipboard.pngBytes);
      } else {
        await api.savePassImage(manifest.character_id, animName, frameIndex, pass, clipboard.pngBytes);
      }
      // Update pipeline_stage in local manifest
      const updated = structuredClone(manifest);
      const frame = updated.animations.find((a) => a.name === animName)?.frames.find((f) => f.index === frameIndex);
      if (frame) {
        frame.pipeline_stage = pass;
        if (pass === 'pass3') { frame.status = 'generated'; }
      }
      set({ manifest: updated, frameRevision: get().frameRevision + 1 });
    } catch (err) {
      console.warn('[Seurat] Paste failed:', err);
    }
  },

  saveEditedFrame: async (animName, frameIndex, pass, pngBytes) => {
    const { manifest } = get();
    if (!manifest) return;
    const editedStage = (pass === 'pass1' || pass === 'pass1_edited') ? 'pass1_edited'
      : (pass === 'pass2' || pass === 'pass2_edited') ? 'pass2_edited'
      : pass;
    await api.savePassImage(manifest.character_id, animName, frameIndex, editedStage, pngBytes);
    const updated = structuredClone(manifest);
    const frame = updated.animations.find((a) => a.name === animName)?.frames.find((f) => f.index === frameIndex);
    if (frame) { frame.pipeline_stage = editedStage as PipelineStage; }
    set({ manifest: updated, frameRevision: get().frameRevision + 1 });
  },

  generatePass: async (pass, animName, frameIndices) => {
    const { manifest: _manifest, aiConfig, animRefOverride, promptOverride } = get();
    if (!_manifest) return;
    const manifest = _manifest;

    const anim = manifest.animations.find((a) => a.name === animName);
    if (!anim) return;

    const comfy = new ComfyUIClient(aiConfig.comfyUrl);
    // All frames are now first-class — generate for all selected indices
    const indices = frameIndices ?? anim.frames.map((f) => f.index);

    const { buildFramePrompt, buildNegativePrompt, buildPass2Prompt, buildPass2NegativePrompt } = await import('../lib/ai-generate.js');
    const { getPose, renderPoseToPng } = await import('../lib/pose-templates.js');
    const loras = aiConfig.loras.filter((l) => l.name.trim());
    const negative = buildNegativePrompt(manifest);
    const override = animRefOverride[animName];
    const view = override ?? DIRECTION_TO_VIEW[anim.direction];

    // Pre-process reference images through RemBG
    const shouldPreRemBg = aiConfig.useIPAdapter && aiConfig.removeBackground;
    async function preRemBg(bytes: Uint8Array): Promise<Uint8Array> {
      if (!shouldPreRemBg) return bytes;
      try {
        const cleaned = await comfy.removeBackground(bytes, aiConfig.remBgNodeType);
        return await compositeOnWhite(cleaned);
      } catch { return bytes; }
    }

    for (const fi of indices) {
      const jobId = `${pass}_${animName}_${fi}_${Date.now()}`;
      const rawSeed = aiConfig.seed === -1 ? Math.floor(Math.random() * 2147483647) : aiConfig.seed + fi;
      get().addGenerationJob({ id: jobId, source: pass as any, label: `${pass} ${animName} f${fi}`, animName, frameIndex: fi, status: 'running', pass, seed: rawSeed });

      try {
        const prompt = promptOverride.trim() || buildFramePrompt(manifest, anim, fi);

        if (pass === 'pass1') {
          // Pass 1: IP-Adapter (concept) + OpenPose → 512x512
          let conceptBytes: Uint8Array;
          try { conceptBytes = await api.fetchConceptImageBytes(manifest.character_id, view); }
          catch { conceptBytes = await api.fetchConceptImageBytes(manifest.character_id); }
          conceptBytes = await preRemBg(conceptBytes);

          const pose = get().poseOverrides[`${animName}:${fi}`]
            ?? resolveDerivedPose(get().derivedAnimPoses, animName, fi, animRefOverride, anim.direction)
            ?? getPose(animName, fi);
          const poseBytes = pose ? await renderPoseToPng(pose, 512, 512) : null;

          let pngBytes: Uint8Array;
          if (poseBytes) {
            pngBytes = await comfy.generateIPAdapterWithRetry(prompt, conceptBytes, poseBytes, {
              width: 512, height: 512, steps: aiConfig.steps, seed: rawSeed, cfgScale: Math.min(aiConfig.pass1Cfg, 5),
              samplerName: aiConfig.sampler, checkpoint: aiConfig.checkpoint, vae: aiConfig.vae || undefined,
              negativePrompt: negative, denoise: 1.0, loras: [],
              ipAdapterWeight: aiConfig.ipAdapterWeight, ipAdapterPreset: aiConfig.ipAdapterPreset,
              ipAdapterStartAt: 0.0, ipAdapterEndAt: 0.8,
              openPoseModel: aiConfig.openPoseModel, openPoseStrength: aiConfig.openPoseStrength,
              removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
            });
          } else {
            pngBytes = await comfy.generateIPAdapterOnlyWithRetry(prompt, conceptBytes, {
              width: 512, height: 512, steps: aiConfig.steps, seed: rawSeed, cfgScale: Math.min(aiConfig.pass1Cfg, 5),
              samplerName: aiConfig.sampler, checkpoint: aiConfig.checkpoint, vae: aiConfig.vae || undefined,
              negativePrompt: negative, loras: [],
              ipAdapterWeight: aiConfig.ipAdapterWeight, ipAdapterEndAt: 0.8,
              removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
            });
          }

          await api.savePassImage(manifest.character_id, animName, fi, 'pass1', pngBytes);
          const cur = get().manifest;
          if (cur) {
            const updated = structuredClone(cur);
            const f = updated.animations.find((x) => x.name === animName)?.frames.find((x) => x.index === fi);
            if (f) f.pipeline_stage = 'pass1';
            set({ manifest: updated, frameRevision: get().frameRevision + 1 });
          }

        } else if (pass === 'pass2') {
          // Pass 2: img2img + IPAdapter(chibi) on pass1 output
          // Prefer edited version if it exists on disk, regardless of current pipeline_stage
          let pass1Bytes: Uint8Array;
          try { pass1Bytes = await api.fetchPassImageBytes(manifest.character_id, animName, fi, 'pass1_edited'); }
          catch { pass1Bytes = await api.fetchPassImageBytes(manifest.character_id, animName, fi, 'pass1'); }

          let chibiBytes: Uint8Array;
          try { chibiBytes = await api.fetchChibiImageBytes(manifest.character_id, view); }
          catch { chibiBytes = await api.fetchChibiImageBytes(manifest.character_id); }
          chibiBytes = await preRemBg(chibiBytes);

          const pass2Prompt = promptOverride.trim() || buildPass2Prompt(manifest, anim, fi);
          const pass2Negative = buildPass2NegativePrompt(manifest);

          const pngBytes = await comfy.generateImg2ImgWithIPAdapterWithRetry(pass2Prompt, pass1Bytes, chibiBytes, {
            width: 512, height: 512, steps: aiConfig.steps, seed: rawSeed, cfgScale: aiConfig.pass2Cfg,
            samplerName: aiConfig.sampler, checkpoint: aiConfig.checkpoint, vae: aiConfig.vae || undefined,
            negativePrompt: pass2Negative, denoise: aiConfig.chibiDenoise, loras: [],
            ipAdapterWeight: aiConfig.chibiWeight, ipAdapterEndAt: 0.7,
            removeBackground: aiConfig.removeBackground, remBgNodeType: aiConfig.remBgNodeType,
          });

          await api.savePassImage(manifest.character_id, animName, fi, 'pass2', pngBytes);
          const latest = get().manifest;
          if (latest) {
            const updated = structuredClone(latest);
            const f = updated.animations.find((x) => x.name === animName)?.frames.find((x) => x.index === fi);
            if (f) f.pipeline_stage = 'pass2';
            set({ manifest: updated, frameRevision: get().frameRevision + 1 });
          }

        } else if (pass === 'pass3') {
          // Pass 3: Client-side downscale → upscale (pixelization) + background removal
          // Prefer edited version if it exists on disk, regardless of current pipeline_stage
          let pass2Bytes: Uint8Array;
          try { pass2Bytes = await api.fetchPassImageBytes(manifest.character_id, animName, fi, 'pass2_edited'); }
          catch { pass2Bytes = await api.fetchPassImageBytes(manifest.character_id, animName, fi, 'pass2'); }

          const { frame_width, frame_height } = manifest.spritesheet;
          const smallSize = aiConfig.pixelDownscaleSize;
          const useNearest = aiConfig.downscaleMethod === 'nearest-exact';

          // Downscale to small pixel size, then upscale back to frame dimensions
          const srcBlob = new Blob([pass2Bytes as BlobPart], { type: 'image/png' });
          const srcBmp = await createImageBitmap(srcBlob);

          // Step 1: Downscale to small size
          const smallCanvas = new OffscreenCanvas(smallSize, smallSize);
          const smallCtx = smallCanvas.getContext('2d')!;
          smallCtx.imageSmoothingEnabled = !useNearest;
          smallCtx.drawImage(srcBmp, 0, 0, smallSize, smallSize);

          // Step 2: Upscale back to frame dimensions (nearest-neighbor for crisp pixels)
          const outCanvas = new OffscreenCanvas(frame_width, frame_height);
          const outCtx = outCanvas.getContext('2d')!;
          outCtx.imageSmoothingEnabled = false;
          outCtx.drawImage(smallCanvas, 0, 0, frame_width, frame_height);
          srcBmp.close();

          const outBlob = await outCanvas.convertToBlob({ type: 'image/png' });
          let pngBytes: Uint8Array = new Uint8Array(await outBlob.arrayBuffer());

          // Step 3: Remove background via ComfyUI RMBG
          if (aiConfig.removeBackground) {
            try {
              pngBytes = await comfy.removeBackground(pngBytes, aiConfig.remBgNodeType);
            } catch (err) {
              console.warn(`[Seurat] Background removal failed for ${animName}/f${fi}, using pixelized image as-is:`, err);
            }
          }

          // Save as final frame
          await api.saveFrameImage(manifest.character_id, animName, fi, pngBytes);
          // Also save as pass3 intermediate
          await api.savePassImage(manifest.character_id, animName, fi, 'pass3', pngBytes);
          const latest = get().manifest;
          if (latest) {
            const updated = structuredClone(latest);
            const f = updated.animations.find((x) => x.name === animName)?.frames.find((x) => x.index === fi);
            if (f) { f.pipeline_stage = 'pass3'; f.status = 'generated'; f.file = `${animName}/${animName}_${fi}.png`; }
            set({ manifest: updated, frameRevision: get().frameRevision + 1 });
          }
        }

        get().updateGenerationJob(jobId, { status: 'done' });
      } catch (err) {
        console.error(`[Seurat] ${pass} generation error for ${animName}/f${fi}:`, err);
        get().updateGenerationJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Persist manifest to disk so progress survives page refresh / re-navigation
    const final = get().manifest;
    if (final) {
      await api.saveManifest(final);
    }
  },

  // Interpolation
  interpProgress: null,

  interpolateAnimation: async (animName, startFrame, endFrame) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const anim = manifest.animations.find((a) => a.name === animName);
    if (!anim) return;

    const method = aiConfig.interpMethod;
    const characterId = manifest.character_id;

    // Range mode: interpolate between start and end, filling in-between frames
    if (startFrame !== undefined && endFrame !== undefined) {
      const inBetweenCount = endFrame - startFrame - 1;
      if (inBetweenCount < 1) {
        set({ interpProgress: 'Need at least 2 frames apart to interpolate.' });
        return;
      }

      set({ interpProgress: `Interpolating f${startFrame}→f${endFrame} (${inBetweenCount} in-between, ${method})...` });
      const jobId = createJob(get, 'interpolation', `Interpolate f${startFrame}→f${endFrame}`);

      try {
        // Load start and end frame images (prefer edited > pass2 > pass1)
        // Track which pass was loaded to save interpolated frames at the same stage
        const PASS_PRIORITY = ['pass2_edited', 'pass2', 'pass1_edited', 'pass1'] as const;
        type PassKey = typeof PASS_PRIORITY[number];
        let bestPass: PassKey = 'pass1';

        async function loadBest(fi: number): Promise<Uint8Array> {
          // Wrap frame index for looping (e.g., f16 → f0)
          const totalFrames = anim!.frames.length;
          const actualFi = fi >= totalFrames ? fi % totalFrames : fi;
          for (const pass of PASS_PRIORITY) {
            try {
              const bytes = await api.fetchPassImageBytes(characterId, animName, actualFi, pass);
              // Track highest pass found (pass2 > pass1)
              const passLevel = pass.startsWith('pass2') ? 2 : 1;
              const bestLevel = bestPass.startsWith('pass2') ? 2 : 1;
              if (passLevel > bestLevel) bestPass = pass.startsWith('pass2') ? 'pass2' : 'pass1';
              return bytes;
            } catch { /* next */ }
          }
          throw new Error(`No pass image for f${actualFi}`);
        }

        const startBytes = await loadBest(startFrame);
        const endBytes = await loadBest(endFrame);
        // Determine save stage: use the base pass (not _edited) of the best source
        const savePass = bestPass.startsWith('pass2') ? 'pass2' : 'pass1';

        // Generate intermediates
        let intermediates: Uint8Array[];
        if (method === 'rife') {
          const comfy = new ComfyUIClient(aiConfig.comfyUrl);
          intermediates = await comfy.interpolateFramesRIFE(startBytes, endBytes, {
            model: aiConfig.rifeModel,
            multiplier: inBetweenCount + 1, // RIFE multiplier includes endpoints
          });
          // RIFE returns all frames including endpoints; take only intermediates
          intermediates = intermediates.slice(0, inBetweenCount);
        } else {
          const { blendInterpolate } = await import('../lib/frame-interpolate.js');
          intermediates = await blendInterpolate(startBytes, endBytes, inBetweenCount);
        }

        // Save interpolated frames to the in-between indices
        const updated = structuredClone(manifest);
        const updatedAnim = updated.animations.find((a) => a.name === animName)!;

        for (let i = 0; i < intermediates.length; i++) {
          const targetIndex = startFrame + 1 + i;
          const frame = updatedAnim.frames.find((f) => f.index === targetIndex);
          if (frame) {
            const editedPass = savePass === 'pass2' ? 'pass2_edited' : 'pass1_edited';
            frame.status = 'generated';
            frame.source = 'ai';
            frame.pipeline_stage = editedPass;
            await api.savePassImage(characterId, animName, targetIndex, editedPass, intermediates[i]);
            set({ interpProgress: `Saved f${targetIndex} (${i + 1}/${intermediates.length})` });
          }
        }

        set({ manifest: updated, frameRevision: get().frameRevision + 1 });
        await api.saveManifest(updated);
        set({ interpProgress: `Done: filled ${intermediates.length} frames between f${startFrame} and f${endFrame}` });
        get().updateGenerationJob(jobId, { status: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Seurat] Interpolation error:', err);
        set({ interpProgress: `Error: ${msg}` });
        get().updateGenerationJob(jobId, { status: 'error', error: msg });
      }
      return;
    }

    // Legacy keyframe-based interpolation
    const multiplier = aiConfig.interpMultiplier;
    const keyframes = anim.frames.filter((f) => f.keyframe !== false);
    const keyframeCount = keyframes.length;

    set({ interpProgress: `Interpolating ${keyframeCount} keyframes (${method} ${multiplier}x)...` });

    try {
      const keyframeBytes: Uint8Array[] = [];
      for (const frame of keyframes) {
        let bytes: Uint8Array;
        try {
          bytes = await api.fetchPassImageBytes(characterId, animName, frame.index, 'pass2_edited');
        } catch {
          bytes = await api.fetchPassImageBytes(characterId, animName, frame.index, 'pass2');
        }
        keyframeBytes.push(bytes);
      }

      const pairs: [number, number][] = [];
      for (let i = 0; i < keyframeCount - 1; i++) {
        pairs.push([i, i + 1]);
      }
      if (anim.loop && keyframeCount > 1) {
        pairs.push([keyframeCount - 1, 0]);
      }

      const interpResults: Map<number, Uint8Array[]> = new Map();

      for (const [idxA, idxB] of pairs) {
        set({ interpProgress: `Interpolating f${keyframes[idxA].index}→f${keyframes[idxB].index} (${method})...` });

        let intermediates: Uint8Array[];
        if (method === 'rife') {
          const comfy = new ComfyUIClient(aiConfig.comfyUrl);
          intermediates = await comfy.interpolateFramesRIFE(keyframeBytes[idxA], keyframeBytes[idxB], {
            model: aiConfig.rifeModel,
            multiplier: multiplier + 1,
          });
          intermediates = intermediates.slice(0, multiplier - 1);
        } else {
          const { blendInterpolate } = await import('../lib/frame-interpolate.js');
          intermediates = await blendInterpolate(keyframeBytes[idxA], keyframeBytes[idxB], multiplier - 1);
        }
        interpResults.set(idxA, intermediates);
      }

      const updated = structuredClone(manifest);
      const updatedAnim = updated.animations.find((a) => a.name === animName)!;

      let keyIdx = 0;
      for (let i = 0; i < updatedAnim.frames.length; i++) {
        const frame = updatedAnim.frames[i];
        if (frame.keyframe !== false) {
          const interps = interpResults.get(keyIdx);
          if (interps) {
            for (let j = 0; j < interps.length && i + 1 + j < updatedAnim.frames.length; j++) {
              const slot = updatedAnim.frames[i + 1 + j];
              if (slot.keyframe === false) {
                slot.status = 'generated';
                slot.source = 'ai';
                slot.pipeline_stage = 'pass2';
                await api.savePassImage(characterId, animName, slot.index, 'pass2', interps[j]);
              }
            }
          }
          keyIdx++;
        }
      }

      updated.spritesheet.interp_multiplier = multiplier;
      set({ manifest: updated, frameRevision: get().frameRevision + 1 });
      await api.saveManifest(updated);

      const totalFrames = updatedAnim.frames.length;
      const filledCount = updatedAnim.frames.filter((f) => f.keyframe === false && f.status === 'generated').length;
      set({ interpProgress: `Done: ${keyframeCount} keyframes + ${filledCount} interpolated = ${totalFrames} total` });
    } catch (err) {
      console.error('[Seurat] Interpolation error:', err);
      set({ interpProgress: `Error: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  interpolateOddFrames: async (animName) => {
    const { manifest, aiConfig } = get();
    if (!manifest) return;

    const anim = manifest.animations.find((a) => a.name === animName);
    if (!anim) return;

    const method = aiConfig.interpMethod;
    const characterId = manifest.character_id;

    // Find odd-indexed frames that have even neighbors on both sides
    const oddFrames = anim.frames.filter((f) => f.index % 2 === 1);
    if (oddFrames.length === 0) {
      set({ interpProgress: 'No odd frames to interpolate.' });
      return;
    }

    set({ interpProgress: `Interpolating ${oddFrames.length} odd frames (${method})...` });
    const jobId = createJob(get, 'interpolation', `Interpolate ${oddFrames.length} odd frames`);

    try {
      // Load best available image for a frame
      async function loadBest(fi: number): Promise<{ bytes: Uint8Array; pass: string }> {
        for (const pass of ['pass2_edited', 'pass2', 'pass1_edited', 'pass1'] as const) {
          try {
            const bytes = await api.fetchPassImageBytes(characterId, animName, fi, pass);
            return { bytes, pass };
          } catch { /* next */ }
        }
        throw new Error(`No pass image for f${fi}`);
      }

      const updated = structuredClone(manifest);
      const updatedAnim = updated.animations.find((a) => a.name === animName)!;
      let filled = 0;

      for (const oddFrame of oddFrames) {
        const prevIdx = oddFrame.index - 1;
        let nextIdx = oddFrame.index + 1;

        // Both neighbors must exist; for looping anims, wrap to f0
        const prevExists = anim.frames.some((f) => f.index === prevIdx);
        let nextExists = anim.frames.some((f) => f.index === nextIdx);
        if (!nextExists && anim.loop) {
          nextIdx = 0; // wrap to first frame
          nextExists = anim.frames.some((f) => f.index === 0);
        }
        if (!prevExists || !nextExists) continue;

        set({ interpProgress: `Interpolating f${prevIdx}→f${oddFrame.index}→f${nextIdx}${nextIdx === 0 ? ' (loop)' : ''} (${filled + 1}/${oddFrames.length})...` });

        try {
          const prev = await loadBest(prevIdx);
          const next = await loadBest(nextIdx);
          const savePass = (prev.pass.startsWith('pass2') || next.pass.startsWith('pass2')) ? 'pass2' : 'pass1';

          let intermediates: Uint8Array[];
          if (method === 'rife') {
            const comfy = new ComfyUIClient(aiConfig.comfyUrl);
            intermediates = await comfy.interpolateFramesRIFE(prev.bytes, next.bytes, {
              model: aiConfig.rifeModel,
              multiplier: 2,
            });
            intermediates = intermediates.slice(0, 1);
          } else {
            const { blendInterpolate } = await import('../lib/frame-interpolate.js');
            intermediates = await blendInterpolate(prev.bytes, next.bytes, 1);
          }

          if (intermediates.length > 0) {
            const editedPass = savePass === 'pass2' ? 'pass2_edited' : 'pass1_edited';
            await api.savePassImage(characterId, animName, oddFrame.index, editedPass, intermediates[0]);
            const frame = updatedAnim.frames.find((f) => f.index === oddFrame.index);
            if (frame) {
              frame.status = 'generated';
              frame.source = 'ai';
              frame.pipeline_stage = editedPass as any;
            }
            filled++;
          }
        } catch (err) {
          console.warn(`[Seurat] Failed to interpolate f${oddFrame.index}:`, err);
        }
      }

      set({ manifest: updated, frameRevision: get().frameRevision + 1 });
      await api.saveManifest(updated);
      set({ interpProgress: `Done: filled ${filled} odd frames.` });
      get().updateGenerationJob(jobId, { status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Seurat] Odd frame interpolation error:', err);
      set({ interpProgress: `Error: ${msg}` });
      get().updateGenerationJob(jobId, { status: 'error', error: msg });
    }
  },

  revertInterpolation: async (animName) => {
    const { manifest } = get();
    if (!manifest) return;

    const anim = manifest.animations.find((a) => a.name === animName);
    if (!anim) return;

    // Reset interpolation placeholders back to pending
    const hasFilledSlots = anim.frames.some((f) => f.keyframe === false && f.status === 'generated');
    if (!hasFilledSlots) return; // nothing to revert

    const updated = structuredClone(manifest);
    const updatedAnim = updated.animations.find((a) => a.name === animName)!;

    for (const frame of updatedAnim.frames) {
      if (frame.keyframe === false) {
        frame.status = 'pending';
        frame.source = 'placeholder';
        frame.pipeline_stage = undefined;
      }
    }

    set({ manifest: updated, frameRevision: get().frameRevision + 1, interpProgress: null });
    await api.saveManifest(updated);
  },

  generateFrames: async (scope, animName, frameIndex) => {
    const { manifest: _manifest, aiConfig, animRefOverride } = get();
    if (!_manifest) return;
    const manifest = _manifest; // non-null assertion for closures

    const comfy = new ComfyUIClient(aiConfig.comfyUrl);
    const hasConceptImage = manifest.concept.reference_images.length > 0;

    // Pre-process reference images through RemBG to strip backgrounds before IP-Adapter
    const shouldPreRemBg = aiConfig.useIPAdapter && aiConfig.removeBackground;
    async function preRemoveBackground(bytes: Uint8Array): Promise<Uint8Array> {
      if (!shouldPreRemBg) return bytes;
      try {
        console.log('[Seurat] Pre-processing reference image through RemBG...');
        const cleaned = await comfy.removeBackground(bytes, aiConfig.remBgNodeType);
        console.log(`[Seurat] RemBG done: ${bytes.length} → ${cleaned.length} bytes`);
        // Composite onto white so IP-Adapter doesn't see black/transparent regions
        const onWhite = await compositeOnWhite(cleaned);
        console.log(`[Seurat] Composited on white: ${onWhite.length} bytes`);
        return onWhite;
      } catch (err) {
        console.warn('[Seurat] RemBG pre-processing failed, using original:', err);
        return bytes;
      }
    }

    // Per-direction reference loading with cache
    const conceptCache: Partial<Record<ViewDirection | '_default', Uint8Array>> = {};
    const chibiCache: Partial<Record<ViewDirection | '_default', Uint8Array>> = {};

    // Helper: get concept bytes for an animation (respects per-animation override)
    async function getConceptBytesForAnim(animNameKey: string, dir: DirectionCode): Promise<Uint8Array | null> {
      if (!hasConceptImage) return null;
      const override = animRefOverride[animNameKey];
      const view = override ?? DIRECTION_TO_VIEW[dir];
      // Try direction-specific first, then fall back to default
      if (conceptCache[view]) return conceptCache[view]!;
      try {
        let bytes = await api.fetchConceptImageBytes(manifest.character_id, view);
        bytes = await preRemoveBackground(bytes);
        conceptCache[view] = bytes;
        console.log(`[Seurat] Loaded concept image (${view}): ${bytes.length} bytes`);
        return bytes;
      } catch {
        // Fall back to default concept image
        if (conceptCache['_default']) return conceptCache['_default']!;
        try {
          let bytes = await api.fetchConceptImageBytes(manifest.character_id);
          bytes = await preRemoveBackground(bytes);
          conceptCache['_default'] = bytes;
          console.log(`[Seurat] Loaded default concept image: ${bytes.length} bytes`);
          return bytes;
        } catch (err) {
          console.warn('[Seurat] Failed to load concept image:', err);
          return null;
        }
      }
    }

    async function getChibiBytesForAnim(animNameKey: string, dir: DirectionCode): Promise<Uint8Array | null> {
      if (!manifest.chibi?.reference_image) return null;
      const override = animRefOverride[animNameKey];
      const view = override ?? DIRECTION_TO_VIEW[dir];
      if (chibiCache[view]) return chibiCache[view]!;
      try {
        let bytes = await api.fetchChibiImageBytes(manifest.character_id, view);
        bytes = await preRemoveBackground(bytes);
        chibiCache[view] = bytes;
        console.log(`[Seurat] Loaded chibi image (${view}): ${bytes.length} bytes`);
        return bytes;
      } catch {
        if (chibiCache['_default']) return chibiCache['_default']!;
        try {
          let bytes = await api.fetchChibiImageBytes(manifest.character_id);
          bytes = await preRemoveBackground(bytes);
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
        let bytes = await api.fetchConceptImageBytes(manifest.character_id);
        bytes = await preRemoveBackground(bytes);
        conceptBytes = bytes;
        conceptCache['_default'] = conceptBytes;
        console.log(`[Seurat] Loaded concept image: ${conceptBytes.length} bytes`);
      } catch (err) {
        console.warn('[Seurat] Failed to load concept image:', err);
      }
    }
    if (manifest.chibi?.reference_image) {
      try {
        let bytes = await api.fetchChibiImageBytes(manifest.character_id);
        bytes = await preRemoveBackground(bytes);
        chibiBytes = bytes;
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
    const ipaCfg = ipaActive ? aiConfig.pass1Cfg : aiConfig.cfg;
    const ipaDenoise = 1.0;
    const ipaLoras = loras;
    if (ipaActive) {
      negative += ', oversaturated, neon, vibrant colors, high contrast, detailed background, room, interior, exterior, furniture, floor, wall, ceiling, sky, ground, environment';
    }

    if (scope === 'single' && animName !== undefined && frameIndex !== undefined) {
      // Single frame: generate one image
      const anim = manifest.animations.find((a) => a.name === animName);
      if (!anim) return;

      const jobId = `${animName}_${frameIndex}_${Date.now()}`;
      const seed = aiConfig.seed === -1
        ? Math.floor(Math.random() * 2147483647)
        : aiConfig.seed + frameIndex;
      get().addGenerationJob({ id: jobId, source: 'generation', label: `Generate ${animName} f${frameIndex}`, animName, frameIndex, status: 'running', seed });

      try {
        const prompt = buildFramePrompt(manifest, anim, frameIndex);
        console.log('[Seurat] Single frame prompt:', prompt);

        let pngBytes: Uint8Array;
        const pose = aiConfig.useIPAdapter
          ? (get().poseOverrides[`${animName}:${frameIndex}`]
             ?? resolveDerivedPose(get().derivedAnimPoses, animName!, frameIndex!, animRefOverride, anim?.direction)
             ?? getPose(animName!, frameIndex!))
          : null;

        // Warmup: pre-load models before the real generation
        if (aiConfig.useIPAdapter && pose && (singlePassRef || conceptBytes)) {
          const warmupPose = await renderPoseToPng(pose, 128, 128);
          await comfy.warmupIPAdapter(singlePassRef ?? conceptBytes!, warmupPose, {
            checkpoint: aiConfig.checkpoint,
            vae: aiConfig.vae,
            ipAdapterPreset: aiConfig.ipAdapterPreset,
            openPoseModel: aiConfig.openPoseModel,
            samplerName: aiConfig.sampler,
          });
        }

        if (canTwoPass && pose) {
          // Two-pass mode: Concept→Pose→Chibi→Pixel (direction-aware refs)
          const genSize = 512;
          const dirConceptBytes = await getConceptBytesForAnim(anim.name, anim.direction) ?? conceptBytes!;
          const dirChibiBytes = await getChibiBytesForAnim(anim.name, anim.direction) ?? chibiBytes!;
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
            removeBackground: aiConfig.removeBackground,
            remBgNodeType: aiConfig.remBgNodeType,
            outputWidth: manifest.spritesheet.frame_width,
            outputHeight: manifest.spritesheet.frame_height,
            downscaleMethod: aiConfig.downscaleMethod,
          });
        } else if (aiConfig.useIPAdapter && singlePassRef && pose) {
          // Single-pass IP-Adapter + OpenPose mode (direction-aware ref)
          const genSize = 512;
          const dirRef = await getConceptBytesForAnim(anim.name, anim.direction) ?? singlePassRef;
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
            downscaleMethod: aiConfig.downscaleMethod,
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

      // Warmup: run a tiny 1-step inference to pre-load models (checkpoint,
      // IP-Adapter, OpenPose ControlNet) into GPU memory. On Apple Silicon MPS,
      // the first inference after model load often produces degraded results.
      if (aiConfig.useIPAdapter && animsToGenerate.length > 0) {
        const firstAnim = manifest.animations.find((a) => a.name === animsToGenerate[0]);
        if (firstAnim) {
          const warmupPoses = getAnimationPoses(animsToGenerate[0], firstAnim.frames.length);
          if (warmupPoses && warmupPoses[0] && (singlePassRef || conceptBytes)) {
            const warmupPose = await renderPoseToPng(warmupPoses[0], 128, 128);
            await comfy.warmupIPAdapter(singlePassRef ?? conceptBytes!, warmupPose, {
              checkpoint: aiConfig.checkpoint,
              vae: aiConfig.vae,
              ipAdapterPreset: aiConfig.ipAdapterPreset,
              openPoseModel: aiConfig.openPoseModel,
              samplerName: aiConfig.sampler,
            });
          }
        }
      }

      for (const an of animsToGenerate) {
        const anim = manifest.animations.find((a) => a.name === an);
        if (!anim) continue;

        const jobId = `row_${an}_${Date.now()}`;
        const seed = aiConfig.seed === -1
          ? Math.floor(Math.random() * 2147483647)
          : aiConfig.seed;
        get().addGenerationJob({ id: jobId, source: 'generation', label: `Generate ${an} (row)`, animName: an, frameIndex: -1, status: 'running', seed });

        try {
          const frameCount = anim.frames.length;
          const fw = manifest.spritesheet.frame_width;
          const fh = manifest.spritesheet.frame_height;

          // Check if IP-Adapter per-frame mode applies (with pose overrides)
          const overrides = get().poseOverrides;
          const derivedAll = get().derivedAnimPoses;
          const animPoses = aiConfig.useIPAdapter ? getAnimationPoses(an, frameCount)?.map(
            (p, i) => overrides[`${an}:${i}`] ?? resolveDerivedPose(derivedAll, an, i, animRefOverride, anim.direction) ?? p
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
            const dirConceptBytes = await getConceptBytesForAnim(anim.name, anim.direction) ?? conceptBytes!;
            const dirChibiBytes = await getChibiBytesForAnim(anim.name, anim.direction) ?? chibiBytes!;

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
                removeBackground: aiConfig.removeBackground,
                remBgNodeType: aiConfig.remBgNodeType,
                outputWidth: fw,
                outputHeight: fh,
                downscaleMethod: aiConfig.downscaleMethod,
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
            const dirRef = await getConceptBytesForAnim(anim.name, anim.direction) ?? singlePassRef;

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
                downscaleMethod: aiConfig.downscaleMethod,
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

  // Pose editing (persisted to manifest.pose_overrides)
  poseOverrides: {},
  setPoseOverride: (animName, frameIndex, pose) => {
    const key = `${animName}:${frameIndex}`;
    const poseOverrides = { ...get().poseOverrides, [key]: pose };
    set({ poseOverrides });
    // Persist to manifest
    const { manifest } = get();
    if (manifest) {
      const updated = { ...manifest, pose_overrides: poseOverrides };
      set({ manifest: updated });
      api.saveManifest(updated).catch(() => {});
    }
  },
  clearPoseOverride: (animName, frameIndex) => {
    const key = `${animName}:${frameIndex}`;
    const poseOverrides = { ...get().poseOverrides };
    delete poseOverrides[key];
    set({ poseOverrides });
    const { manifest } = get();
    if (manifest) {
      const updated = { ...manifest, pose_overrides: poseOverrides };
      set({ manifest: updated });
      api.saveManifest(updated).catch(() => {});
    }
  },
  clearAllPoseOverrides: (animName) => {
    const poseOverrides = { ...get().poseOverrides };
    for (const key of Object.keys(poseOverrides)) {
      if (key.startsWith(`${animName}:`)) delete poseOverrides[key];
    }
    set({ poseOverrides });
    const { manifest } = get();
    if (manifest) {
      const updated = { ...manifest, pose_overrides: poseOverrides };
      set({ manifest: updated });
      api.saveManifest(updated).catch(() => {});
    }
  },

  // Derived animation poses
  derivedAnimPoses: {},
  derivingAnimPoses: false,
  deriveAnimationPoses: async () => {
    const { detectedPoseBytes, detectedViewPoseBytes } = get();
    if (!detectedPoseBytes) {
      set({ conceptPoseError: 'Detect the concept pose first.' });
      return;
    }

    set({ derivingAnimPoses: true, conceptPoseProgress: 'Extracting keypoints for animation poses...' });
    const daJobId = createJob(get, 'derive_poses', 'Derive animation poses');
    try {
      const { extractKeypointsFromPoseImage, deriveAllAnimationPoses } = await import('../lib/pose-templates.js');

      // Extract front-view keypoints (always required)
      const keypoints = await extractKeypointsFromPoseImage(detectedPoseBytes);
      const validCount = keypoints.filter((k) => k !== null).length;
      console.log(`[Seurat] Extracted ${validCount}/14 front keypoints for animation poses`);

      if (validCount < 5) {
        set({ conceptPoseError: `Only ${validCount} keypoints detected — not enough to derive poses.` });
        return;
      }

      // Use front keypoints + template X for all directions.
      // Direction-specific keypoint extraction via extractKeypointsFromPoseImage
      // is unreliable for side/back views (Y-band heuristic assumes front-facing).
      // Direction skeleton PNGs are still used directly for concept art generation.
      set({ conceptPoseProgress: 'Deriving all animation poses...' });
      const allPoses = deriveAllAnimationPoses(keypoints);

      const totalPoseCount = Object.values(allPoses).reduce((s, p) => s + p.length, 0);
      console.log(`[Seurat] Derived ${totalPoseCount} poses across ${Object.keys(allPoses).length} animations`);

      set({
        derivedAnimPoses: allPoses,
        conceptPoseProgress: `Derived ${totalPoseCount} poses across ${Object.keys(allPoses).length} animations.`,
      });

      // Persist to manifest
      const { manifest } = get();
      if (manifest) {
        const updated = { ...manifest, derived_poses: allPoses };
        set({ manifest: updated });
        await api.saveManifest(updated);
      }
      get().updateGenerationJob(daJobId, { status: 'done' });
    } catch (err) {
      const msg = `Animation pose derivation failed: ${err instanceof Error ? err.message : String(err)}`;
      set({ conceptPoseError: msg });
      get().updateGenerationJob(daJobId, { status: 'error', error: msg });
    } finally {
      set({ derivingAnimPoses: false });
    }
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

  // Project
  project: null,
  projectPath: null,
  projectDirty: false,
  recentProjects: (() => {
    try {
      const saved = localStorage.getItem('seurat-recent-projects');
      if (saved) return JSON.parse(saved) as RecentProject[];
    } catch { /* ignore */ }
    return [];
  })(),
  exportProgress: null,
  exportError: null,

  createProject: async (dirPath, name) => {
    try {
      const res = await api.createProject(dirPath, name);
      const project = res.project as unknown as ProjectMeta;
      set({ project, projectPath: dirPath, projectDirty: false });
      // Add to recent projects
      const recents = get().recentProjects.filter((r) => r.path !== dirPath);
      const updated = [{ path: dirPath, name, openedAt: new Date().toISOString() }, ...recents].slice(0, 10);
      set({ recentProjects: updated });
      try { localStorage.setItem('seurat-recent-projects', JSON.stringify(updated)); } catch { /* ignore */ }
      await get().refreshCharacters();
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  },

  openProject: async (dirPath) => {
    try {
      const res = await api.openProject(dirPath);
      const project = res.project as unknown as ProjectMeta;
      set({ project, projectPath: res.path, projectDirty: false });
      // Restore AI config from project if available
      if (project.ai_config) {
        set({ aiConfig: { ...DEFAULT_AI_CONFIG, ...project.ai_config } });
      }
      // Add to recent projects
      const recents = get().recentProjects.filter((r) => r.path !== dirPath);
      const updated = [{ path: dirPath, name: project.name, openedAt: new Date().toISOString() }, ...recents].slice(0, 10);
      set({ recentProjects: updated });
      try { localStorage.setItem('seurat-recent-projects', JSON.stringify(updated)); } catch { /* ignore */ }
      await get().refreshCharacters();
    } catch (err) {
      console.error('Failed to open project:', err);
    }
  },

  closeProject: async () => {
    try {
      await api.closeProject();
    } catch { /* best effort */ }
    set({ project: null, projectPath: null, projectDirty: false });
    await get().refreshCharacters();
  },

  saveProject: async () => {
    const { project, projectPath, aiConfig } = get();
    if (!project || !projectPath) return;
    try {
      // Sync current AI config into project
      const updatedProject = { ...project, ai_config: aiConfig, modified_at: new Date().toISOString() };
      // Sync character list
      const chars = get().characters;
      updatedProject.characters = chars;
      await api.saveProject(updatedProject as unknown as Record<string, unknown>);
      set({ project: updatedProject, projectDirty: false });
    } catch (err) {
      console.error('Failed to save project:', err);
    }
  },

  exportCharacters: async (opts) => {
    set({ exportProgress: 'Exporting...', exportError: null });
    try {
      const res = await api.exportCharacters(opts);
      set({ exportProgress: `Export complete: ${JSON.stringify(res.results?.length ?? 0)} character(s)` });
    } catch (err) {
      set({ exportError: err instanceof Error ? err.message : String(err), exportProgress: null });
    }
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
/**
 * Composite a PNG (possibly with transparency) onto a solid white background.
 * This prevents IP-Adapter from seeing black/transparent regions that muddy
 * the character identity embedding.
 */
async function compositeOnWhite(pngBytes: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  // Fill white first, then draw the character on top
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const resultBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await resultBlob.arrayBuffer();
  return new Uint8Array(buf);
}

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
