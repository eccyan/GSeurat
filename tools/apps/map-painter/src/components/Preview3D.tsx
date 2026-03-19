import React, { useRef, useEffect, useCallback } from 'react';
import { useMapStore, type Layer } from '../store/useMapStore.js';

/**
 * Simple isometric preview of the voxel map.
 * Draws colored cubes for each pixel with height > 0.
 * Downsamples large maps to keep the preview responsive.
 */
export const Preview3D: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const width = useMapStore(s => s.width);
  const height = useMapStore(s => s.height);
  const layers = useMapStore(s => s.layers);
  const heights = useMapStore(s => s.heights);

  const cameraAngle = useRef(0);
  const cameraElevation = useRef(35);
  const cameraZoom = useRef(1.0);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, cw, ch);

    const angle = (cameraAngle.current * Math.PI) / 180;
    const elev = (cameraElevation.current * Math.PI) / 180;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const cosE = Math.cos(elev);
    const sinE = Math.sin(elev);

    // Downsample large maps to keep preview fast (max ~64 cells per axis)
    const maxPreviewDim = 64;
    const step = Math.max(1, Math.ceil(Math.max(width, height) / maxPreviewDim));
    const sampledW = Math.ceil(width / step);
    const sampledH = Math.ceil(height / step);

    const scale = Math.min(cw, ch) / Math.max(sampledW, sampledH) * 0.4 * cameraZoom.current;
    const cx = cw / 2;
    const cy = ch / 2;

    // Project 3D to 2D isometric
    const project = (x: number, y: number, z: number): [number, number] => {
      const rx = x * cosA - z * sinA;
      const rz = x * sinA + z * cosA;
      const ry2 = y * cosE - rz * sinE;
      return [cx + rx * scale, cy - ry2 * scale];
    };

    // Collect and depth-sort all visible voxels
    type Voxel = { x: number; y: number; z: number; r: number; g: number; b: number; depth: number };
    const voxels: Voxel[] = [];

    const layerOrder: Layer[] = ['ground', 'walls', 'decorations'];
    for (const layer of layerOrder) {
      const data = layers[layer];
      for (let gy = 0; gy < height; gy += step) {
        for (let gx = 0; gx < width; gx += step) {
          const pixIdx = (gy * width + gx) * 4;
          if (data[pixIdx + 3] === 0) continue;

          const h = heights[gy * width + gx];
          const maxY = Math.max(1, Math.ceil(h));

          // Sampled grid position (map on XY plane, height toward camera on +Z)
          const sx = gx / step - sampledW / 2;
          const sy = sampledH / 2 - gy / step;  // flip so canvas top = +Y

          for (let yi = 0; yi < maxY; yi++) {
            const depth = sx * sinA + yi * cosA - sy * sinE;
            voxels.push({
              x: sx, y: sy, z: yi,
              r: data[pixIdx], g: data[pixIdx + 1], b: data[pixIdx + 2],
              depth,
            });
          }
        }
      }
    }

    // Sort back-to-front
    voxels.sort((a, b) => a.depth - b.depth);

    // Draw each voxel as an isometric cube (simplified: just top face)
    for (const v of voxels) {
      const [px, py] = project(v.x, v.y, v.z);
      const s = scale * 0.5;

      // Darken sides for depth effect
      const topColor = `rgb(${v.r},${v.g},${v.b})`;
      const sideColor = `rgb(${Math.floor(v.r * 0.7)},${Math.floor(v.g * 0.7)},${Math.floor(v.b * 0.7)})`;

      // Top face
      ctx.fillStyle = topColor;
      ctx.fillRect(px - s * 0.5, py - s * 0.5, s, s);

      // Right edge (simulated)
      ctx.fillStyle = sideColor;
      ctx.fillRect(px + s * 0.3, py - s * 0.3, s * 0.2, s * 0.6);

      // Bottom edge (simulated)
      ctx.fillRect(px - s * 0.3, py + s * 0.3, s * 0.6, s * 0.2);
    }

    // Labels
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    const info = step > 1
      ? `Voxels: ${voxels.length} (${step}x downsample)`
      : `Voxels: ${voxels.length}`;
    ctx.fillText(info, 8, ch - 8);
  }, [width, height, layers, heights]);

  useEffect(() => {
    render();
  }, [render]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    cameraAngle.current += dx * 0.5;
    cameraElevation.current = Math.max(10, Math.min(80, cameraElevation.current + dy * 0.5));
    lastMouse.current = { x: e.clientX, y: e.clientY };
    render();
  }, [render]);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    cameraZoom.current = Math.max(0.2, Math.min(5.0, cameraZoom.current * factor));
    render();
  }, [render]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid #333' }}>
      <div style={{ fontSize: '11px', color: '#888', padding: '4px 8px', background: '#16213e' }}>
        3D Preview (drag to orbit)
      </div>
      <canvas
        ref={canvasRef}
        width={300}
        height={250}
        style={{ background: '#0a0a1a', cursor: 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      />
    </div>
  );
};
