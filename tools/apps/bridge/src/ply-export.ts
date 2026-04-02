/**
 * PLY export for Echidna voxel characters.
 *
 * Ported from tools/apps/echidna/src/lib/plyExport.ts for server-side use.
 * Produces binary little-endian PLY with 3DGS-compatible vertex properties.
 */

// ---------------------------------------------------------------------------
// Types (mirrors echidna/src/store/types.ts)
// ---------------------------------------------------------------------------

export interface Voxel {
  color: [number, number, number, number];
}

export type VoxelKey = `${number},${number},${number}`;

export interface BodyPart {
  id: string;
  parent: string | null;
  joint: [number, number, number];
  voxelKeys: VoxelKey[];
}

export interface EchidnaProject {
  version: number;
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[];
  parts: BodyPart[];
  poses: Record<string, unknown>;
  animations?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Voxel utils (mirrors echidna/src/lib/voxelUtils.ts)
// ---------------------------------------------------------------------------

function voxelKey(x: number, y: number, z: number): VoxelKey {
  return `${x},${y},${z}`;
}

function parseKey(key: VoxelKey): [number, number, number] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

// ---------------------------------------------------------------------------
// PLY export
// ---------------------------------------------------------------------------

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** Build a lookup from voxel key -> bone index for character export. */
function buildBoneMap(parts: BodyPart[]): Map<VoxelKey, number> {
  const map = new Map<VoxelKey, number>();
  for (let i = 0; i < parts.length; i++) {
    for (const key of parts[i].voxelKeys) {
      map.set(key, i);
    }
  }
  return map;
}

/**
 * Convert an EchidnaProject JSON into a binary PLY Buffer.
 */
export function exportPlyFromProject(project: EchidnaProject): Buffer {
  // Reconstruct voxel map from the project's serialised array
  const voxels = new Map<VoxelKey, Voxel>();
  for (const v of project.voxels) {
    voxels.set(voxelKey(v.x, v.y, v.z), {
      color: [v.r, v.g, v.b, v.a],
    });
  }

  return exportPly(voxels, project.gridWidth, project.gridDepth, project.parts);
}

/**
 * Core PLY export — mirrors echidna/src/lib/plyExport.ts `exportPly()`,
 * but returns a Node.js Buffer instead of a browser Blob.
 */
export function exportPly(
  voxels: Map<VoxelKey, Voxel>,
  gridWidth: number,
  _gridDepth: number,
  parts?: BodyPart[],
): Buffer {
  // Surface culling: skip interior voxels enclosed by 6 neighbours
  const allEntries = Array.from(voxels.entries());
  const entries = allEntries.filter(([key]) => {
    const [x, y, z] = parseKey(key);
    for (const [dx, dy, dz] of NEIGHBORS) {
      if (!voxels.has(voxelKey(x + dx, y + dy, z + dz))) {
        return true; // at least one face exposed
      }
    }
    return false; // fully enclosed
  });
  const count = entries.length;

  const hasBones = parts !== undefined && parts.length > 0;
  const boneMap = hasBones ? buildBoneMap(parts) : null;

  const header =
    `ply\n` +
    `format binary_little_endian 1.0\n` +
    `element vertex ${count}\n` +
    `property float x\n` +
    `property float y\n` +
    `property float z\n` +
    `property float f_dc_0\n` +
    `property float f_dc_1\n` +
    `property float f_dc_2\n` +
    `property float opacity\n` +
    `property float scale_0\n` +
    `property float scale_1\n` +
    `property float scale_2\n` +
    `property float rot_0\n` +
    `property float rot_1\n` +
    `property float rot_2\n` +
    `property float rot_3\n` +
    (hasBones ? `property uchar bone_index\n` : '') +
    `end_header\n`;

  const headerBytes = Buffer.from(header, 'utf8');
  const bytesPerVertex = 14 * 4 + (hasBones ? 1 : 0);
  const bodyBytes = count * bytesPerVertex;
  const buffer = Buffer.alloc(headerBytes.length + bodyBytes);
  headerBytes.copy(buffer, 0);

  let offset = headerBytes.length;
  const halfW = gridWidth / 2;
  const voxelScale = Math.log(0.5);

  // Find max Y for centering vertically
  let maxY = 0;
  for (const [key] of entries) {
    const [, vy] = parseKey(key);
    if (vy > maxY) maxY = vy;
  }
  const halfH = maxY / 2;

  for (const [key, voxel] of entries) {
    const [vx, vy, vz] = parseKey(key);

    // Center X and Y, depth along +Z
    const px = vx - halfW;
    const py = vy - halfH;
    const pz = vz;

    buffer.writeFloatLE(px, offset); offset += 4;
    buffer.writeFloatLE(py, offset); offset += 4;
    buffer.writeFloatLE(pz, offset); offset += 4;

    // SH DC coefficients (colour as 0..1 scaled by SH factor)
    const shFactor = 0.2820947917738781; // 0.5 / sqrt(pi)
    buffer.writeFloatLE((voxel.color[0] / 255 - 0.5) / shFactor, offset); offset += 4;
    buffer.writeFloatLE((voxel.color[1] / 255 - 0.5) / shFactor, offset); offset += 4;
    buffer.writeFloatLE((voxel.color[2] / 255 - 0.5) / shFactor, offset); offset += 4;

    // Opacity (pre-sigmoid: use a high value for opaque voxels)
    const alpha = voxel.color[3] / 255;
    const logitOpacity = Math.log(Math.max(alpha, 0.001) / Math.max(1 - alpha, 0.001));
    buffer.writeFloatLE(logitOpacity, offset); offset += 4;

    // Scale (pre-exp: log of half-voxel-size)
    buffer.writeFloatLE(voxelScale, offset); offset += 4;
    buffer.writeFloatLE(voxelScale, offset); offset += 4;
    buffer.writeFloatLE(voxelScale, offset); offset += 4;

    // Rotation quaternion (identity)
    buffer.writeFloatLE(1, offset); offset += 4;
    buffer.writeFloatLE(0, offset); offset += 4;
    buffer.writeFloatLE(0, offset); offset += 4;
    buffer.writeFloatLE(0, offset); offset += 4;

    // Bone index (optional)
    if (boneMap) {
      const bone = boneMap.get(key) ?? 0;
      buffer.writeUInt8(bone, offset);
      offset += 1;
    }
  }

  return buffer;
}
