import type { CharacterManifest, CharacterAnimation } from '@vulkan-game-tools/asset-types';
import type { AIConfig } from '../store/types.js';

export const SAMPLER_NAMES = [
  'euler',
  'euler_ancestral',
  'dpmpp_2m',
  'dpmpp_sde',
  'ddim',
  'uni_pc',
] as const;

export const DEFAULT_NEGATIVE_PROMPT =
  'blurry, smooth, realistic, 3d render, photorealistic, watermark, text, signature, noise, static, artifacts';

const DIR_DESCRIPTIONS: Record<string, string> = {
  S: 'facing forward, front view',
  N: 'facing away, back view',
  E: 'facing right, side view',
  W: 'facing left, side view',
};

const STATE_PHASES: Record<string, string[]> = {
  idle: ['standing still', 'standing still, slight movement', 'standing still', 'standing still, slight sway'],
  walk: ['left foot forward', 'standing upright mid-step', 'right foot forward', 'standing upright mid-step'],
  run: ['left foot extended', 'both feet off ground', 'right foot extended', 'both feet off ground'],
};

export function buildFramePrompt(
  manifest: CharacterManifest,
  anim: CharacterAnimation,
  frameIndex: number,
): string {
  const { concept, spritesheet } = manifest;
  const dirDesc = DIR_DESCRIPTIONS[anim.direction] ?? `facing ${anim.direction}`;
  const phases = STATE_PHASES[anim.state] ?? Array(anim.frames.length).fill(anim.state);
  const phase = phases[frameIndex % phases.length];
  const frameCount = anim.frames.length;

  return [
    concept.style_prompt,
    concept.description,
    dirDesc,
    `${anim.state} pose`,
    phase,
    `${spritesheet.frame_width}x${spritesheet.frame_height}`,
    'pixel art, 8-bit, retro game graphics, clean edges, game asset, single character, centered, transparent background, same character',
  ].join(', ');
}

export function buildNegativePrompt(manifest: CharacterManifest): string {
  const custom = manifest.concept.negative_prompt;
  if (custom) return `${custom}, watermark, text, signature`;
  return DEFAULT_NEGATIVE_PROMPT;
}

export function buildRowPrompts(
  manifest: CharacterManifest,
  anim: CharacterAnimation,
): string[] {
  return anim.frames.map((_, i) => buildFramePrompt(manifest, anim, i));
}

export function buildSheetRowPrompt(
  manifest: CharacterManifest,
  anim: CharacterAnimation,
): string {
  const { concept, spritesheet } = manifest;
  const dirDesc = DIR_DESCRIPTIONS[anim.direction] ?? `facing ${anim.direction}`;
  const frameCount = anim.frames.length;
  const phases = STATE_PHASES[anim.state] ?? Array(frameCount).fill(anim.state);
  const phaseList = phases.slice(0, frameCount).join(', then ');

  return [
    concept.style_prompt,
    concept.description,
    `sprite sheet strip, ${frameCount} frames in a single horizontal row`,
    `${anim.state} animation cycle, ${dirDesc}`,
    `animation sequence: ${phaseList}`,
    `each frame ${spritesheet.frame_width}x${spritesheet.frame_height} pixels`,
    `total image size ${spritesheet.frame_width * frameCount}x${spritesheet.frame_height}`,
    'evenly spaced frames, consistent character across all frames',
    'pixel art, 8-bit, retro game graphics, clean edges, game asset, spritesheet row, transparent background',
  ].join(', ');
}

export interface ComfyGenerateParams {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  sampler: string;
}

export function buildComfyParams(
  manifest: CharacterManifest,
  anim: CharacterAnimation,
  frameIndex: number,
  config: AIConfig,
): ComfyGenerateParams {
  return {
    prompt: buildFramePrompt(manifest, anim, frameIndex),
    negative_prompt: buildNegativePrompt(manifest),
    width: manifest.spritesheet.frame_width,
    height: manifest.spritesheet.frame_height,
    steps: config.steps,
    cfg: config.cfg,
    seed: config.seed === -1 ? Math.floor(Math.random() * 2147483647) : config.seed,
    sampler: config.sampler,
  };
}
