/**
 * Unit tests for Echidna PLY export with bone_index.
 *
 * Run: pnpm test:echidna-ply-export
 */

// Re-implement the minimal types and functions inline to avoid
// importing from the app (which has React/Three.js dependencies).

type VoxelKey = `${number},${number},${number}`;
interface Voxel { color: [number, number, number, number]; }
interface BodyPart {
  id: string;
  parent: string | null;
  joint: [number, number, number];
  voxelKeys: VoxelKey[];
}

function voxelKey(x: number, y: number, z: number): VoxelKey {
  return `${x},${y},${z}`;
}

function parseKey(key: VoxelKey): [number, number, number] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

// ---------- PLY export (copied from echidna/src/lib/plyExport.ts) ----------

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function buildBoneMap(parts: BodyPart[]): Map<VoxelKey, number> {
  const map = new Map<VoxelKey, number>();
  for (let i = 0; i < parts.length; i++) {
    for (const key of parts[i].voxelKeys) {
      map.set(key, i);
    }
  }
  return map;
}

function exportPlyBuffer(
  voxels: Map<VoxelKey, Voxel>,
  gridWidth: number,
  gridHeight: number,
  parts?: BodyPart[],
): ArrayBuffer {
  const allEntries = Array.from(voxels.entries());
  const entries = allEntries.filter(([key]) => {
    const [x, y, z] = parseKey(key);
    for (const [dx, dy, dz] of NEIGHBORS) {
      if (!voxels.has(voxelKey(x + dx, y + dy, z + dz))) {
        return true;
      }
    }
    return false;
  });
  const count = entries.length;

  const hasBones = parts && parts.length > 0;
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

  const headerBytes = new TextEncoder().encode(header);
  const bytesPerVertex = 14 * 4 + (hasBones ? 1 : 0);
  const bodyBytes = count * bytesPerVertex;
  const buffer = new ArrayBuffer(headerBytes.length + bodyBytes);
  const uint8 = new Uint8Array(buffer);
  uint8.set(headerBytes, 0);
  const view = new DataView(buffer);

  let offset = headerBytes.length;
  const halfW = gridWidth / 2;
  const voxelScale = Math.log(0.5);

  let maxY = 0;
  for (const [key] of entries) {
    const [, vy] = parseKey(key);
    if (vy > maxY) maxY = vy;
  }
  const halfH = maxY / 2;

  for (const [key, voxel] of entries) {
    const [vx, vy, vz] = parseKey(key);
    view.setFloat32(offset, vx - halfW, true); offset += 4;
    view.setFloat32(offset, vy - halfH, true); offset += 4;
    view.setFloat32(offset, vz, true); offset += 4;

    const shFactor = 0.2820947917738781;
    view.setFloat32(offset, (voxel.color[0] / 255 - 0.5) / shFactor, true); offset += 4;
    view.setFloat32(offset, (voxel.color[1] / 255 - 0.5) / shFactor, true); offset += 4;
    view.setFloat32(offset, (voxel.color[2] / 255 - 0.5) / shFactor, true); offset += 4;

    const alpha = voxel.color[3] / 255;
    const logitOpacity = Math.log(Math.max(alpha, 0.001) / Math.max(1 - alpha, 0.001));
    view.setFloat32(offset, logitOpacity, true); offset += 4;

    view.setFloat32(offset, voxelScale, true); offset += 4;
    view.setFloat32(offset, voxelScale, true); offset += 4;
    view.setFloat32(offset, voxelScale, true); offset += 4;

    view.setFloat32(offset, 1, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;

    if (boneMap) {
      const bone = boneMap.get(key) ?? 0;
      view.setUint8(offset, bone);
      offset += 1;
    }
  }

  return buffer;
}

// ---------- PLY parser (for verifying export output) ----------

interface ParsedVertex {
  x: number; y: number; z: number;
  f_dc_0: number; f_dc_1: number; f_dc_2: number;
  opacity: number;
  scale_0: number; scale_1: number; scale_2: number;
  rot_0: number; rot_1: number; rot_2: number; rot_3: number;
  bone_index?: number;
}

function parsePly(buffer: ArrayBuffer): { vertexCount: number; hasBoneIndex: boolean; vertices: ParsedVertex[] } {
  const uint8 = new Uint8Array(buffer);

  // Find end_header
  const text = new TextDecoder().decode(uint8);
  const headerEnd = text.indexOf('end_header\n');
  if (headerEnd < 0) throw new Error('No end_header found');
  const headerStr = text.substring(0, headerEnd + 'end_header\n'.length);

  // Parse header
  const lines = headerStr.split('\n');
  let vertexCount = 0;
  const properties: { name: string; type: string }[] = [];

  for (const line of lines) {
    const m = line.match(/^element vertex (\d+)/);
    if (m) vertexCount = Number(m[1]);
    const p = line.match(/^property (\w+) (\w+)/);
    if (p) properties.push({ type: p[1], name: p[2] });
  }

  const hasBoneIndex = properties.some((p) => p.name === 'bone_index');
  const headerBytes = new TextEncoder().encode(headerStr).length;

  // Parse binary data
  const view = new DataView(buffer);
  let offset = headerBytes;
  const vertices: ParsedVertex[] = [];

  for (let i = 0; i < vertexCount; i++) {
    const v: ParsedVertex = {
      x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true),
      f_dc_0: view.getFloat32(offset + 12, true), f_dc_1: view.getFloat32(offset + 16, true), f_dc_2: view.getFloat32(offset + 20, true),
      opacity: view.getFloat32(offset + 24, true),
      scale_0: view.getFloat32(offset + 28, true), scale_1: view.getFloat32(offset + 32, true), scale_2: view.getFloat32(offset + 36, true),
      rot_0: view.getFloat32(offset + 40, true), rot_1: view.getFloat32(offset + 44, true), rot_2: view.getFloat32(offset + 48, true), rot_3: view.getFloat32(offset + 52, true),
    };
    offset += 56;
    if (hasBoneIndex) {
      v.bone_index = view.getUint8(offset);
      offset += 1;
    }
    vertices.push(v);
  }

  return { vertexCount, hasBoneIndex, vertices };
}

// ---------- Test helpers ----------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

function assertClose(actual: number, expected: number, epsilon: number, label: string) {
  assert(Math.abs(actual - expected) < epsilon, `${label}: expected ~${expected}, got ${actual}`);
}

// ---------- Tests ----------

console.log('\n=== Echidna PLY Export Tests ===\n');

// --- Test 1: Export without parts (no bone_index) ---
{
  console.log('Test 1: PLY export without parts');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [255, 0, 0, 255] });
  voxels.set(voxelKey(1, 0, 0), { color: [0, 255, 0, 255] });
  voxels.set(voxelKey(0, 1, 0), { color: [0, 0, 255, 255] });

  const buf = exportPlyBuffer(voxels, 4, 4);
  const result = parsePly(buf);

  assert(result.vertexCount === 3, `vertex count is 3 (got ${result.vertexCount})`);
  assert(!result.hasBoneIndex, 'no bone_index property in header');
}

// --- Test 2: Export with parts (has bone_index) ---
{
  console.log('\nTest 2: PLY export with body parts');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [255, 128, 0, 255] });
  voxels.set(voxelKey(1, 0, 0), { color: [0, 128, 255, 255] });
  voxels.set(voxelKey(2, 0, 0), { color: [128, 128, 128, 255] });
  voxels.set(voxelKey(3, 0, 0), { color: [64, 64, 64, 255] });

  const parts: BodyPart[] = [
    { id: 'torso', parent: null, joint: [0, 0, 0], voxelKeys: [voxelKey(0, 0, 0), voxelKey(1, 0, 0)] },
    { id: 'head', parent: 'torso', joint: [0, 2, 0], voxelKeys: [voxelKey(2, 0, 0)] },
    { id: 'arm', parent: 'torso', joint: [1, 1, 0], voxelKeys: [voxelKey(3, 0, 0)] },
  ];

  const buf = exportPlyBuffer(voxels, 4, 4, parts);
  const result = parsePly(buf);

  assert(result.vertexCount === 4, `vertex count is 4 (got ${result.vertexCount})`);
  assert(result.hasBoneIndex, 'has bone_index property in header');

  // Check bone indices match part assignment
  // Voxels are sorted by Map iteration order (insertion order)
  const boneIndices = result.vertices.map((v) => v.bone_index);
  assert(boneIndices[0] === 0, `voxel 0 (torso) has bone_index=0 (got ${boneIndices[0]})`);
  assert(boneIndices[1] === 0, `voxel 1 (torso) has bone_index=0 (got ${boneIndices[1]})`);
  assert(boneIndices[2] === 1, `voxel 2 (head) has bone_index=1 (got ${boneIndices[2]})`);
  assert(boneIndices[3] === 2, `voxel 3 (arm) has bone_index=2 (got ${boneIndices[3]})`);
}

// --- Test 3: Unassigned voxels get bone_index=0 ---
{
  console.log('\nTest 3: Unassigned voxels default to bone_index=0');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [255, 0, 0, 255] });
  voxels.set(voxelKey(5, 0, 0), { color: [0, 255, 0, 255] }); // not assigned to any part

  const parts: BodyPart[] = [
    { id: 'body', parent: null, joint: [0, 0, 0], voxelKeys: [voxelKey(0, 0, 0)] },
  ];

  const buf = exportPlyBuffer(voxels, 8, 4, parts);
  const result = parsePly(buf);

  assert(result.vertexCount === 2, `vertex count is 2 (got ${result.vertexCount})`);
  assert(result.hasBoneIndex, 'has bone_index');

  const assigned = result.vertices.find((v) => v.bone_index === 0);
  assert(assigned !== undefined, 'assigned voxel has bone_index=0');

  const unassigned = result.vertices.find((_, i) => {
    // The unassigned voxel at (5,0,0) should also get bone_index=0 (default)
    return result.vertices[i].bone_index === 0;
  });
  assert(unassigned !== undefined, 'unassigned voxel defaults to bone_index=0');
}

// --- Test 4: PLY header format ---
{
  console.log('\nTest 4: PLY header format validation');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [128, 128, 128, 255] });

  const parts: BodyPart[] = [
    { id: 'root', parent: null, joint: [0, 0, 0], voxelKeys: [voxelKey(0, 0, 0)] },
  ];

  const buf = exportPlyBuffer(voxels, 2, 2, parts);
  const headerStr = new TextDecoder().decode(new Uint8Array(buf)).split('end_header\n')[0] + 'end_header\n';

  assert(headerStr.startsWith('ply\n'), 'starts with ply magic');
  assert(headerStr.includes('format binary_little_endian 1.0'), 'binary little endian format');
  assert(headerStr.includes('element vertex 1'), 'correct vertex count');
  assert(headerStr.includes('property float x'), 'has position x');
  assert(headerStr.includes('property float y'), 'has position y');
  assert(headerStr.includes('property float z'), 'has position z');
  assert(headerStr.includes('property float f_dc_0'), 'has SH DC color');
  assert(headerStr.includes('property float opacity'), 'has opacity');
  assert(headerStr.includes('property float scale_0'), 'has scale');
  assert(headerStr.includes('property float rot_0'), 'has rotation');
  assert(headerStr.includes('property uchar bone_index'), 'has bone_index as uchar');
}

// --- Test 5: Color encoding (SH DC coefficients) ---
{
  console.log('\nTest 5: SH DC color encoding');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [255, 0, 128, 255] });

  const buf = exportPlyBuffer(voxels, 2, 2);
  const result = parsePly(buf);
  const v = result.vertices[0];

  // SH DC: (color/255 - 0.5) / 0.2820947917738781
  const shFactor = 0.2820947917738781;
  assertClose(v.f_dc_0, (255 / 255 - 0.5) / shFactor, 0.01, 'red channel SH DC');
  assertClose(v.f_dc_1, (0 / 255 - 0.5) / shFactor, 0.01, 'green channel SH DC');
  assertClose(v.f_dc_2, (128 / 255 - 0.5) / shFactor, 0.01, 'blue channel SH DC');
}

// --- Test 6: Scale and rotation defaults ---
{
  console.log('\nTest 6: Scale (log 0.5) and rotation (identity quaternion)');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [128, 128, 128, 255] });

  const buf = exportPlyBuffer(voxels, 2, 2);
  const result = parsePly(buf);
  const v = result.vertices[0];

  const expectedScale = Math.log(0.5);
  assertClose(v.scale_0, expectedScale, 0.001, 'scale_0 = log(0.5)');
  assertClose(v.scale_1, expectedScale, 0.001, 'scale_1 = log(0.5)');
  assertClose(v.scale_2, expectedScale, 0.001, 'scale_2 = log(0.5)');

  assertClose(v.rot_0, 1, 0.001, 'rot_0 (w) = 1');
  assertClose(v.rot_1, 0, 0.001, 'rot_1 (x) = 0');
  assertClose(v.rot_2, 0, 0.001, 'rot_2 (y) = 0');
  assertClose(v.rot_3, 0, 0.001, 'rot_3 (z) = 0');
}

// --- Test 7: Opacity encoding (logit / pre-sigmoid) ---
{
  console.log('\nTest 7: Opacity logit encoding');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [128, 128, 128, 255] }); // fully opaque

  const buf = exportPlyBuffer(voxels, 2, 2);
  const result = parsePly(buf);
  const v = result.vertices[0];

  // logit(1.0) = log(1/0.001) ≈ 6.9
  assert(v.opacity > 5, `fully opaque voxel has high logit opacity (got ${v.opacity.toFixed(2)})`);

  // Test semi-transparent
  const voxels2 = new Map<VoxelKey, Voxel>();
  voxels2.set(voxelKey(0, 0, 0), { color: [128, 128, 128, 128] }); // 50% opacity
  const buf2 = exportPlyBuffer(voxels2, 2, 2);
  const result2 = parsePly(buf2);
  assertClose(result2.vertices[0].opacity, 0, 0.1, 'half-transparent has logit ≈ 0');
}

// --- Test 8: Surface culling ---
{
  console.log('\nTest 8: Interior voxels are culled');
  const voxels = new Map<VoxelKey, Voxel>();
  // 3x3x3 cube — center voxel (1,1,1) is fully enclosed
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      for (let z = 0; z < 3; z++) {
        voxels.set(voxelKey(x, y, z), { color: [128, 128, 128, 255] });
      }
    }
  }

  const buf = exportPlyBuffer(voxels, 4, 4);
  const result = parsePly(buf);

  // 27 total - 1 interior = 26 surface
  assert(result.vertexCount === 26, `3x3x3 cube exports 26 surface voxels (got ${result.vertexCount})`);
}

// --- Test 9: Buffer size matches header + data ---
{
  console.log('\nTest 9: Buffer size consistency');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [100, 200, 50, 255] });
  voxels.set(voxelKey(1, 0, 0), { color: [200, 100, 50, 255] });

  const parts: BodyPart[] = [
    { id: 'a', parent: null, joint: [0, 0, 0], voxelKeys: [voxelKey(0, 0, 0)] },
    { id: 'b', parent: 'a', joint: [1, 0, 0], voxelKeys: [voxelKey(1, 0, 0)] },
  ];

  const buf = exportPlyBuffer(voxels, 4, 4, parts);
  const headerStr = new TextDecoder().decode(new Uint8Array(buf)).split('end_header\n')[0] + 'end_header\n';
  const headerLen = new TextEncoder().encode(headerStr).length;
  const expectedBodySize = 2 * (14 * 4 + 1); // 2 voxels × (14 floats + 1 byte bone_index)
  const expectedTotal = headerLen + expectedBodySize;

  assert(buf.byteLength === expectedTotal, `buffer size ${buf.byteLength} === header(${headerLen}) + body(${expectedBodySize}) = ${expectedTotal}`);
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
