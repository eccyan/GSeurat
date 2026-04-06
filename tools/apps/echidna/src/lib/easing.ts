import type { EasingType } from '../store/types.js';

function linear(t: number): number {
  return t;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function bounceOut(t: number): number {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  } else if (t < 2 / 2.75) {
    const t2 = t - 1.5 / 2.75;
    return 7.5625 * t2 * t2 + 0.75;
  } else if (t < 2.5 / 2.75) {
    const t2 = t - 2.25 / 2.75;
    return 7.5625 * t2 * t2 + 0.9375;
  } else {
    const t2 = t - 2.625 / 2.75;
    return 7.5625 * t2 * t2 + 0.984375;
  }
}

function elastic(t: number): number {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
}

function step(t: number): number {
  return t < 1 ? 0 : 1;
}

function cubicBezier(t: number, cx1: number, cy1: number, cx2: number, cy2: number): number {
  let s = t;
  for (let i = 0; i < 8; i++) {
    const bx = 3 * (1 - s) * (1 - s) * s * cx1 + 3 * (1 - s) * s * s * cx2 + s * s * s;
    const dbx = 3 * (1 - s) * (1 - s) * cx1 + 6 * (1 - s) * s * (cx2 - cx1) + 3 * s * s * (1 - cx2);
    if (Math.abs(dbx) < 1e-6) break;
    s = s - (bx - t) / dbx;
    s = Math.max(0, Math.min(1, s));
  }
  return 3 * (1 - s) * (1 - s) * s * cy1 + 3 * (1 - s) * s * s * cy2 + s * s * s;
}

export function applyEasing(
  type: EasingType,
  t: number,
  curve?: [number, number, number, number],
): number {
  switch (type) {
    case 'linear': return linear(t);
    case 'ease-in-out': return easeInOut(t);
    case 'bounce': return bounceOut(t);
    case 'elastic': return elastic(t);
    case 'step': return step(t);
    case 'custom':
      if (curve) return cubicBezier(t, curve[0], curve[1], curve[2], curve[3]);
      return linear(t);
  }
}
