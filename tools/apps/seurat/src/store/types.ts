import type { FrameStatus } from '@vulkan-game-tools/asset-types';

export type Section =
  | 'dashboard'
  | 'concept'
  | 'generate'
  | 'review'
  | 'animate'
  | 'atlas'
  | 'manifest';

export interface AIConfig {
  comfyUrl: string;
  steps: number;
  seed: number;
  cfg: number;
  sampler: string;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  comfyUrl: 'http://127.0.0.1:8188',
  steps: 20,
  seed: -1,
  cfg: 7,
  sampler: 'euler_ancestral',
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
  approvedFrames: number;
  errors: string[];
  spritesheetUrl?: string;
}
