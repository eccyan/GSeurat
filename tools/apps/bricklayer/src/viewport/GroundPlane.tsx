import React, { useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';
import { brushPositions } from '../lib/voxelUtils.js';

export function GroundPlane() {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const yLevelLock = useSceneStore((s) => s.yLevelLock);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const store = useSceneStore.getState();
    // Only handle clicks in terrain mode
    if (store.mode !== 'terrain' || store.activeNode?.kind === 'collision') return;
    if (store.activeTool !== 'place') return;

    const point = e.point;
    const x = Math.round(point.x);
    const y = store.yLevelLock ?? 0;
    const z = Math.round(point.z);

    if (x < 0 || x >= store.gridWidth || z < 0 || z >= store.gridDepth) return;

    store.pushUndo();
    if (store.brushSize > 1) {
      store.placeVoxels(brushPositions(x, y, z, store.brushSize));
    } else {
      store.placeVoxel(x, y, z);
    }
  }, []);

  // Position the click plane at the locked Y level (or just below origin)
  const planeY = yLevelLock !== null ? yLevelLock - 0.5 : -0.5;

  return (
    <>
      {/* Invisible click plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[gridWidth / 2 - 0.5, planeY, gridDepth / 2 - 0.5]}
        onClick={handleClick}
      >
        <planeGeometry args={[gridWidth, gridDepth]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Visible grid at Y-level lock height */}
      {yLevelLock !== null && (
        <Grid
          args={[gridWidth, gridDepth]}
          position={[gridWidth / 2 - 0.5, yLevelLock - 0.5, gridDepth / 2 - 0.5]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#553"
          sectionSize={8}
          sectionThickness={1}
          sectionColor="#774"
          fadeDistance={200}
          infiniteGrid={false}
        />
      )}
    </>
  );
}
