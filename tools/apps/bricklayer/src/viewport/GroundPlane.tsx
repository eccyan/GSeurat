import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

/**
 * Invisible ground reference plane at Y=0. Provides a raycast target for
 * double-click teleport and keeps the viewport grounded.
 */
export function GroundPlane() {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[gridWidth / 2 - 0.5, -0.5, gridDepth / 2 - 0.5]}
    >
      <planeGeometry args={[gridWidth, gridDepth]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
