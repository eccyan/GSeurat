import type { VfxPreset, VfxLayer } from '../store/types.js';

function exportLayer(layer: VfxLayer): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: layer.name,
    type: layer.type,
    start: layer.start,
    duration: layer.duration,
  };
  if (layer.tags && layer.tags.length > 0) out.tags = layer.tags;
  if (layer.emitter && Object.keys(layer.emitter).length > 0) out.emitter = layer.emitter;
  if (layer.animation && Object.keys(layer.animation).length > 0) out.animation = layer.animation;
  if (layer.light) out.light = layer.light;
  return out;
}

export function exportVfx(preset: VfxPreset): Record<string, unknown> {
  return {
    name: preset.name,
    duration: preset.duration,
    layers: preset.layers.map(exportLayer),
  };
}

export function serializeVfx(preset: VfxPreset): string {
  return JSON.stringify(exportVfx(preset), null, 2);
}
