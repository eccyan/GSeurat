import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { useWorldStore } from '../store/useWorldStore.js';
import { PlyPointCloud } from './PlyPointCloud.js';
import { chunkAabbMin, chunkGridKey } from '@gseurat/project-root';

export function TerrainPlyReference() {
  const terrainPlyFile = useSceneStore((s) => s.terrainPlyFile);
  const projectHandle = useSceneStore((s) => s.projectHandle);
  const visible = useSceneStore((s) => s.showTerrainPly);
  const editingContext = useWorldStore((s) => s.editingContext);
  const manifest = useWorldStore((s) => s.manifest);

  if (!terrainPlyFile) return null;

  // Compute chunk offset so terrain PLY aligns with local-space game objects
  let offset: [number, number, number] = [0, 0, 0];
  if (editingContext?.type === 'chunk') {
    const chunk = manifest.chunks.find((c) => chunkGridKey(c.grid) === editingContext.gridKey);
    if (chunk) {
      const worldMin = chunkAabbMin(chunk.grid, manifest.grid_cell_size);
      offset = [-worldMin[0], -worldMin[1], -worldMin[2]];
    }
  }

  return (
    <PlyPointCloud
      plyPath={terrainPlyFile}
      projectHandle={projectHandle}
      visible={visible}
      position={offset}
      pointSize={2.5}
      opacity={0.7}
    />
  );
}
