/**
 * Ray-casting point-in-polygon test.
 * Returns true if point (x, y) is inside the polygon defined by vertices.
 *
 * Uses the crossing number algorithm: cast a horizontal ray from the point
 * to +infinity and count how many polygon edges it crosses. Odd = inside.
 */
export function pointInPolygon(
  x: number,
  y: number,
  polygon: [number, number][],
): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}
