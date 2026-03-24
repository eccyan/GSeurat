import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

export function PlayerMarker() {
  const player = useSceneStore((s) => s.player);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  const isSelected = selectedEntity?.type === 'player';

  if (!showGizmos) return null;

  return (
    <group position={player.position}>
      {/* Invisible hit box */}
      <mesh
        position={[0, 1.0, 0]}
        onPointerDown={(e) => { e.stopPropagation(); setSelectedEntity({ type: 'player', id: 'player' }); }}
      >
        <cylinderGeometry args={[1.0, 1.0, 2.8, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible cylinder */}
      <mesh position={[0, 1.0, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 2.0, 12]} />
        <meshStandardMaterial
          color={isSelected ? '#ffffff' : '#66bb6a'}
          transparent
          opacity={isSelected ? 0.8 : 0.7}
        />
      </mesh>
      {/* Direction arrow */}
      <mesh position={[0, 2.3, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.4, 0.7, 8]} />
        <meshStandardMaterial color="#66bb6a" />
      </mesh>
    </group>
  );
}
