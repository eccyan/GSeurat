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
        position={[0, 0.75, 0]}
        onPointerDown={(e) => { e.stopPropagation(); setSelectedEntity({ type: 'player', id: 'player' }); }}
      >
        <cylinderGeometry args={[0.5, 0.5, 2, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible cylinder */}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 1.5, 8]} />
        <meshStandardMaterial
          color={isSelected ? '#ffffff' : '#66bb6a'}
          transparent
          opacity={isSelected ? 0.8 : 0.7}
        />
      </mesh>
      {/* Direction arrow */}
      <mesh position={[0, 1.8, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.25, 0.5, 8]} />
        <meshStandardMaterial color="#66bb6a" />
      </mesh>
    </group>
  );
}
