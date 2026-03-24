import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

function Marker({ position, scale, color, isSelected, onSelect }: {
  position: [number, number, number];
  scale: number;
  color: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <>
      {/* Invisible solid mesh for click detection */}
      <mesh
        position={position}
        onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <boxGeometry args={[scale * 1.5, scale * 1.5, scale * 1.5]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible wireframe */}
      <mesh position={position}>
        <boxGeometry args={[scale * 1.2, scale * 1.2, scale * 1.2]} />
        <meshBasicMaterial
          color={isSelected ? '#ffffff' : color}
          wireframe
          transparent
          opacity={isSelected ? 0.8 : 0.6}
        />
      </mesh>
    </>
  );
}

export function ObjectMarkers() {
  const placedObjects = useSceneStore((s) => s.placedObjects);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {placedObjects.map((obj) => (
        <Marker
          key={obj.id}
          position={obj.position}
          scale={obj.scale}
          color={obj.is_static ? '#00bcd4' : '#ff9800'}
          isSelected={selectedEntity?.type === 'object' && selectedEntity.id === obj.id}
          onSelect={() => setSelectedEntity({ type: 'object', id: obj.id })}
        />
      ))}
    </group>
  );
}
