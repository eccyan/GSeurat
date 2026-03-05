import { useState, useRef, useCallback } from 'react';
import { useEditorStore } from '../store/useEditorStore.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4.0;
/**
 * Zoom multiplier applied per wheel tick (one notch = 20% of current zoom).
 * Delta is negative when scrolling toward the user (zoom-out).
 */
const ZOOM_FACTOR = 0.001; // multiplied by event.deltaY magnitude

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TileCoord {
  col: number;
  row: number;
}

export interface CanvasInteractionHandlers {
  /** Attach to the <canvas> `onMouseDown` prop. */
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  /** Attach to the <canvas> `onMouseUp` prop. */
  onMouseUp: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  /** Attach to the <canvas> `onMouseMove` prop. */
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  /** Attach to the <canvas> `onWheel` prop. */
  onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  /** Attach to the <canvas> `onMouseLeave` prop. */
  onMouseLeave: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  /** Attach to the <canvas> `onContextMenu` prop. */
  onContextMenu: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  /** The tile currently under the cursor, or null when outside the grid. */
  hoveredTile: TileCoord | null;
}

// ---------------------------------------------------------------------------
// Internal state shared across event handlers (stored in a ref so that
// callbacks never become stale and never cause unnecessary re-renders).
// ---------------------------------------------------------------------------

interface DragState {
  /** Whether a middle-mouse pan is currently in progress. */
  panning: boolean;
  /** Whether a left-button paint stroke is currently in progress. */
  painting: boolean;
  /** Canvas pixel X where the pan started. */
  panStartX: number;
  /** Canvas pixel Y where the pan started. */
  panStartY: number;
  /** Viewport X offset at the start of the pan. */
  panStartVpX: number;
  /** Viewport Y offset at the start of the pan. */
  panStartVpY: number;
  /** Last painted tile during a drag — used to skip redundant engine calls. */
  lastPaintedTile: TileCoord | null;
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Convert a canvas-relative pixel position to tile grid coordinates.
 *
 * The canvas is assumed to render the tilemap with the following transform:
 *   canvasPixel = (worldPosition + viewport) * zoom * tilePixelSize
 *
 * where:
 *   worldPosition = (col * tileSize, row * tileSize)  (tile-size units)
 *   viewport      = (viewportX, viewportY)              (tile-size units)
 *   zoom          = pixels-per-tile-size
 *   tilePixelSize = base canvas pixels per tile-size unit (usually 1)
 *
 * Simplified: the canvas draws tile (col, row) at pixel
 *   px = (col + viewportX) * zoom * tilePixelSize
 *   py = (row + viewportY) * zoom * tilePixelSize
 *
 * where tilePixelSize is implicitly 1 here (tile-size units = pixels at zoom 1).
 *
 * Inverting:
 *   col = floor(px / (zoom * tilePixelSize) - viewportX)
 *   row = floor(py / (zoom * tilePixelSize) - viewportY)
 */
function screenToTile(
  canvasX: number,
  canvasY: number,
  viewportX: number,
  viewportY: number,
  zoom: number,
  tilePixelSize: number,
): TileCoord {
  const col = Math.floor(canvasX / (zoom * tilePixelSize) - viewportX);
  const row = Math.floor(canvasY / (zoom * tilePixelSize) - viewportY);
  return { col, row };
}

/**
 * Returns `true` when (col, row) is within the map bounds.
 */
function inBounds(col: number, row: number, width: number, height: number): boolean {
  return col >= 0 && col < width && row >= 0 && row < height;
}

/**
 * Get the canvas-relative coordinates from a mouse event, accounting for the
 * element's bounding rect (so offset values are correct even if the canvas is
 * not positioned at the top-left of the page).
 */
function canvasCoords(
  e: React.MouseEvent<HTMLCanvasElement>,
): { canvasX: number; canvasY: number } {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    canvasX: e.clientX - rect.left,
    canvasY: e.clientY - rect.top,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * `useCanvasInteraction` attaches all pointer/wheel event handling to the
 * tilemap canvas element.
 *
 * Supported interactions:
 *  - **Left drag**   — paint tiles (or erase) using the active tool and the
 *                      currently selected tile ID.
 *  - **Right click** — eyedropper: pick the tile ID under the cursor and make
 *                      it the active selected tile.
 *  - **Middle drag** — pan the viewport.
 *  - **Scroll wheel** — zoom in/out around the cursor position, clamped to
 *                       [MIN_ZOOM, MAX_ZOOM].
 *
 * The hook reads editor state from `useEditorStore` and calls the store's
 * tile/viewport mutations directly, so the canvas component only needs to
 * attach the returned handlers.
 *
 * @param onPaintTile  Optional callback invoked after each tile is painted.
 *                     Useful for the parent to forward the change to the
 *                     engine via `useEngine().setTile(...)`.
 * @param tilePixelSize  Base pixel size of one tile unit at zoom=1 (default 32).
 *
 * @returns `CanvasInteractionHandlers` — spread onto the <canvas> element.
 */
export function useCanvasInteraction(
  onPaintTile?: (col: number, row: number, tileId: number, solid: boolean) => void,
  tilePixelSize = 32,
): CanvasInteractionHandlers {
  // ---- Store selectors (stable references from Zustand) -------------------
  const width = useEditorStore((s) => s.width);
  const height = useEditorStore((s) => s.height);
  const tiles = useEditorStore((s) => s.tiles);
  const activeTool = useEditorStore((s) => s.activeTool);
  const selectedTileId = useEditorStore((s) => s.selectedTileId);
  const selectedSolid = useEditorStore((s) => s.selectedSolid);
  const viewportX = useEditorStore((s) => s.viewportX);
  const viewportY = useEditorStore((s) => s.viewportY);
  const zoom = useEditorStore((s) => s.zoom);
  const setTile = useEditorStore((s) => s.setTile);
  const setSelectedTileId = useEditorStore((s) => s.setSelectedTileId);
  const setViewport = useEditorStore((s) => s.setViewport);
  const setZoom = useEditorStore((s) => s.setZoom);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  // ---- Local react state --------------------------------------------------
  const [hoveredTile, setHoveredTile] = useState<TileCoord | null>(null);

  // ---- Mutable drag state (ref — no re-render on change) ------------------
  const drag = useRef<DragState>({
    panning: false,
    painting: false,
    panStartX: 0,
    panStartY: 0,
    panStartVpX: 0,
    panStartVpY: 0,
    lastPaintedTile: null,
  });

  // ---- Fill helper ---------------------------------------------------------
  /**
   * Flood-fill starting from (startCol, startRow) using BFS. Replaces all
   * connected tiles that share the same tile ID as the origin tile.
   */
  const floodFill = useCallback(
    (startCol: number, startRow: number, newTileId: number, newSolid: boolean): void => {
      const originIndex = startRow * width + startCol;
      const originTile = tiles[originIndex];
      if (!originTile) return;
      const originId = originTile.id;

      // Nothing to fill if the target already matches.
      if (originId === newTileId) return;

      pushHistory();

      const visited = new Set<number>();
      const queue: TileCoord[] = [{ col: startCol, row: startRow }];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const { col, row } = current;

        if (!inBounds(col, row, width, height)) continue;
        const idx = row * width + col;
        if (visited.has(idx)) continue;
        if (tiles[idx].id !== originId) continue;

        visited.add(idx);
        setTile(col, row, newTileId, newSolid);
        onPaintTile?.(col, row, newTileId, newSolid);

        queue.push(
          { col: col - 1, row },
          { col: col + 1, row },
          { col, row: row - 1 },
          { col, row: row + 1 },
        );
      }
    },
    [width, height, tiles, setTile, pushHistory, onPaintTile],
  );

  // ---- Paint a single tile ------------------------------------------------
  const paintAt = useCallback(
    (col: number, row: number): void => {
      if (!inBounds(col, row, width, height)) return;

      const d = drag.current;
      // Skip if we already painted this tile in this drag stroke.
      if (d.lastPaintedTile?.col === col && d.lastPaintedTile?.row === row) return;
      d.lastPaintedTile = { col, row };

      const tileId = activeTool === 'erase' ? 0 : selectedTileId;
      const solid = activeTool === 'erase' ? false : selectedSolid;

      setTile(col, row, tileId, solid);
      onPaintTile?.(col, row, tileId, solid);
    },
    [width, height, activeTool, selectedTileId, selectedSolid, setTile, onPaintTile],
  );

  // ---- Eyedropper (right-click) -------------------------------------------
  const pickTileAt = useCallback(
    (col: number, row: number): void => {
      if (!inBounds(col, row, width, height)) return;
      const idx = row * width + col;
      const tile = tiles[idx];
      if (tile) {
        setSelectedTileId(tile.id);
      }
    },
    [width, height, tiles, setSelectedTileId],
  );

  // =========================================================================
  // Event handlers
  // =========================================================================

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): void => {
      const { canvasX, canvasY } = canvasCoords(e);
      const tile = screenToTile(canvasX, canvasY, viewportX, viewportY, zoom, tilePixelSize);

      if (e.button === 1) {
        // Middle mouse — start panning.
        e.preventDefault();
        drag.current.panning = true;
        drag.current.panStartX = canvasX;
        drag.current.panStartY = canvasY;
        drag.current.panStartVpX = viewportX;
        drag.current.panStartVpY = viewportY;
        return;
      }

      if (e.button === 0) {
        // Left click — paint or fill.
        if (activeTool === 'fill') {
          floodFill(tile.col, tile.row, selectedTileId, selectedSolid);
          return;
        }

        // Paint / erase — push history once at the start of the stroke.
        pushHistory();
        drag.current.painting = true;
        drag.current.lastPaintedTile = null;
        paintAt(tile.col, tile.row);
        return;
      }

      if (e.button === 2) {
        // Right click — eyedropper.
        pickTileAt(tile.col, tile.row);
        return;
      }
    },
    [
      viewportX,
      viewportY,
      zoom,
      tilePixelSize,
      activeTool,
      selectedTileId,
      selectedSolid,
      pushHistory,
      paintAt,
      floodFill,
      pickTileAt,
    ],
  );

  const onMouseUp = useCallback(
    (_e: React.MouseEvent<HTMLCanvasElement>): void => {
      drag.current.panning = false;
      drag.current.painting = false;
      drag.current.lastPaintedTile = null;
    },
    [],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): void => {
      const { canvasX, canvasY } = canvasCoords(e);
      const d = drag.current;

      // --- Panning ---------------------------------------------------------
      if (d.panning) {
        const dx = (canvasX - d.panStartX) / (zoom * tilePixelSize);
        const dy = (canvasY - d.panStartY) / (zoom * tilePixelSize);
        setViewport(d.panStartVpX + dx, d.panStartVpY + dy);
        return; // Skip hover update while panning for performance.
      }

      // --- Hovered tile update ---------------------------------------------
      const tile = screenToTile(canvasX, canvasY, viewportX, viewportY, zoom, tilePixelSize);
      const isInBounds = inBounds(tile.col, tile.row, width, height);
      setHoveredTile(isInBounds ? tile : null);

      // --- Continuous paint ------------------------------------------------
      if (d.painting && isInBounds) {
        paintAt(tile.col, tile.row);
      }
    },
    [viewportX, viewportY, zoom, tilePixelSize, width, height, setViewport, paintAt],
  );

  const onMouseLeave = useCallback(
    (_e: React.MouseEvent<HTMLCanvasElement>): void => {
      // Clear hover indicator when the pointer leaves the canvas.
      setHoveredTile(null);
      // End any active paint stroke (pointer left canvas).
      drag.current.painting = false;
      drag.current.lastPaintedTile = null;
      // We intentionally do NOT end panning here — the user may move the
      // cursor outside the canvas boundary while panning; the pan will
      // resume when they move back in.
    },
    [],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>): void => {
      e.preventDefault();

      const { canvasX, canvasY } = canvasCoords(e);

      // Compute new zoom clamped to [MIN_ZOOM, MAX_ZOOM].
      // deltaY > 0 → scroll down → zoom out; deltaY < 0 → scroll up → zoom in.
      const rawDelta = -e.deltaY * ZOOM_FACTOR;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + rawDelta * zoom));

      // Zoom toward the cursor: keep the world-space point under the cursor
      // fixed as the viewport changes.
      //
      // Before zoom:
      //   worldX = canvasX / (zoom * tilePixelSize) - viewportX
      //
      // After zoom we want the same worldX, so:
      //   worldX = canvasX / (newZoom * tilePixelSize) - newViewportX
      //   newViewportX = canvasX / (newZoom * tilePixelSize) - worldX
      //
      const worldX = canvasX / (zoom * tilePixelSize) - viewportX;
      const worldY = canvasY / (zoom * tilePixelSize) - viewportY;
      const newViewportX = canvasX / (newZoom * tilePixelSize) - worldX;
      const newViewportY = canvasY / (newZoom * tilePixelSize) - worldY;

      setZoom(newZoom);
      setViewport(newViewportX, newViewportY);
    },
    [zoom, viewportX, viewportY, tilePixelSize, setZoom, setViewport],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): void => {
      // Suppress the browser context menu on right-click so we can use
      // right-click for the eyedropper without interference.
      e.preventDefault();
    },
    [],
  );

  // =========================================================================
  // Return
  // =========================================================================

  return {
    onMouseDown,
    onMouseUp,
    onMouseMove,
    onWheel,
    onMouseLeave,
    onContextMenu,
    hoveredTile,
  };
}
