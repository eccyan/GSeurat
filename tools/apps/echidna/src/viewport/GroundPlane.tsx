import React, { useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { brushPositions } from '../lib/voxelUtils.js';

export function GroundPlane() {
  const gridWidth = useCharacterStore((s) => s.character?.gridWidth ?? 32);
  const gridDepth = useCharacterStore((s) => s.character?.gridDepth ?? 32);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const store = useCharacterStore.getState();
    if (store.activeTool !== 'place') return;

    const point = e.point;
    const x = Math.round(point.x);
    const y = 0;
    const z = Math.round(point.z);

    if (x < 0 || x >= (store.character?.gridWidth ?? 32) || z < 0 || z >= (store.character?.gridDepth ?? 32)) return;

    store.pushUndo();
    if (store.brushSize > 1) {
      store.placeVoxels(brushPositions(x, y, z, store.brushSize));
    } else {
      store.placeVoxel(x, y, z);
    }
  }, []);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[gridWidth / 2 - 0.5, -0.5, gridDepth / 2 - 0.5]}
      onClick={handleClick}
    >
      <planeGeometry args={[gridWidth, gridDepth]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
