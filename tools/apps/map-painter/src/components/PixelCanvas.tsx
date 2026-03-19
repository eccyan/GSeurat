import React, { useRef, useEffect, useCallback } from 'react';
import { useMapStore, type Layer } from '../store/useMapStore.js';

const LAYER_ORDER: Layer[] = ['ground', 'walls', 'decorations'];

/** Bresenham line: returns all cells between (x0,y0) and (x1,y1). */
function lineCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const cells: [number, number][] = [];
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  for (;;) {
    cells.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
  return cells;
}

/** All cells inside the rectangle defined by two corners. */
function rectCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const cells: [number, number][] = [];
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      cells.push([x, y]);
    }
  }
  return cells;
}

/** Expand cells by brush radius (filled circle stamp). Returns unique cells. */
function expandByBrush(
  cells: [number, number][],
  brushSize: number,
  mapWidth: number,
  mapHeight: number,
): [number, number][] {
  if (brushSize <= 1) return cells;
  const r = Math.floor(brushSize / 2);
  const seen = new Set<number>();
  const result: [number, number][] = [];
  for (const [cx, cy] of cells) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Circle check: only include cells within radius
        if (dx * dx + dy * dy > r * r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) continue;
        const key = ny * mapWidth + nx;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push([nx, ny]);
      }
    }
  }
  return result;
}

export const PixelCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPainting = useRef(false);
  const lastCell = useRef<[number, number] | null>(null);
  const dragStart = useRef<[number, number] | null>(null);
  const dragEnd = useRef<[number, number] | null>(null);

  const width = useMapStore(s => s.width);
  const height = useMapStore(s => s.height);
  const layers = useMapStore(s => s.layers);
  const heights = useMapStore(s => s.heights);
  const activeTool = useMapStore(s => s.activeTool);
  const activeColor = useMapStore(s => s.activeColor);
  const heightBrushValue = useMapStore(s => s.heightBrushValue);
  const brushSize = useMapStore(s => s.brushSize);
  const zoom = useMapStore(s => s.zoom);
  const panX = useMapStore(s => s.panX);
  const panY = useMapStore(s => s.panY);
  const collisionGrid = useMapStore(s => s.collisionGrid);
  const showCollision = useMapStore(s => s.showCollision);
  const showHeight = useMapStore(s => s.showHeight);

  const setPixel = useMapStore(s => s.setPixel);
  const erasePixel = useMapStore(s => s.erasePixel);
  const fillArea = useMapStore(s => s.fillArea);
  const setHeight = useMapStore(s => s.setHeight);
  const toggleCollision = useMapStore(s => s.toggleCollision);
  const setZoom = useMapStore(s => s.setZoom);
  const setPan = useMapStore(s => s.setPan);
  const pushUndo = useMapStore(s => s.pushUndo);

  const isDragTool = activeTool === 'line' || activeTool === 'rectangle';

  // Render the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = '#111122';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw / 2 + panX, ch / 2 + panY);

    // Draw grid and pixels
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = (x - width / 2) * zoom;
        const py = (y - height / 2) * zoom;

        // Checkerboard background
        ctx.fillStyle = (x + y) % 2 === 0 ? '#222233' : '#1a1a2e';
        ctx.fillRect(px, py, zoom, zoom);

        // Draw layers bottom-to-top
        for (const layer of LAYER_ORDER) {
          const data = layers[layer];
          const idx = (y * width + x) * 4;
          const a = data[idx + 3];
          if (a === 0) continue;
          ctx.fillStyle = `rgba(${data[idx]},${data[idx + 1]},${data[idx + 2]},${a / 255})`;
          ctx.fillRect(px, py, zoom, zoom);
        }

        // Height visualization: color-coded overlay (green→yellow→red)
        const h = heights[y * width + x];
        if (showHeight && h > 0) {
          const t = Math.min(h / 16, 1); // 0..1 across full range
          // Green(low) → Yellow(mid) → Red(high)
          const hr = Math.min(1, t * 2);
          const hg = Math.min(1, 2 - t * 2);
          ctx.fillStyle = `rgba(${Math.round(hr * 255)},${Math.round(hg * 200)},0,0.45)`;
          ctx.fillRect(px, py, zoom, zoom);
          // Height number (show at zoom >= 6 for better readability)
          if (zoom >= 6) {
            ctx.fillStyle = '#fff';
            ctx.font = `${Math.max(7, zoom * 0.4)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(h.toFixed(0), px + zoom / 2, py + zoom / 2);
          }
        }

        // Collision overlay
        if (showCollision && collisionGrid[y * width + x]) {
          ctx.fillStyle = 'rgba(255,0,0,0.3)';
          ctx.fillRect(px, py, zoom, zoom);
          ctx.strokeStyle = 'rgba(255,0,0,0.6)';
          ctx.strokeRect(px + 0.5, py + 0.5, zoom - 1, zoom - 1);
        }
      }
    }

    // Grid lines
    if (zoom >= 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= width; x++) {
        const px = (x - width / 2) * zoom;
        ctx.beginPath();
        ctx.moveTo(px, -height / 2 * zoom);
        ctx.lineTo(px, height / 2 * zoom);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y++) {
        const py = (y - height / 2) * zoom;
        ctx.beginPath();
        ctx.moveTo(-width / 2 * zoom, py);
        ctx.lineTo(width / 2 * zoom, py);
        ctx.stroke();
      }
    }

    // Draw drag preview for line/rectangle tools
    if (dragStart.current && dragEnd.current) {
      const [r, g, b, a] = activeColor;
      const previewColor = `rgba(${r},${g},${b},${(a / 255) * 0.6})`;
      const baseCells = activeTool === 'line'
        ? lineCells(dragStart.current[0], dragStart.current[1], dragEnd.current[0], dragEnd.current[1])
        : rectCells(dragStart.current[0], dragStart.current[1], dragEnd.current[0], dragEnd.current[1]);
      const cells = expandByBrush(baseCells, brushSize, width, height);

      ctx.fillStyle = previewColor;
      for (const [cx, cy] of cells) {
        const px = (cx - width / 2) * zoom;
        const py = (cy - height / 2) * zoom;
        ctx.fillRect(px, py, zoom, zoom);
      }
    }

    ctx.restore();
  }, [width, height, layers, heights, zoom, panX, panY, collisionGrid, showCollision, showHeight,
      activeColor, activeTool, brushSize]);

  // Convert mouse position to grid cell
  const mouseToCell = useCallback((e: React.MouseEvent): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - canvas.width / 2 - panX;
    const my = e.clientY - rect.top - canvas.height / 2 - panY;
    const x = Math.floor(mx / zoom + width / 2);
    const y = Math.floor(my / zoom + height / 2);
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    return [x, y];
  }, [width, height, zoom, panX, panY]);

  /** Apply the current tool at (x,y) with brush size expansion. */
  const applyTool = useCallback((x: number, y: number) => {
    const [r, g, b, a] = activeColor;
    const cells = expandByBrush([[x, y]], brushSize, width, height);

    switch (activeTool) {
      case 'pencil':
        for (const [cx, cy] of cells) setPixel(cx, cy, r, g, b, a);
        break;
      case 'eraser':
        for (const [cx, cy] of cells) erasePixel(cx, cy);
        break;
      case 'fill':
        // Fill ignores brush size — it flood-fills from the clicked cell
        fillArea(x, y, r, g, b, a);
        break;
      case 'height':
        for (const [cx, cy] of cells) setHeight(cx, cy, heightBrushValue);
        break;
      case 'select':
        for (const [cx, cy] of cells) toggleCollision(cx, cy);
        break;
    }
  }, [activeTool, activeColor, brushSize, width, height, heightBrushValue,
      setPixel, erasePixel, fillArea, setHeight, toggleCollision]);

  /** Commit line or rectangle: apply color to all cells with brush expansion. */
  const commitDragShape = useCallback(() => {
    if (!dragStart.current || !dragEnd.current) return;
    const [r, g, b, a] = activeColor;
    const baseCells = activeTool === 'line'
      ? lineCells(dragStart.current[0], dragStart.current[1], dragEnd.current[0], dragEnd.current[1])
      : rectCells(dragStart.current[0], dragStart.current[1], dragEnd.current[0], dragEnd.current[1]);
    const cells = expandByBrush(baseCells, brushSize, width, height);

    for (const [cx, cy] of cells) {
      setPixel(cx, cy, r, g, b, a);
    }
  }, [activeTool, activeColor, brushSize, width, height, setPixel]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) return; // Middle button for pan
    const cell = mouseToCell(e);
    if (!cell) return;
    pushUndo();

    if (isDragTool) {
      dragStart.current = cell;
      dragEnd.current = cell;
      isPainting.current = true;
    } else {
      isPainting.current = true;
      lastCell.current = cell;
      applyTool(cell[0], cell[1]);
    }
  }, [mouseToCell, applyTool, pushUndo, isDragTool]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPainting.current) return;
    const cell = mouseToCell(e);
    if (!cell) return;

    if (isDragTool) {
      dragEnd.current = cell;
      // Force re-render for preview
      useMapStore.setState({});
    } else {
      if (lastCell.current && cell[0] === lastCell.current[0] && cell[1] === lastCell.current[1]) return;
      lastCell.current = cell;
      applyTool(cell[0], cell[1]);
    }
  }, [mouseToCell, applyTool, isDragTool]);

  const onMouseUp = useCallback(() => {
    if (isDragTool && dragStart.current && dragEnd.current) {
      commitDragShape();
      dragStart.current = null;
      dragEnd.current = null;
    }
    isPainting.current = false;
    lastCell.current = null;
  }, [isDragTool, commitDragShape]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 2 : -2));
    } else {
      setPan(panX - e.deltaX, panY - e.deltaY);
    }
  }, [zoom, panX, panY, setZoom, setPan]);

  return (
    <canvas
      ref={canvasRef}
      width={1024}
      height={768}
      style={{ cursor: 'crosshair', display: 'block', width: '100%', height: '100%' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    />
  );
};
