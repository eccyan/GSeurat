import React, { useMemo } from 'react';
import * as THREE from 'three';
import { chunkAabbMin, chunkGridKey } from '@gseurat/project-root';
import { useWorldStore } from '../store/useWorldStore.js';

// ── ChunkWireframes ──
// Renders ghosted wireframe boxes for neighboring chunks in SCENE mode,
// when editing a specific chunk (editingChunkGrid is set).

function GhostChunkBox({
  min,
  size,
}: {
  min: [number, number, number];
  size: [number, number, number];
}) {
  const cx = min[0] + size[0] / 2;
  const cy = min[1] + size[1] / 2;
  const cz = min[2] + size[2] / 2;

  const geo = useMemo(() => new THREE.BoxGeometry(size[0], size[1], size[2]), [size[0], size[1], size[2]]);

  return (
    <group position={[cx, cy, cz]}>
      <lineSegments>
        <edgesGeometry args={[geo]} />
        <lineBasicMaterial color="#888888" transparent opacity={0.3} />
      </lineSegments>
    </group>
  );
}

export function ChunkWireframes() {
  const loaded = useWorldStore((s) => s.loaded);
  const manifest = useWorldStore((s) => s.manifest);
  const editingChunkGrid = useWorldStore((s) => s.editingChunkGrid);

  if (!loaded || !editingChunkGrid) return null;

  const editingKey = chunkGridKey(editingChunkGrid);
  const cellSize = manifest.grid_cell_size;

  return (
    <group>
      {manifest.chunks
        .filter((chunk) => chunkGridKey(chunk.grid) !== editingKey)
        .map((chunk) => {
          const key = chunkGridKey(chunk.grid);
          const min = chunkAabbMin(chunk.grid, cellSize);
          return (
            <GhostChunkBox
              key={key}
              min={min}
              size={cellSize}
            />
          );
        })}
    </group>
  );
}
