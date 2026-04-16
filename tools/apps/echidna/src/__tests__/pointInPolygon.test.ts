import { describe, it, expect } from 'vitest';
import { pointInPolygon } from '../lib/pointInPolygon.js';

describe('pointInPolygon', () => {
  const triangle: [number, number][] = [[0, 0], [10, 0], [5, 10]];
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  // U-shape concave polygon
  const concave: [number, number][] = [
    [0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10],
  ];

  it('point inside triangle returns true', () => {
    expect(pointInPolygon(5, 3, triangle)).toBe(true);
  });

  it('point outside triangle returns false', () => {
    expect(pointInPolygon(15, 5, triangle)).toBe(false);
    expect(pointInPolygon(-1, 5, triangle)).toBe(false);
    expect(pointInPolygon(5, 15, triangle)).toBe(false);
  });

  it('point at center of square returns true', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it('point in concave region returns false', () => {
    // Inside the "U" notch
    expect(pointInPolygon(5, 8, concave)).toBe(false);
  });

  it('point in solid part of concave shape returns true', () => {
    expect(pointInPolygon(5, 1, concave)).toBe(true);
  });

  it('empty or degenerate polygon returns false', () => {
    expect(pointInPolygon(5, 5, [])).toBe(false);
    expect(pointInPolygon(5, 5, [[0, 0]])).toBe(false);
    expect(pointInPolygon(5, 5, [[0, 0], [10, 10]])).toBe(false);
  });
});
