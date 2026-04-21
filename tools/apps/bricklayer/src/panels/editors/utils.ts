import type { StaticLight } from '../../store/types.js';

export type LightType = 'point' | 'spot' | 'area';

export function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

export function getLightType(light: StaticLight): LightType {
  if ((light.area_width ?? 0) > 0) return 'area';
  if ((light.cone_angle ?? 180) < 180) return 'spot';
  return 'point';
}

export function parseEasing(value: string): { type: string; dir: string } {
  if (value === 'linear') return { type: 'linear', dir: 'in' };
  for (const dir of ['in_out', 'out', 'in']) {
    if (value.startsWith(dir + '_')) return { type: value.slice(dir.length + 1), dir };
  }
  return { type: 'linear', dir: 'in' };
}

export function composeEasing(type: string, dir: string): string {
  if (type === 'linear') return 'linear';
  return `${dir}_${type}`;
}
