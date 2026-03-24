import React from 'react';
import { Line } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

function NpcMarker({ id, position, isSelected, onSelect, waypoints }: {
  id: string;
  position: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
  waypoints: [number, number][];
}) {
  return (
    <group key={id}>
      {/* Invisible hit box */}
      <mesh position={position} onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <cylinderGeometry args={[1.0, 1.0, 2.5, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible mesh */}
      <mesh position={position}>
        <cylinderGeometry args={[0.6, 0.6, 2.0, 12]} />
        <meshStandardMaterial
          color={isSelected ? '#ffffff' : '#4fc3f7'}
          transparent
          opacity={isSelected ? 0.8 : 0.7}
        />
      </mesh>
      {waypoints.length > 1 && (
        <Line
          points={waypoints.map(([wx, wz]) => [wx, position[1] + 0.1, wz] as [number, number, number])}
          color="#4fc3f7"
          lineWidth={4}
          dashed
          dashSize={0.5}
          gapSize={0.3}
        />
      )}
    </group>
  );
}

export function NpcMarkers() {
  const npcs = useSceneStore((s) => s.npcs);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {npcs.map((npc) => (
        <NpcMarker
          key={npc.id}
          id={npc.id}
          position={npc.position}
          isSelected={selectedEntity?.type === 'npc' && selectedEntity.id === npc.id}
          onSelect={() => setSelectedEntity({ type: 'npc', id: npc.id })}
          waypoints={npc.waypoints}
        />
      ))}
    </group>
  );
}
