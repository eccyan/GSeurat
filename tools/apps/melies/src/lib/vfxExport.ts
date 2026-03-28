import type { VfxPreset, VfxElement } from '../store/types.js';

function exportElement(el: VfxElement): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: el.name,
    type: el.type,
  };
  if (el.position && (el.position[0] !== 0 || el.position[1] !== 0 || el.position[2] !== 0)) {
    out.position = el.position;
  }
  if (el.start !== undefined && el.start !== 0) out.start = el.start;
  if (el.duration !== undefined) out.duration = el.duration;
  if (el.loop) out.loop = true;
  if (el.tags && el.tags.length > 0) out.tags = el.tags;
  // type=object
  if (el.ply_file) out.ply_file = el.ply_file;
  if (el.scale !== undefined && el.scale !== 1) out.scale = el.scale;
  // type=emitter
  if (el.emitter && Object.keys(el.emitter).length > 0) out.emitter = el.emitter;
  // type=animation
  if (el.animation && Object.keys(el.animation).length > 0) out.animation = el.animation;
  if (el.region) out.region = el.region;
  // type=light
  if (el.light) out.light = el.light;
  return out;
}

export function exportVfx(preset: VfxPreset): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: preset.name,
    elements: preset.elements.map(exportElement),
  };
  if (preset.duration !== undefined) out.duration = preset.duration;
  if (preset.category) out.category = preset.category;
  return out;
}

export function serializeVfx(preset: VfxPreset): string {
  return JSON.stringify(exportVfx(preset), null, 2);
}
