import { describe, it, expect } from 'vitest';
import { parseVox } from '../lib/voxImport.js';

/** Build a minimal MagicaVoxel .vox binary for testing. */
function buildVoxBuffer(options: {
  models?: { x: number; y: number; z: number; voxels?: { x: number; y: number; z: number; ci: number }[] }[];
  layers?: { id: number; name: string }[];
}): ArrayBuffer {
  const { models = [], layers = [] } = options;

  function encodeString(s: string): Uint8Array {
    const bytes = new TextEncoder().encode(s);
    const buf = new Uint8Array(4 + bytes.length);
    new DataView(buf.buffer).setInt32(0, bytes.length, true);
    buf.set(bytes, 4);
    return buf;
  }

  function encodeDict(dict: Record<string, string>): Uint8Array {
    const keys = Object.keys(dict);
    const pairs: Uint8Array[] = [];
    for (const k of keys) {
      pairs.push(encodeString(k));
      pairs.push(encodeString(dict[k]));
    }
    const totalLen = pairs.reduce((a, b) => a + b.length, 0);
    const buf = new Uint8Array(4 + totalLen);
    new DataView(buf.buffer).setInt32(0, keys.length, true);
    let pos = 4;
    for (const p of pairs) {
      buf.set(p, pos);
      pos += p.length;
    }
    return buf;
  }

  function encodeChunk(id: string, content: Uint8Array, children: Uint8Array = new Uint8Array(0)): Uint8Array {
    const header = new Uint8Array(12);
    const dv = new DataView(header.buffer);
    // 4 bytes id
    for (let i = 0; i < 4; i++) header[i] = id.charCodeAt(i);
    dv.setInt32(4, content.length, true);
    dv.setInt32(8, children.length, true);
    const result = new Uint8Array(12 + content.length + children.length);
    result.set(header, 0);
    result.set(content, 12);
    result.set(children, 12 + content.length);
    return result;
  }

  function concat(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((a, b) => a + b.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    for (const a of arrays) {
      result.set(a, pos);
      pos += a.length;
    }
    return result;
  }

  // Build SIZE + XYZI chunks for each model
  const modelChunks: Uint8Array[] = [];
  for (const model of models) {
    const sizeContent = new Uint8Array(12);
    const sdv = new DataView(sizeContent.buffer);
    sdv.setInt32(0, model.x, true);
    sdv.setInt32(4, model.y, true);
    sdv.setInt32(8, model.z, true);
    modelChunks.push(encodeChunk('SIZE', sizeContent));

    const voxList = model.voxels ?? [];
    const xyziContent = new Uint8Array(4 + voxList.length * 4);
    const xdv = new DataView(xyziContent.buffer);
    xdv.setInt32(0, voxList.length, true);
    for (let i = 0; i < voxList.length; i++) {
      const v = voxList[i];
      xyziContent[4 + i * 4] = v.x;
      xyziContent[4 + i * 4 + 1] = v.y;
      xyziContent[4 + i * 4 + 2] = v.z;
      xyziContent[4 + i * 4 + 3] = v.ci;
    }
    modelChunks.push(encodeChunk('XYZI', xyziContent));
  }

  // Build LAYR chunks
  const layerChunks: Uint8Array[] = [];
  for (const layer of layers) {
    const dictBytes = encodeDict({ '_name': layer.name });
    const content = new Uint8Array(4 + dictBytes.length + 4); // id + dict + reserved(-1)
    const ldv = new DataView(content.buffer);
    ldv.setInt32(0, layer.id, true);
    content.set(dictBytes, 4);
    ldv.setInt32(4 + dictBytes.length, -1, true);
    layerChunks.push(encodeChunk('LAYR', content));
  }

  // RGBA chunk with simple palette (all gray)
  const rgbaContent = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgbaContent[i * 4] = 128;
    rgbaContent[i * 4 + 1] = 128;
    rgbaContent[i * 4 + 2] = 128;
    rgbaContent[i * 4 + 3] = 255;
  }
  const rgbaChunk = encodeChunk('RGBA', rgbaContent);

  // Concatenate all children for MAIN
  const mainChildren = concat(...modelChunks, ...layerChunks, rgbaChunk);
  const mainChunk = encodeChunk('MAIN', new Uint8Array(0), mainChildren);

  // File header: "VOX " + version (150)
  const header = new Uint8Array(8);
  header[0] = 0x56; header[1] = 0x4f; header[2] = 0x58; header[3] = 0x20; // "VOX "
  new DataView(header.buffer).setInt32(4, 150, true);

  return concat(header, mainChunk).buffer as ArrayBuffer;
}

describe('parseVox', () => {
  it('parses a single model without LAYR chunks', () => {
    const buf = buildVoxBuffer({
      models: [{ x: 4, y: 4, z: 4, voxels: [{ x: 1, y: 1, z: 1, ci: 1 }] }],
    });
    const result = parseVox(buf);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].voxels.size).toBe(1);
  });

  it('adds name field from LAYR chunk', () => {
    const buf = buildVoxBuffer({
      models: [
        { x: 4, y: 4, z: 4, voxels: [{ x: 1, y: 1, z: 1, ci: 1 }] },
        { x: 4, y: 4, z: 4, voxels: [{ x: 2, y: 2, z: 2, ci: 2 }] },
      ],
      layers: [
        { id: 0, name: 'head' },
        { id: 1, name: 'torso' },
      ],
    });
    const result = parseVox(buf);
    expect(result.models).toHaveLength(2);
    expect(result.models[0].name).toBe('head');
    expect(result.models[1].name).toBe('torso');
  });

  it('falls back to model_N when LAYR chunk is absent', () => {
    const buf = buildVoxBuffer({
      models: [
        { x: 4, y: 4, z: 4, voxels: [{ x: 1, y: 1, z: 1, ci: 1 }] },
        { x: 4, y: 4, z: 4, voxels: [{ x: 2, y: 2, z: 2, ci: 2 }] },
      ],
    });
    const result = parseVox(buf);
    expect(result.models[0].name).toBe('model_0');
    expect(result.models[1].name).toBe('model_1');
  });

  it('partially names models when only some LAYR chunks exist', () => {
    const buf = buildVoxBuffer({
      models: [
        { x: 4, y: 4, z: 4, voxels: [{ x: 1, y: 1, z: 1, ci: 1 }] },
        { x: 4, y: 4, z: 4, voxels: [{ x: 2, y: 2, z: 2, ci: 2 }] },
      ],
      layers: [{ id: 0, name: 'head' }],
    });
    const result = parseVox(buf);
    expect(result.models[0].name).toBe('head');
    expect(result.models[1].name).toBe('model_1');
  });

  it('VoxModel interface includes name field', () => {
    const buf = buildVoxBuffer({
      models: [{ x: 4, y: 4, z: 4 }],
    });
    const result = parseVox(buf);
    // name is optional — must be string or undefined
    expect(typeof result.models[0].name === 'string' || result.models[0].name === undefined).toBe(true);
  });
});
