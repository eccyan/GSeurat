import { describe, it, expect } from 'vitest';
import { applyEasing } from '../lib/easing.js';
import type { EasingType } from '../store/types.js';

describe('applyEasing', () => {
  it('linear: t=0 → 0, t=0.5 → 0.5, t=1 → 1', () => {
    expect(applyEasing('linear', 0)).toBeCloseTo(0);
    expect(applyEasing('linear', 0.5)).toBeCloseTo(0.5);
    expect(applyEasing('linear', 1)).toBeCloseTo(1);
  });

  it('step: t<1 → 0, t=1 → 1', () => {
    expect(applyEasing('step', 0)).toBe(0);
    expect(applyEasing('step', 0.5)).toBe(0);
    expect(applyEasing('step', 0.99)).toBe(0);
    expect(applyEasing('step', 1)).toBe(1);
  });

  it('ease-in-out: t=0 → 0, t=0.5 → 0.5, t=1 → 1, monotonic', () => {
    expect(applyEasing('ease-in-out', 0)).toBeCloseTo(0);
    expect(applyEasing('ease-in-out', 0.5)).toBeCloseTo(0.5);
    expect(applyEasing('ease-in-out', 1)).toBeCloseTo(1);
    let prev = 0;
    for (let t = 0.1; t <= 1; t += 0.1) {
      const v = applyEasing('ease-in-out', t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('bounce: t=0 → 0, t=1 → 1', () => {
    expect(applyEasing('bounce', 0)).toBeCloseTo(0);
    expect(applyEasing('bounce', 1)).toBeCloseTo(1);
  });

  it('elastic: t=0 → 0, t=1 → ~1', () => {
    expect(applyEasing('elastic', 0)).toBeCloseTo(0);
    expect(applyEasing('elastic', 1)).toBeCloseTo(1, 1);
  });

  it('custom: uses cubic bezier control points', () => {
    expect(applyEasing('custom', 0.5, [0, 0, 1, 1])).toBeCloseTo(0.5, 1);
    expect(applyEasing('custom', 0, [0, 0, 1, 1])).toBeCloseTo(0);
    expect(applyEasing('custom', 1, [0, 0, 1, 1])).toBeCloseTo(1);
  });

  it('custom without curve falls back to linear', () => {
    expect(applyEasing('custom', 0.5)).toBeCloseTo(0.5);
  });

  it('all easings return values in reasonable range [−0.5, 1.5]', () => {
    const types: EasingType[] = ['linear', 'ease-in-out', 'bounce', 'elastic', 'step'];
    for (const type of types) {
      for (let t = 0; t <= 1; t += 0.05) {
        const v = applyEasing(type, t);
        expect(v).toBeGreaterThanOrEqual(-0.5);
        expect(v).toBeLessThanOrEqual(1.5);
      }
    }
  });
});
