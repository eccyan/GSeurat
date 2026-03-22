import React from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';

export function MirrorPlane() {
  const mirrorAxis = useCharacterStore((s) => s.mirrorAxis);
  const gridWidth = useCharacterStore((s) => s.gridWidth);
  const gridDepth = useCharacterStore((s) => s.gridDepth);

  if (!mirrorAxis) return null;

  const halfW = (gridWidth - 1) / 2;
  const halfD = (gridDepth - 1) / 2;
  const height = 32;

  if (mirrorAxis === 'x') {
    return (
      <mesh
        position={[halfW, height / 2 - 0.5, gridDepth / 2 - 0.5]}
        rotation={[0, 0, 0]}
      >
        <planeGeometry args={[gridDepth, height]} />
        <meshBasicMaterial
          color="#ff4444"
          transparent
          opacity={0.08}
          side={2}
          depthWrite={false}
        />
      </mesh>
    );
  }

  // Mirror Z
  return (
    <mesh
      position={[gridWidth / 2 - 0.5, height / 2 - 0.5, halfD]}
      rotation={[0, Math.PI / 2, 0]}
    >
      <planeGeometry args={[gridWidth, height]} />
      <meshBasicMaterial
        color="#4444ff"
        transparent
        opacity={0.08}
        side={2}
        depthWrite={false}
      />
    </mesh>
  );
}
