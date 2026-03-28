import type { VfxPreset, VfxElement, ElementType } from '../store/types.js';

let importIdCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_import_${Date.now()}_${++importIdCounter}`;
}

export function parseVfx(json: string): VfxPreset {
  const data = JSON.parse(json);

  // v2 uses "elements", v1 used "layers" — accept both
  const rawElements = data.elements ?? data.layers ?? [];

  const elements: VfxElement[] = rawElements.map((el: Record<string, unknown>) => {
    // Migrate v1 phase field to tags
    const tags: string[] = el.tags as string[] ?? [];
    if (el.phase && el.phase !== 'custom' && tags.length === 0) {
      tags.push(el.phase as string);
    }

    return {
      id: genId('el'),
      name: (el.name as string) ?? 'Unnamed',
      type: (el.type as ElementType) ?? 'emitter',
      position: el.position as [number, number, number] | undefined,
      tags: tags.length > 0 ? tags : undefined,
      start: el.start as number | undefined,
      duration: el.duration as number | undefined,
      loop: el.loop as boolean | undefined,
      ply_file: el.ply_file as string | undefined,
      scale: el.scale as number | undefined,
      emitter: el.emitter as Record<string, unknown> | undefined,
      animation: el.animation as Record<string, unknown> | undefined,
      region: el.region as { shape: string; radius?: number; half_extents?: [number, number, number] } | undefined,
      light: el.light as { color: [number, number, number]; intensity: number; radius: number } | undefined,
    };
  });

  return {
    id: genId('vfx'),
    name: data.name ?? 'Imported VFX',
    duration: data.duration as number | undefined,
    category: data.category as string | undefined,
    elements,
  };
}
