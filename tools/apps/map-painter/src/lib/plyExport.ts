import type { Layer } from '../store/useMapStore.js';

/**
 * Convert the map pixel/height data to a 3D Gaussian Splatting PLY file.
 *
 * Each colored pixel at height H creates a column of Gaussians from y=0 to y=H.
 * Each Gaussian is a tight, pixel-sized splat (scale=0.5, identity rotation, opacity=1).
 */
export function exportPly(
  width: number,
  height: number,
  layers: Record<Layer, Uint8Array>,
  heights: Float32Array,
): ArrayBuffer {
  // Collect all Gaussians from all layers
  const gaussians: {
    x: number; y: number; z: number;
    r: number; g: number; b: number;
  }[] = [];

  const layerOrder: Layer[] = ['ground', 'walls', 'decorations'];

  for (const layer of layerOrder) {
    const data = layers[layer];
    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const pixIdx = (gy * width + gx) * 4;
        const r = data[pixIdx];
        const g = data[pixIdx + 1];
        const b = data[pixIdx + 2];
        const a = data[pixIdx + 3];

        if (a === 0) continue; // Skip transparent pixels

        const h = heights[gy * width + gx];
        const maxY = Math.max(1, Math.ceil(h));

        // Create a column of Gaussians (map on XY plane, height toward camera on +Z)
        for (let yi = 0; yi < maxY; yi++) {
          gaussians.push({
            x: gx - width / 2,       // horizontal
            y: height / 2 - gy,      // vertical (flip so canvas top = +Y)
            z: yi,                   // height toward camera (+Z)
            r: r / 255,
            g: g / 255,
            b: b / 255,
          });
        }
      }
    }
  }

  return buildBinaryPly(gaussians);
}

/**
 * Build a binary little-endian PLY file from Gaussian data.
 * Uses standard 3DGS column naming for maximum compatibility.
 */
function buildBinaryPly(
  gaussians: { x: number; y: number; z: number; r: number; g: number; b: number }[],
): ArrayBuffer {
  const count = gaussians.length;

  // SH DC coefficient: color = SH_C0 * f_dc + 0.5 → f_dc = (color - 0.5) / SH_C0
  const SH_C0 = 0.28209479177387814;

  // Default scale (log space): log(0.5) ≈ -0.693
  const logScale = Math.log(0.5);

  // Build header
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${count}`,
    'property float x',
    'property float y',
    'property float z',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'property float opacity',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'end_header',
    '',
  ].join('\n');

  const headerBytes = new TextEncoder().encode(header);

  // 14 floats per vertex: x,y,z, f_dc_0,1,2, opacity, scale_0,1,2, rot_0,1,2,3
  const vertexSize = 14 * 4; // 56 bytes
  const totalSize = headerBytes.length + count * vertexSize;
  const buffer = new ArrayBuffer(totalSize);
  const uint8 = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Write header
  uint8.set(headerBytes, 0);

  // Write vertex data
  let offset = headerBytes.length;
  for (const g of gaussians) {
    // Position
    view.setFloat32(offset, g.x, true); offset += 4;
    view.setFloat32(offset, g.y, true); offset += 4;
    view.setFloat32(offset, g.z, true); offset += 4;

    // SH DC (convert linear RGB to SH space)
    view.setFloat32(offset, (g.r - 0.5) / SH_C0, true); offset += 4;
    view.setFloat32(offset, (g.g - 0.5) / SH_C0, true); offset += 4;
    view.setFloat32(offset, (g.b - 0.5) / SH_C0, true); offset += 4;

    // Opacity (logit space): logit(1.0) → large number, use ~5 for near-opaque
    view.setFloat32(offset, 5.0, true); offset += 4;

    // Scale (log space)
    view.setFloat32(offset, logScale, true); offset += 4;
    view.setFloat32(offset, logScale, true); offset += 4;
    view.setFloat32(offset, logScale, true); offset += 4;

    // Rotation (identity quaternion: w=1, x=0, y=0, z=0)
    view.setFloat32(offset, 1.0, true); offset += 4;
    view.setFloat32(offset, 0.0, true); offset += 4;
    view.setFloat32(offset, 0.0, true); offset += 4;
    view.setFloat32(offset, 0.0, true); offset += 4;
  }

  return buffer;
}

/**
 * Export collision grid as JSON for the scene file.
 */
export function exportCollision(
  width: number,
  height: number,
  collisionGrid: boolean[],
  cellSize = 1.0,
): object {
  return {
    width,
    height,
    cell_size: cellSize,
    solid: collisionGrid,
  };
}

/**
 * Build a complete scene JSON with gaussian_splat config.
 */
export function exportSceneJson(
  plyFileName: string,
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number },
  renderWidth: number,
  renderHeight: number,
  width: number,
  height: number,
  collisionGrid: boolean[],
): object {
  // Auto-derive parallax defaults from map dimensions
  const maxExtent = Math.max(width, height);
  const azimuthRange = Math.min(0.30, 0.15 + maxExtent / 1000);

  return {
    gaussian_splat: {
      ply_file: plyFileName,
      camera: {
        position: camera.position,
        target: camera.target,
        fov: camera.fov,
      },
      render_width: renderWidth,
      render_height: renderHeight,
      parallax: {
        azimuth_range: parseFloat(azimuthRange.toFixed(3)),
        elevation_min: -0.15,
        elevation_max: 0.15,
        distance_range: 0.10,
        parallax_strength: 1.0,
      },
    },
    collision: exportCollision(width, height, collisionGrid),
    ambient_color: [0.4, 0.42, 0.5, 1.0],
    static_lights: [],
    npcs: [],
    portals: [],
    player: {
      position: [0, 0, 0],
      tint: [1, 1, 1, 1],
      facing: 'down',
    },
  };
}
