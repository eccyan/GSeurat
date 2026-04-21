import React, { useCallback } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { PlyPointCloud } from './PlyPointCloud.js';
import type { Aabb } from './plyAabb.js';

export function TerrainPlyReference() {
  const terrainPlyFile = useSceneStore((s) => s.terrainPlyFile);
  const projectHandle = useSceneStore((s) => s.projectHandle);
  const visible = useSceneStore((s) => s.showTerrainPly);
  const terrainAabb = useSceneStore((s) => s.terrainAabb);
  const setTerrainAabb = useSceneStore((s) => s.setTerrainAabb);

  const handleAabb = useCallback((aabb: Aabb | null) => {
    setTerrainAabb(aabb);
  }, [setTerrainAabb]);

  if (!terrainPlyFile) return null;

  // Shift terrain from world space to grid space so it aligns with
  // grid-coordinate entity markers (game objects, camera zones, lights).
  const offset: [number, number, number] = terrainAabb
    ? [-terrainAabb.min[0], -terrainAabb.min[1], -terrainAabb.min[2]]
    : [0, 0, 0];

  return (
    <group position={offset}>
      <PlyPointCloud
        plyPath={terrainPlyFile}
        projectHandle={projectHandle}
        visible={visible}
        pointSize={2.5}
        opacity={1.0}
        onAabb={handleAabb}
      />
    </group>
  );
}
