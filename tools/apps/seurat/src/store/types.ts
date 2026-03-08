import type { FrameStatus } from '@vulkan-game-tools/asset-types';

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
  openPoseModel: string;
  openPoseStrength: number;
  pixelPassEnabled: boolean;
  pixelPassDenoise: number;
  useAnimateDiff: boolean;
  motionModel: string;
  animFrameCount: number;
  animFrameRate: number;
  animContextLength: number;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  comfyUrl: 'http://127.0.0.1:8188',
  checkpoint: 'v1-5-pruned-emaonly.safetensors',
  steps: 20,
  seed: 42,
  cfg: 2,
  sampler: 'euler',
  denoise: 0.1,
  loras: [{ name: 'PixelArtRedmond15V-PixelArt-PIXARFK', weight: 0.4 }],
  controlNetModel: 'control_v11f1e_sd15_tile',
  controlStrength: 0.7,
  removeBackground: false,
  remBgNodeType: 'BRIA_RMBG_Zho',
  useIPAdapter: true,
  ipAdapterWeight: 0.7,
  ipAdapterPreset: 'PLUS (high strength)',
  ipAdapterStartAt: 0.0,
  ipAdapterEndAt: 0.8,
  consistentSeed: true,
  chibiWeight: 0.7,
  chibiDenoise: 0.7,
  openPoseModel: 'control_v11p_sd15_openpose',
  openPoseStrength: 0.5,
  pixelPassEnabled: true,
  pixelPassDenoise: 0.35,
  useAnimateDiff: false,
  motionModel: 'mm_sd_v15_v2.ckpt',
  animFrameCount: 8,
  animFrameRate: 8,
  animContextLength: 16,
};

export interface GenerationJob {
  id: string;
  animName: string;
  frameIndex: number;
  status: 'queued' | 'running' | 'done' | 'error';
  error?: string;
}

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export type ReviewFilter = FrameStatus | 'all';

export interface AssembleResult {
  totalFrames: number;
  generatedFrames: number;
  errors: string[];
  spritesheetUrl?: string;
}
