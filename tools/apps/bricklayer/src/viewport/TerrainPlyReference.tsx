import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { PlyPointCloud } from './PlyPointCloud.js';

export function TerrainPlyReference() {
  const terrainPlyFile = useSceneStore((s) => s.terrainPlyFile);
  const projectHandle = useSceneStore((s) => s.projectHandle);
  const visible = useSceneStore((s) => s.showTerrainPly);

  if (!terrainPlyFile) return null;

  return (
    <PlyPointCloud
      plyPath={terrainPlyFile}
      projectHandle={projectHandle}
      visible={visible}
      pointSize={2.5}
      opacity={0.7}
    />
  );
}
