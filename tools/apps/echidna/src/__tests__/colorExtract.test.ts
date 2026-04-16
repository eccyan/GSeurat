import { describe, it, expect } from 'vitest';
import { extractColorsFromImage } from '../lib/colorExtract.js';

function solidColorImageData(r: number, g: number, b: number, w = 8, h = 8): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('extractColorsFromImage', () => {
  it('returns a single color for a solid-fill image', () => {
    const img = solidColorImageData(120, 200, 80);
    const colors = extractColorsFromImage(img, 16);
    expect(colors.length).toBeGreaterThanOrEqual(1);
    // Bucketed, so the reported color is close but not necessarily exact
    const [r, g, b, a] = colors[0];
    expect(Math.abs(r - 120)).toBeLessThan(8);
    expect(Math.abs(g - 200)).toBeLessThan(8);
    expect(Math.abs(b - 80)).toBeLessThan(8);
    expect(a).toBe(255);
  });

  it('skips transparent pixels', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    // First pixel opaque red, rest transparent
    data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255;
    const img = { data, width: 4, height: 4, colorSpace: 'srgb' } as ImageData;
    const colors = extractColorsFromImage(img, 16);
    expect(colors.length).toBe(1);
    expect(colors[0][0]).toBeGreaterThan(240);
    expect(colors[0][1]).toBeLessThan(16);
    expect(colors[0][2]).toBeLessThan(16);
  });
});
