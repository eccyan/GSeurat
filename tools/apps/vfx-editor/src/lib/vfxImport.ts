import type { VfxPreset, VfxLayer, LayerType, Phase } from '../store/types.js';

let importIdCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_import_${Date.now()}_${++importIdCounter}`;
}

export function parseVfx(json: string): VfxPreset {
  const data = JSON.parse(json);

  const duration = data.duration ?? 3.0;
  const phases = data.phases ?? {
    anticipation: duration * 0.3,
    impact: duration * 0.5,
  };

  const layers: VfxLayer[] = (data.layers ?? []).map((l: Record<string, unknown>) => ({
    id: genId('layer'),
    name: (l.name as string) ?? 'Unnamed',
    type: (l.type as LayerType) ?? 'emitter',
    phase: (l.phase as Phase) ?? 'custom',
    start: (l.start as number) ?? 0,
    duration: (l.duration as number) ?? 1,
    emitter: l.emitter as Record<string, unknown> | undefined,
    animation: l.animation as Record<string, unknown> | undefined,
    light: l.light as { color: [number, number, number]; intensity: number; radius: number } | undefined,
  }));

  return {
    id: genId('vfx'),
    name: data.name ?? 'Imported VFX',
    duration,
    phases,
    layers,
  };
}
