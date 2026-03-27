/**
 * Load a binary PLY file into an array of point data.
 * Supports the GSeurat PLY format (position + SH color + opacity + scale).
 */

export interface PlyPoint {
  position: [number, number, number];
  color: [number, number, number];
}

export async function loadPly(file: File): Promise<PlyPoint[]> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Parse header (ASCII) — find end_header line and split into lines
  const decoder = new TextDecoder();
  let headerEnd = 0;
  let lineStart = 0;
  for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
    if (bytes[i] === 0x0a) { // newline
      const line = decoder.decode(bytes.slice(lineStart, i)).trim();
      lineStart = i + 1;
      if (line === 'end_header') {
        headerEnd = i + 1;
        break;
      }
    }
  }

  if (headerEnd === 0) { console.warn('[PLY] No header found'); return []; }

  const headerText = decoder.decode(bytes.slice(0, headerEnd));
  const lines = headerText.split('\n').map((l) => l.trim());

  // Find vertex count
  let vertexCount = 0;
  const properties: string[] = [];
  let inVertex = false;

  for (const line of lines) {
    if (line.startsWith('element vertex')) {
      vertexCount = parseInt(line.split(' ')[2], 10);
      inVertex = true;
    } else if (line.startsWith('element ') && inVertex) {
      inVertex = false;
    } else if (line.startsWith('property') && inVertex) {
      const parts = line.split(' ');
      properties.push(parts[parts.length - 1]);
    }
  }

  if (vertexCount === 0) { console.warn('[PLY] vertexCount=0'); return []; }
  console.log(`[PLY] vertexCount=${vertexCount}, properties=[${properties.join(',')}]`);

  // Find property indices
  const xi = properties.indexOf('x');
  const yi = properties.indexOf('y');
  const zi = properties.indexOf('z');
  // SH DC coefficients (color)
  const f0i = properties.indexOf('f_dc_0');
  const f1i = properties.indexOf('f_dc_1');
  const f2i = properties.indexOf('f_dc_2');
  // Fallback: red/green/blue
  const ri = properties.indexOf('red');
  const gi = properties.indexOf('green');
  const bi = properties.indexOf('blue');

  if (xi < 0 || yi < 0 || zi < 0) { console.warn(`[PLY] Missing xyz: xi=${xi} yi=${yi} zi=${zi}`); return []; }
  console.log(`[PLY] f_dc indices: ${f0i},${f1i},${f2i}  rgb indices: ${ri},${gi},${bi}`);

  // Calculate stride and property offsets
  let stride = 0;
  let inVertexCalc = false;
  const propOffsets: number[] = [];
  const propSizes: number[] = [];
  for (const line of lines) {
    if (line.startsWith('element vertex')) { inVertexCalc = true; continue; }
    if (line.startsWith('element ') && inVertexCalc) { inVertexCalc = false; continue; }
    if (!line.startsWith('property') || !inVertexCalc) continue;
    propOffsets.push(stride);
    if (line.includes('uchar') || line.includes('uint8')) {
      propSizes.push(1);
      stride += 1;
    } else {
      propSizes.push(4);
      stride += 4;
    }
  }

  console.log(`[PLY] stride=${stride}, propOffsets=[${propOffsets.join(',')}], headerEnd=${headerEnd}, dataBytes=${buffer.byteLength - headerEnd}`);
  const dataView = new DataView(buffer, headerEnd);
  const points: PlyPoint[] = [];

  // SH DC to RGB: color = 0.5 + 0.2820948 * sh_dc
  const shToRgb = (v: number) => Math.max(0, Math.min(1, 0.5 + 0.2820948 * v));

  for (let i = 0; i < vertexCount; i++) {
    const base = i * stride;
    if (base + stride > dataView.byteLength) break;

    const x = dataView.getFloat32(base + propOffsets[xi], true);
    const y = dataView.getFloat32(base + propOffsets[yi], true);
    const z = dataView.getFloat32(base + propOffsets[zi], true);

    let r = 0.5, g = 0.5, b = 0.5;
    if (f0i >= 0 && f1i >= 0 && f2i >= 0) {
      r = shToRgb(dataView.getFloat32(base + propOffsets[f0i], true));
      g = shToRgb(dataView.getFloat32(base + propOffsets[f1i], true));
      b = shToRgb(dataView.getFloat32(base + propOffsets[f2i], true));
    } else if (ri >= 0 && gi >= 0 && bi >= 0) {
      if (propSizes[ri] === 1) {
        r = dataView.getUint8(base + propOffsets[ri]) / 255;
        g = dataView.getUint8(base + propOffsets[gi]) / 255;
        b = dataView.getUint8(base + propOffsets[bi]) / 255;
      } else {
        r = dataView.getFloat32(base + propOffsets[ri], true);
        g = dataView.getFloat32(base + propOffsets[gi], true);
        b = dataView.getFloat32(base + propOffsets[bi], true);
      }
    }

    points.push({ position: [x, y, z], color: [r, g, b] });
  }

  return points;
}
