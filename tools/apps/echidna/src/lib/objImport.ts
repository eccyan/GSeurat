/**
 * OBJ importer for Echidna.
 *
 * Parses Wavefront OBJ text and voxelizes the mesh into the Echidna voxel grid
 * using 3-axis ray casting with Möller–Trumbore ray-triangle intersection.
 *
 * The mesh is scaled to fit the target grid size, maintaining aspect ratio.
 * All voxels are assigned a default gray color; the result has a single "root" part.
 */

import type { Voxel, VoxelKey, BodyPart } from '../store/types.js';
import { voxelKey } from './voxelUtils.js';

export interface ObjImportResult {
  voxels: Map<VoxelKey, Voxel>;
  parts: BodyPart[];
  gridSize: number;
}

const DEFAULT_COLOR: [number, number, number, number] = [180, 180, 180, 255];

// ── OBJ Parsing ─────────────────────────────────────────────────────────────

interface Vec3 {
  x: number; y: number; z: number;
}

interface Triangle {
  a: Vec3; b: Vec3; c: Vec3;
}

function parseObj(text: string): Triangle[] {
  const vertices: Vec3[] = [];
  const triangles: Triangle[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v') {
      vertices.push({
        x: parseFloat(parts[1]),
        y: parseFloat(parts[2]),
        z: parseFloat(parts[3]),
      });
    } else if (cmd === 'f') {
      // Faces: "v", "v/vt", "v/vt/vn", "v//vn" — take vertex index only
      const indices = parts.slice(1).map(token => {
        const vi = parseInt(token.split('/')[0], 10);
        // OBJ indices are 1-based; negative means relative
        return vi > 0 ? vi - 1 : vertices.length + vi;
      });

      // Triangulate fan from first vertex
      for (let i = 1; i < indices.length - 1; i++) {
        const a = vertices[indices[0]];
        const b = vertices[indices[i]];
        const c = vertices[indices[i + 1]];
        if (a && b && c) {
          triangles.push({ a, b, c });
        }
      }
    }
  }

  return triangles;
}

// ── Bounding Box ─────────────────────────────────────────────────────────────

interface BBox {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

function computeBBox(triangles: Triangle[]): BBox {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const { a, b, c } of triangles) {
    for (const v of [a, b, c]) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

// ── Möller–Trumbore ray-triangle intersection ─────────────────────────────────
// Returns t (ray parameter) or null if no intersection.
// Ray: origin + t * direction

const EPSILON = 1e-9;

function rayTriangleIntersect(
  ox: number, oy: number, oz: number,    // ray origin
  dx: number, dy: number, dz: number,   // ray direction (unit)
  ax: number, ay: number, az: number,   // triangle vertex A
  bx: number, by: number, bz: number,   // triangle vertex B
  cx: number, cy: number, cz: number,   // triangle vertex C
): number | null {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

  // h = direction × e2
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;

  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < EPSILON) return null; // parallel

  const invDet = 1 / det;

  // s = origin - A
  const sx = ox - ax, sy = oy - ay, sz = oz - az;

  const u = (sx * hx + sy * hy + sz * hz) * invDet;
  if (u < 0 || u > 1) return null;

  // q = s × e1
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;

  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0 || u + v > 1) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t >= 0 ? t : null;
}

// ── Triangle surface rasterization ──────────────────────────────────────────

/**
 * Directly rasterize triangle surfaces into the voxel grid.
 * For each triangle, sample along its surface using barycentric coords,
 * and mark each encountered grid cell as filled.
 * This handles degenerate (flat/thin) geometry that parity-fill misses.
 */
function rasterizeSurface(
  gtris: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number }[],
  gridSize: number,
  filled: Set<string>,
): void {
  for (const t of gtris) {
    // Compute triangle bounding box in grid space
    const minX = Math.max(0, Math.floor(Math.min(t.ax, t.bx, t.cx)));
    const maxX = Math.min(gridSize - 1, Math.ceil(Math.max(t.ax, t.bx, t.cx)));
    const minY = Math.max(0, Math.floor(Math.min(t.ay, t.by, t.cy)));
    const maxY = Math.min(gridSize - 1, Math.ceil(Math.max(t.ay, t.by, t.cy)));
    const minZ = Math.max(0, Math.floor(Math.min(t.az, t.bz, t.cz)));
    const maxZ = Math.min(gridSize - 1, Math.ceil(Math.max(t.az, t.bz, t.cz)));

    // Number of samples proportional to the surface area
    const steps = Math.max(gridSize, maxX - minX + maxY - minY + maxZ - minZ + 3) * 2;
    const stepInv = 1 / steps;

    for (let si = 0; si <= steps; si++) {
      const u = si * stepInv;
      for (let sj = 0; sj <= steps - si; sj++) {
        const v = sj * stepInv;
        const w = 1 - u - v;
        if (w < 0) continue;

        const px = t.ax * u + t.bx * v + t.cx * w;
        const py = t.ay * u + t.by * v + t.cy * w;
        const pz = t.az * u + t.bz * v + t.cz * w;

        const gx = Math.round(px);
        const gy = Math.round(py);
        const gz = Math.round(pz);

        if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize && gz >= 0 && gz < gridSize) {
          filled.add(`${gx},${gy},${gz}`);
        }
      }
    }
  }
}

// ── Voxelization ─────────────────────────────────────────────────────────────

/**
 * Voxelize triangles using 3-axis ray casting with parity fill,
 * plus direct surface rasterization for thin/flat geometry.
 *
 * For each axis and each (i, j) grid cell perpendicular to that axis,
 * cast a ray and collect all triangle-intersection t values.
 * Sort them and fill cells between pairs (even→odd crossings).
 */
function voxelizeTriangles(
  triangles: Triangle[],
  bbox: BBox,
  gridSize: number,
): Set<string> {
  const filled = new Set<string>();

  const rangeX = bbox.maxX - bbox.minX;
  const rangeY = bbox.maxY - bbox.minY;
  const rangeZ = bbox.maxZ - bbox.minZ;
  const maxRange = Math.max(rangeX, rangeY, rangeZ, EPSILON);

  // Scale so the longest axis fits gridSize-1 voxels; center the mesh.
  const scale = (gridSize - 1) / maxRange;
  const offX = (gridSize - 1 - rangeX * scale) / 2 - bbox.minX * scale;
  const offY = (gridSize - 1 - rangeY * scale) / 2 - bbox.minY * scale;
  const offZ = (gridSize - 1 - rangeZ * scale) / 2 - bbox.minZ * scale;

  // Pre-transform triangles into grid space
  interface GTri {
    ax: number; ay: number; az: number;
    bx: number; by: number; bz: number;
    cx: number; cy: number; cz: number;
  }

  const gtris: GTri[] = triangles.map(({ a, b, c }) => ({
    ax: a.x * scale + offX, ay: a.y * scale + offY, az: a.z * scale + offZ,
    bx: b.x * scale + offX, by: b.y * scale + offY, bz: b.z * scale + offZ,
    cx: c.x * scale + offX, cy: c.y * scale + offY, cz: c.z * scale + offZ,
  }));

  // Helper: cast ray along axis `axis` at perpendicular coords (p0, p1),
  // collect intersection depths along the axis, fill pairs.
  const castRay = (
    axis: 0 | 1 | 2,
    p0: number, p1: number,
    fill: (depth: number, p0: number, p1: number) => void,
  ) => {
    const ts: number[] = [];

    for (const t of gtris) {
      let ox: number, oy: number, oz: number;
      let dx: number, dy: number, dz: number;
      let ax: number, ay: number, az: number;
      let bx: number, by: number, bz: number;
      let cx: number, cy: number, cz: number;

      if (axis === 0) {
        // Ray along X: origin = (-1, p0, p1), dir = (1, 0, 0)
        ox = -1; oy = p0; oz = p1;
        dx = 1;  dy = 0;  dz = 0;
        ax = t.ax; ay = t.ay; az = t.az;
        bx = t.bx; by = t.by; bz = t.bz;
        cx = t.cx; cy = t.cy; cz = t.cz;
      } else if (axis === 1) {
        // Ray along Y: origin = (p0, -1, p1), dir = (0, 1, 0)
        ox = p0; oy = -1; oz = p1;
        dx = 0;  dy = 1;  dz = 0;
        ax = t.ax; ay = t.ay; az = t.az;
        bx = t.bx; by = t.by; bz = t.bz;
        cx = t.cx; cy = t.cy; cz = t.cz;
      } else {
        // Ray along Z: origin = (p0, p1, -1), dir = (0, 0, 1)
        ox = p0; oy = p1; oz = -1;
        dx = 0;  dy = 0;  dz = 1;
        ax = t.ax; ay = t.ay; az = t.az;
        bx = t.bx; by = t.by; bz = t.bz;
        cx = t.cx; cy = t.cy; cz = t.cz;
      }

      const hit = rayTriangleIntersect(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz);
      if (hit !== null) {
        // Convert t to grid depth along the axis
        // For axis 0: hit position along X = ox + t * dx = -1 + t
        const depth = axis === 0 ? hit - 1 : hit - 1;
        ts.push(depth);
      }
    }

    ts.sort((a, b) => a - b);

    // Fill pairs: between ts[0]..ts[1], ts[2]..ts[3], etc.
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const startDepth = ts[i];
      const endDepth = ts[i + 1];
      const startCell = Math.max(0, Math.floor(startDepth + 0.5));
      const endCell = Math.min(gridSize - 1, Math.ceil(endDepth - 0.5));
      for (let d = startCell; d <= endCell; d++) {
        fill(d, p0, p1);
      }
    }
  };

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      // Cast along X axis at (Y=i+0.5, Z=j+0.5)
      castRay(0, i + 0.5, j + 0.5, (depth, pi, pj) => {
        filled.add(`${Math.round(depth)},${Math.round(pi)},${Math.round(pj)}`);
      });
      // Cast along Y axis at (X=i+0.5, Z=j+0.5)
      castRay(1, i + 0.5, j + 0.5, (depth, pi, pj) => {
        filled.add(`${Math.round(pi)},${Math.round(depth)},${Math.round(pj)}`);
      });
      // Cast along Z axis at (X=i+0.5, Y=j+0.5)
      castRay(2, i + 0.5, j + 0.5, (depth, pi, pj) => {
        filled.add(`${Math.round(pi)},${Math.round(pj)},${Math.round(depth)}`);
      });
    }
  }

  // Also rasterize triangle surfaces directly to handle flat/thin geometry
  // that parity-fill misses (e.g. single-face triangles with no interior).
  rasterizeSurface(gtris, gridSize, filled);

  return filled;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an OBJ text string and voxelize the mesh into a voxel grid.
 *
 * @param text     - OBJ file contents as a string
 * @param gridSize - target grid size (default 16)
 */
export function parseObjToVoxels(text: string, gridSize: number = 16): ObjImportResult {
  const triangles = parseObj(text);

  if (triangles.length === 0) {
    const rootPart: BodyPart = {
      id: 'root', name: 'root', parent: null, joint: [0, 0, 0], voxelKeys: [],
    };
    return { voxels: new Map(), parts: [rootPart], gridSize };
  }

  const bbox = computeBBox(triangles);
  const filled = voxelizeTriangles(triangles, bbox, gridSize);

  const voxels = new Map<VoxelKey, Voxel>();
  const allKeys: VoxelKey[] = [];

  for (const key of filled) {
    const vk = key as VoxelKey;
    voxels.set(vk, { color: [...DEFAULT_COLOR] });
    allKeys.push(vk);
  }

  const rootPart: BodyPart = {
    id: 'root',
    name: 'root',
    parent: null,
    joint: [0, 0, 0],
    voxelKeys: allKeys,
  };

  return { voxels, parts: [rootPart], gridSize };
}
