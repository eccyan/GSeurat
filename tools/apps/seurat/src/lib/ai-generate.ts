import type { CharacterManifest, CharacterAnimation, ViewDirection } from '@gseurat/asset-types';
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
  'blurry, smooth, realistic, 3d render, photorealistic, watermark, text, signature, noise, static, artifacts, multiple people, crowd, group, duplicate, background, scenery, landscape, buildings, objects, detailed background, room, interior, furniture, outdoor, frame, border, ornate frame, decorative border, circular frame, art nouveau, corner ornaments, vignette, picture frame, character sheet, turnaround, turnaround sheet, multiple views, reference sheet, model sheet, expression sheet, multiple poses, multiple angles';

/** Terms in the style prompt that trigger turnaround-sheet generation in anime models */
const SHEET_TRIGGER_TERMS = [
  'character design',
  'character sheet',
  'concept art',
  'reference sheet',
  'model sheet',
  'turnaround',
  'turn around',
  'multiple views',
  'multiple angles',
];

/** Strip turnaround-sheet-triggering terms from a style prompt */
export function sanitizeStylePrompt(stylePrompt: string): string {
  let result = stylePrompt;
  for (const term of SHEET_TRIGGER_TERMS) {
    // Remove the term (case-insensitive), plus any trailing comma/space
    result = result.replace(new RegExp(`\\b${term}\\b[,\\s]*`, 'gi'), '');
  }
  // Clean up leading/trailing commas and whitespace
  return result.replace(/^[,\s]+|[,\s]+$/g, '').replace(/,\s*,/g, ',');
}

export const CONCEPT_VIEW_PROMPTS: Record<ViewDirection, string> = {
  front: 'solo, single character, full body, facing forward, front view, looking at viewer, plain white background, no frame, no border, single view',
  back:  'solo, single character, full body, from behind, back view, facing away, plain white background, no frame, no border, single view',
  right: 'solo, single character, full body, right side view, profile view, facing right, plain white background, no frame, no border, single view',
  left:  'solo, single character, full body, left side view, profile view, facing left, plain white background, no frame, no border, single view',
};

const DIR_DESCRIPTIONS: Record<string, string> = {
  S: 'facing forward, front view, looking at viewer',
  N: 'facing away, back view, from behind',
  E: 'facing right, right side profile, looking right',
  W: 'facing left, left side profile, looking left',
};

const STATE_PHASES: Record<string, string[]> = {
  idle: ['standing still', 'standing still, slight movement', 'standing still', 'standing still, slight sway'],
  walk: ['left foot forward', 'standing upright mid-step', 'right foot forward', 'standing upright mid-step'],
  run: ['foot contact, leg extended forward', 'both feet off ground, airborne', 'foot contact, other leg extended', 'both feet off ground, airborne'],
};

export function buildFramePrompt(
  manifest: CharacterManifest,
  anim: CharacterAnimation,
  frameIndex: number,
): string {
  const { concept } = manifest;
  const dirDesc = DIR_DESCRIPTIONS[anim.direction] ?? `facing ${anim.direction}`;
  const phases = STATE_PHASES[anim.state] ?? Array(anim.frames.length).fill(anim.state);
  const phase = phases[frameIndex % phases.length];

  // Do not include style_prompt — IP-Adapter transfers style from reference image.
  // Put direction first for strongest influence on pose orientation.
  return [
    dirDesc,
    concept.description,
    `${anim.state} pose`,
    phase,
    'solo, single character, full body, centered, plain white background, solid color background',
  ].join(', ');
}

/**
 * Build a pass-2 prompt.
 * Pass 2 relies on IP-Adapter with chibi reference for style transfer.
 * The prompt provides base frame context only.
 */
export function buildPass2Prompt(
  manifest: CharacterManifest,
  anim: CharacterAnimation,
  frameIndex: number,
): string {
  return buildFramePrompt(manifest, anim, frameIndex);
}

/**
 * Build a pass-2 negative prompt.
 */
export function buildPass2NegativePrompt(manifest: CharacterManifest): string {
  return buildNegativePrompt(manifest);
}

export function buildNegativePrompt(manifest: CharacterManifest): string {
  const custom = manifest.concept.negative_prompt;
  if (custom) return `${custom}, ${DEFAULT_NEGATIVE_PROMPT}`;
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
    'pixel art, 8-bit, retro game graphics, clean edges, game asset, spritesheet row, plain white background, solid color background',
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
