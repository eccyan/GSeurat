import type { FrameStatus, PipelineStage } from '@vulkan-game-tools/asset-types';

export type Section =
  | 'dashboard'
  | 'concept'
  | 'generate'
  | 'review'
  | 'animate'
  | 'atlas'
  | 'manifest';

export type TreeSelection =
  | { kind: 'manifest' }
  | { kind: 'character'; characterId: string }
  | { kind: 'animation'; characterId: string; animName: string };

export interface LoraConfig {
  name: string;
  weight: number;
}

export interface AIConfig {
  comfyUrl: string;
  checkpoint: string;
  vae: string;
  steps: number;
  seed: number;
  cfg: number;
  sampler: string;
  denoise: number;
  loras: LoraConfig[];
  controlNetModel: string;
  controlStrength: number;
  removeBackground: boolean;
  remBgNodeType: string;
  useIPAdapter: boolean;
  ipAdapterWeight: number;
  ipAdapterPreset: string;
  ipAdapterStartAt: number;
  ipAdapterEndAt: number;
  consistentSeed: boolean;
  chibiWeight: number;
  chibiDenoise: number;
  pass1Cfg: number;
  pass2Cfg: number;
  openPoseModel: string;
  openPoseStrength: number;
  pixelDownscaleSize: number;
  downscaleMethod: string;
  useAnimateDiff: boolean;
  motionModel: string;
  animFrameCount: number;
  animFrameRate: number;
  animContextLength: number;
  interpMethod: 'blend' | 'rife';
  interpMultiplier: number;
  rifeModel: string;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  comfyUrl: 'http://127.0.0.1:8188',
  checkpoint: 'v1-5-pruned-emaonly.safetensors',
  vae: 'vae-ft-mse-840000-ema-pruned.safetensors',
  steps: 30,
  seed: 42,
  cfg: 7,
  sampler: 'euler',
  denoise: 0.1,
  loras: [{ name: 'PixelArtRedmond15V-PixelArt-PIXARFK', weight: 0.4 }],
  controlNetModel: 'control_v11f1e_sd15_tile',
  controlStrength: 0.7,
  removeBackground: true,
  remBgNodeType: 'BRIA_RMBG_Zho',
  useIPAdapter: true,
  ipAdapterWeight: 0.5,
  ipAdapterPreset: 'PLUS (high strength)',
  ipAdapterStartAt: 0.0,
  ipAdapterEndAt: 0.7,
  consistentSeed: true,
  chibiWeight: 0.5,
  chibiDenoise: 0.7,
  pass1Cfg: 7,
  pass2Cfg: 5,
  openPoseModel: 'control_v11p_sd15_openpose',
  openPoseStrength: 1.0,
  pixelDownscaleSize: 48,
  downscaleMethod: 'nearest-exact',
  useAnimateDiff: false,
  motionModel: 'mm_sd_v15_v2.ckpt',
  animFrameCount: 8,
  animFrameRate: 8,
  animContextLength: 16,
  interpMethod: 'blend',
  interpMultiplier: 2,
  rifeModel: 'rife47',
};

export interface GenerationJob {
  id: string;
  animName: string;
  frameIndex: number;
  status: 'queued' | 'running' | 'done' | 'error';
  pass?: 'pass1' | 'pass2' | 'pass3';
  error?: string;
  seed?: number;
}

export interface ClipboardFrame {
  animName: string;
  frameIndex: number;
  pass: PipelineStage;
  pngBytes: Uint8Array;
}

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export type ReviewFilter = FrameStatus | 'all';

export interface AssembleResult {
  totalFrames: number;
  generatedFrames: number;
  errors: string[];
  spritesheetUrl?: string;
}

export interface ExportPreset {
  format: 'spritesheet' | 'individual';
  include_characters: string[];
  output_dir: string;
}

export interface ProjectMeta {
  version: number;
  name: string;
  created_at: string;
  modified_at: string;
  characters: string[];
  ai_config: AIConfig | null;
  export_presets: Record<string, ExportPreset>;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}
