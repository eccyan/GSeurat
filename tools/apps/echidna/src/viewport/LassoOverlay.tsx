import React, { useRef, useState, useCallback } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import * as THREE from 'three';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { parseKey } from '../lib/voxelUtils.js';
import { pointInPolygon } from '../lib/pointInPolygon.js';
import type { VoxelKey } from '../store/types.js';

const MIN_POINT_DISTANCE_PX = 5;

interface Props {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function LassoOverlay({ cameraRef, containerRef }: Props) {
  useComponentRegistry('LassoOverlay');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const voxels = useCharacterStore((s) => s.asset?.voxels ?? new Map());
  const setLassoSelection = useCharacterStore((s) => s.setLassoSelection);

  const [points, setPoints] = useState<[number, number][]>([]);
  const isDrawing = useRef(false);

  const isActive = activeTool === 'lasso_select';

  const projectVoxels = useCallback(
    (polygon: [number, number][]): VoxelKey[] => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return [];

      const rect = container.getBoundingClientRect();
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;
      const ndc = new THREE.Vector3();
      const selected: VoxelKey[] = [];

      for (const key of voxels.keys()) {
        const [vx, vy, vz] = parseKey(key);
        ndc.set(vx + 0.5, vy + 0.5, vz + 0.5);
        ndc.project(camera);
        // NDC (-1..1) to pixel (0..width, 0..height) — Y flipped
        const px = (ndc.x + 1) * halfW;
        const py = (1 - ndc.y) * halfH;
        if (pointInPolygon(px, py, polygon)) {
          selected.push(key);
        }
      }

      return selected;
    },
    [voxels, cameraRef, containerRef],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isActive) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setPoints([[x, y]]);
      isDrawing.current = true;
    },
    [isActive],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setPoints((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return [[x, y]];
        const dx = x - last[0];
        const dy = y - last[1];
        if (dx * dx + dy * dy < MIN_POINT_DISTANCE_PX * MIN_POINT_DISTANCE_PX) {
          return prev;
        }
        const next: [number, number][] = [...prev, [x, y]];
        // Live preview: update lasso selection as we drag
        if (next.length >= 3) {
          const selected = projectVoxels(next);
          setLassoSelection(selected.length > 0 ? selected : null);
        }
        return next;
      });
    },
    [projectVoxels, setLassoSelection],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);

      if (points.length >= 3) {
        const selected = projectVoxels(points);
        setLassoSelection(selected.length > 0 ? selected : null);
      }
      setPoints([]);
    },
    [points, projectVoxels, setLassoSelection],
  );

  if (!isActive) return null;

  const pathD = points.length > 0
    ? `M ${points[0][0]} ${points[0][1]} ` +
      points.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ') +
      (points.length > 2 ? ' Z' : '')
    : '';

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        cursor: 'crosshair',
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {pathD && (
        <path
          d={pathD}
          fill="rgba(119, 119, 255, 0.15)"
          stroke="#77f"
          strokeWidth={2}
          strokeDasharray="4 4"
        />
      )}
    </svg>
  );
}
