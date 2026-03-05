import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore.js';

// ---------------------------------------------------------------------------
// Tile color mapping (matching engine tileset)
// ---------------------------------------------------------------------------
const TILE_COLORS: Record<number, string> = {
  0: '#C8B991',   // beige floor
  1: '#463C37',   // dark wall
  2: '#285AB4',   // water blue 1
  3: '#376EC8',   // water blue 2
  4: '#4682D2',   // water blue 3
  5: '#C83C14',   // lava red
  6: '#F06414',   // lava orange
  7: '#FFA028',   // lava yellow
  8: '#3C322D',   // torch dark
  9: '#504128',   // torch glow
};

const TRANSPARENT_ID = 0xFFFF;

function getTileColor(id: number): string | null {
  if (id === TRANSPARENT_ID) return null;
  return TILE_COLORS[id] ?? '#888888';
}

// ---------------------------------------------------------------------------
// World-to-screen transform helpers
// ---------------------------------------------------------------------------
function worldToScreen(
  wx: number, wy: number,
  viewportX: number, viewportY: number,
  zoom: number,
  canvasW: number, canvasH: number,
): [number, number] {
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const sx = cx + (wx - viewportX) * zoom;
  const sy = cy + (wy - viewportY) * zoom;
  return [sx, sy];
}

function screenToWorld(
  sx: number, sy: number,
  viewportX: number, viewportY: number,
  zoom: number,
  canvasW: number, canvasH: number,
): [number, number] {
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const wx = (sx - cx) / zoom + viewportX;
  const wy = (sy - cy) / zoom + viewportY;
  return [wx, wy];
}

// ---------------------------------------------------------------------------
// TileCanvas
// ---------------------------------------------------------------------------
export function TileCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isPainting = useRef(false);

  // Track hover position in tile coordinates
  const [hoverTile, setHoverTile] = useState<[number, number] | null>(null);

  // Panning state
  const panStart = useRef<{ mx: number; my: number; vx: number; vy: number } | null>(null);

  const store = useEditorStore();

  // Flood-fill using store state
  const floodFill = useCallback(
    (startCol: number, startRow: number, newId: number, newSolid: boolean) => {
      const { tiles, width, height, setTiles } = useEditorStore.getState();
      const targetId = tiles[startRow * width + startCol]?.id;
      if (targetId === newId) return;

      const visited = new Uint8Array(width * height);
      const stack: [number, number][] = [[startCol, startRow]];
      const next = tiles.slice();

      while (stack.length > 0) {
        const [c, r] = stack.pop()!;
        if (c < 0 || c >= width || r < 0 || r >= height) continue;
        const idx = r * width + c;
        if (visited[idx]) continue;
        if (next[idx].id !== targetId) continue;
        visited[idx] = 1;
        next[idx] = { id: newId, solid: newSolid };
        stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
      }

      setTiles(next, width, height);
    },
    [],
  );

  // Convert mouse event to tile coords
  const getTileFromEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): [number, number] | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { viewportX, viewportY, zoom, width, height, tileSize } = useEditorStore.getState();
      const [wx, wy] = screenToWorld(px, py, viewportX, viewportY, zoom, canvas.width, canvas.height);

      // Tile grid origin: centered at world (0,0), tiles are tileSize units
      // Column/row from world position
      const halfW = (width * tileSize) / 2;
      const halfH = (height * tileSize) / 2;
      const col = Math.floor((wx + halfW) / tileSize);
      const row = Math.floor((wy + halfH) / tileSize);
      return [col, row];
    },
    [],
  );

  // Handle tile editing
  const applyTool = useCallback(
    (col: number, row: number) => {
      const {
        activeTool, activeLayer,
        selectedTileId, selectedSolid,
        setTile, pushHistory,
      } = useEditorStore.getState();

      if (activeLayer !== 'tiles') return;
      if (col < 0 || col >= store.width || row < 0 || row >= store.height) return;

      if (activeTool === 'paint') {
        setTile(col, row, selectedTileId, selectedSolid);
      } else if (activeTool === 'erase') {
        setTile(col, row, 0, false);
      } else if (activeTool === 'fill') {
        pushHistory();
        floodFill(col, row, selectedTileId, selectedSolid);
      }
    },
    [store.width, store.height, floodFill],
  );

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      rafRef.current = requestAnimationFrame(render);

      // Resize canvas to container
      const container = containerRef.current;
      if (container) {
        const { clientWidth, clientHeight } = container;
        if (canvas.width !== clientWidth || canvas.height !== clientHeight) {
          canvas.width = clientWidth;
          canvas.height = clientHeight;
        }
      }

      const {
        tiles, width, height, tileSize,
        viewportX, viewportY, zoom,
        npcs, lights, portals,
        selectedEntity,
      } = useEditorStore.getState();

      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, W, H);

      const pixelSize = tileSize * zoom;
      const halfW = (width * tileSize) / 2;
      const halfH = (height * tileSize) / 2;

      // Grid origin in screen coords
      const [originSx, originSy] = worldToScreen(-halfW, -halfH, viewportX, viewportY, zoom, W, H);

      // Draw tiles
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          const idx = r * width + c;
          const tile = tiles[idx];
          const sx = originSx + c * pixelSize;
          const sy = originSy + r * pixelSize;

          const color = getTileColor(tile.id);
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(sx, sy, pixelSize, pixelSize);
          } else {
            // Checkerboard for transparent
            const dark = (c + r) % 2 === 0 ? '#2a2a2a' : '#333333';
            ctx.fillStyle = dark;
            ctx.fillRect(sx, sy, pixelSize, pixelSize);
          }

          // Solid indicator: small red triangle in corner
          if (tile.solid && pixelSize > 8) {
            ctx.fillStyle = 'rgba(255,80,80,0.6)';
            ctx.beginPath();
            ctx.moveTo(sx + pixelSize - 1, sy + 1);
            ctx.lineTo(sx + pixelSize - 1, sy + Math.min(8, pixelSize * 0.3));
            ctx.lineTo(sx + pixelSize - Math.min(8, pixelSize * 0.3), sy + 1);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      for (let c = 0; c <= width; c++) {
        const sx = originSx + c * pixelSize;
        ctx.beginPath();
        ctx.moveTo(sx, originSy);
        ctx.lineTo(sx, originSy + height * pixelSize);
        ctx.stroke();
      }
      for (let r = 0; r <= height; r++) {
        const sy = originSy + r * pixelSize;
        ctx.beginPath();
        ctx.moveTo(originSx, sy);
        ctx.lineTo(originSx + width * pixelSize, sy);
        ctx.stroke();
      }

      // Map border
      ctx.strokeStyle = 'rgba(100,150,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(originSx, originSy, width * pixelSize, height * pixelSize);

      // -----------------------------------------------------------------------
      // Portals
      // -----------------------------------------------------------------------
      portals.forEach((portal, idx) => {
        const [px, py] = portal.position;
        const [pw, ph] = portal.size;
        const [sx, sy] = worldToScreen(px - pw / 2, py - ph / 2, viewportX, viewportY, zoom, W, H);
        const isSelected = selectedEntity?.type === 'portal' && selectedEntity.index === idx;

        ctx.fillStyle = isSelected ? 'rgba(100,180,255,0.35)' : 'rgba(60,120,255,0.2)';
        ctx.fillRect(sx, sy, pw * zoom, ph * zoom);
        ctx.strokeStyle = isSelected ? '#64b4ff' : '#3c78ff';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(sx, sy, pw * zoom, ph * zoom);

        // Label
        if (pixelSize > 6) {
          ctx.fillStyle = '#90c8ff';
          ctx.font = `${Math.max(9, Math.min(13, zoom * 0.6))}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText('P', sx + pw * zoom / 2, sy + ph * zoom / 2 + 4);
        }
      });

      // -----------------------------------------------------------------------
      // Lights (radius circles)
      // -----------------------------------------------------------------------
      lights.forEach((light, idx) => {
        const [lx, ly] = light.position;
        const [sx, sy] = worldToScreen(lx, ly, viewportX, viewportY, zoom, W, H);
        const [r, g, b] = light.color;
        const colorStr = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        const isSelected = selectedEntity?.type === 'light' && selectedEntity.index === idx;
        const radiusPx = light.radius * zoom;

        // Glow circle
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radiusPx);
        grad.addColorStop(0, `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},0.2)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
        ctx.fill();

        // Outer ring
        ctx.strokeStyle = isSelected ? '#fff' : colorStr;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Center dot
        ctx.fillStyle = isSelected ? '#fff' : colorStr;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(3, zoom * 0.2), 0, Math.PI * 2);
        ctx.fill();
      });

      // -----------------------------------------------------------------------
      // NPCs (colored circles)
      // -----------------------------------------------------------------------
      npcs.forEach((npc, idx) => {
        const [nx, , ny] = npc.position;  // position is [x, y, z] in engine; z is depth, use x/z for 2D
        // Actually position is [x, y, z] where y=height — use x and z for top-down
        // But store has position: [number, number, number] matching engine [x, y, z]
        // In the tilemap editor, we treat x/z as the 2D plane (x=col, z=row)
        const wx = npc.position[0];
        const wy = npc.position[2];
        const [sx, sy] = worldToScreen(wx, wy, viewportX, viewportY, zoom, W, H);
        const [tr, tg, tb] = npc.tint;
        const colorStr = `rgb(${Math.round(tr * 255)},${Math.round(tg * 255)},${Math.round(tb * 255)})`;
        const isSelected = selectedEntity?.type === 'npc' && selectedEntity.index === idx;
        const dotR = Math.max(4, zoom * 0.3);

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(sx, sy + dotR * 0.4, dotR * 0.9, dotR * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();

        // Body circle
        ctx.fillStyle = colorStr;
        ctx.beginPath();
        ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
        ctx.fill();

        if (isSelected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, dotR + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Facing arrow
        const facingAngles: Record<string, number> = {
          north: -Math.PI / 2,
          south: Math.PI / 2,
          east: 0,
          west: Math.PI,
        };
        const angle = facingAngles[npc.facing] ?? 0;
        const arrowLen = dotR + 4;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(angle) * arrowLen, sy + Math.sin(angle) * arrowLen);
        ctx.stroke();

        // Name label
        if (zoom > 20) {
          ctx.fillStyle = '#fff';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(npc.name, sx, sy - dotR - 4);
        }
      });

      // -----------------------------------------------------------------------
      // Hover highlight
      // -----------------------------------------------------------------------
      if (hoverTile) {
        const [hc, hr] = hoverTile;
        if (hc >= 0 && hc < width && hr >= 0 && hr < height) {
          const hsx = originSx + hc * pixelSize;
          const hsy = originSy + hr * pixelSize;
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(hsx, hsy, pixelSize, pixelSize);
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1;
          ctx.strokeRect(hsx, hsy, pixelSize, pixelSize);
        }
      }
    };

    render();
    return () => cancelAnimationFrame(rafRef.current);
    // hoverTile is intentionally listed; other deps come from the store
  }, [hoverTile]);

  // -------------------------------------------------------------------------
  // Mouse event handlers
  // -------------------------------------------------------------------------
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { activeTool, activeLayer } = useEditorStore.getState();

      // Middle button or space+left: start panning
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        const { viewportX, viewportY } = useEditorStore.getState();
        panStart.current = { mx: e.clientX, my: e.clientY, vx: viewportX, vy: viewportY };
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      if (activeLayer !== 'tiles') {
        // Entity placement / selection in other layers would be handled here
        return;
      }

      if (activeTool === 'select') return;

      const tile = getTileFromEvent(e);
      if (!tile) return;

      useEditorStore.getState().pushHistory();
      isPainting.current = true;
      applyTool(tile[0], tile[1]);
    },
    [getTileFromEvent, applyTool],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Pan
      if (panStart.current) {
        const dx = (e.clientX - panStart.current.mx) / useEditorStore.getState().zoom;
        const dy = (e.clientY - panStart.current.my) / useEditorStore.getState().zoom;
        useEditorStore.getState().setViewport(
          panStart.current.vx - dx,
          panStart.current.vy - dy,
        );
        return;
      }

      const tile = getTileFromEvent(e);
      setHoverTile(tile);

      if (isPainting.current && tile) {
        const { activeTool } = useEditorStore.getState();
        if (activeTool === 'paint' || activeTool === 'erase') {
          applyTool(tile[0], tile[1]);
        }
      }
    },
    [getTileFromEvent, applyTool],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (panStart.current) {
        panStart.current = null;
        return;
      }
      isPainting.current = false;
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverTile(null);
    isPainting.current = false;
    panStart.current = null;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const { zoom, setZoom } = useEditorStore.getState();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const next = Math.max(4, Math.min(128, zoom * factor));
      setZoom(next);
    },
    [],
  );

  const getCursor = () => {
    const { activeTool, activeLayer } = store;
    if (activeLayer !== 'tiles') return 'default';
    switch (activeTool) {
      case 'paint': return 'crosshair';
      case 'erase': return 'cell';
      case 'fill':  return 'copy';
      case 'select': return 'pointer';
      default: return 'default';
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#1a1a1a' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', cursor: getCursor() }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />
      {/* Coordinate overlay */}
      {hoverTile && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          background: 'rgba(0,0,0,0.6)',
          color: '#aaa',
          fontFamily: 'monospace',
          fontSize: 11,
          padding: '2px 6px',
          borderRadius: 3,
          pointerEvents: 'none',
        }}>
          col {hoverTile[0]}, row {hoverTile[1]}
        </div>
      )}
      {/* Zoom indicator */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        right: 8,
        background: 'rgba(0,0,0,0.6)',
        color: '#888',
        fontFamily: 'monospace',
        fontSize: 11,
        padding: '2px 6px',
        borderRadius: 3,
        pointerEvents: 'none',
      }}>
        {Math.round(store.zoom)}px/tile
      </div>
    </div>
  );
}
