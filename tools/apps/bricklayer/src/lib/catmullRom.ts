/**
 * Catmull-Rom spline evaluation (uniform, tau=0.5).
 * Same formula as C++ gs_spline.cpp and Méliès catmullRom.ts.
 */

type Vec3 = [number, number, number];

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3),
  ];
}

function ghost(a: Vec3, b: Vec3): Vec3 {
  return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
}

/** Evaluate Catmull-Rom spline at parameter t in [0, 1]. */
export function evaluateCatmullRom(points: Vec3[], t: number): Vec3 {
  if (points.length < 2) return points[0] ?? [0, 0, 0];
  const segments = points.length - 1;
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * segments;
  const seg = Math.min(Math.floor(scaled), segments - 1);
  const localT = scaled - seg;

  const p1 = points[seg];
  const p2 = points[seg + 1];
  const p0 = seg > 0 ? points[seg - 1] : ghost(p1, p2);
  const p3 = seg + 2 < points.length ? points[seg + 2] : ghost(p2, p1);

  return catmullRom(p0, p1, p2, p3, localT);
}

/** Sample N evenly-spaced points along the spline for line rendering. */
export function sampleCatmullRom(points: Vec3[], numSamples = 64): Vec3[] {
  if (points.length < 2) return [...points];
  const result: Vec3[] = [];
  for (let i = 0; i <= numSamples; i++) {
    result.push(evaluateCatmullRom(points, i / numSamples));
  }
  return result;
}
