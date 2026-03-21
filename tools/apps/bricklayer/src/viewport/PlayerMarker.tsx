import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

export function PlayerMarker() {
  const player = useSceneStore((s) => s.player);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const setInspectorTab = useSceneStore((s) => s.setInspectorTab);

  if (!showGizmos) return null;

  return (
    <group
      position={player.position}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedEntity({ type: 'player', id: 'player' });
        setInspectorTab('entities');
      }}
    >
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 1.5, 8]} />
        <meshStandardMaterial color="#66bb6a" transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, 1.8, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.25, 0.5, 8]} />
        <meshStandardMaterial color="#66bb6a" />
      </mesh>
    </group>
  );
}
