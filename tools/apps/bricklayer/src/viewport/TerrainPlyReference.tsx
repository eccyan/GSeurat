import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { PlyPointCloud } from './PlyPointCloud.js';

function slugify(name: string): string {
  const cleaned = name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : 'map';
}

export function TerrainPlyReference() {
  const projectName = useSceneStore((s) => s.projectName);
  const projectHandle = useSceneStore((s) => s.projectHandle);
  const visible = useSceneStore((s) => s.showTerrainPly);

  const plyPath = `assets/maps/${slugify(projectName)}.ply`;

  return (
    <PlyPointCloud
      plyPath={plyPath}
      projectHandle={projectHandle}
      visible={visible}
      pointSize={0.8}
      opacity={0.7}
    />
  );
}
