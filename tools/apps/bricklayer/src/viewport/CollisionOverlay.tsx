import React, { useMemo } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

export function CollisionOverlay() {
  const collisionGrid = useSceneStore((s) => s.collisionGrid);
  const showCollision = useSceneStore((s) => s.showCollision);

  const cells = useMemo(() => {
    if (!showCollision) return [];
    return Array.from(collisionGrid).map((key) => {
      const [x, z] = key.split(',').map(Number);
      return { x, z, key };
    });
  }, [collisionGrid, showCollision]);

  if (!showCollision) return null;

  return (
    <group>
      {cells.map(({ x, z, key }) => (
        <mesh key={key} position={[x, 0.01, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="#ff1744" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
