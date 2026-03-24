import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

function PortalMarker({ position, size, isSelected, onSelect }: {
  position: [number, number];
  size: [number, number];
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <>
      {/* Invisible hit box */}
      <mesh
        position={[position[0] + size[0] / 2, 1, position[1] + size[1] / 2]}
        onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <boxGeometry args={[size[0] + 0.8, 3.0, size[1] + 0.8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible wireframe */}
      <mesh position={[position[0] + size[0] / 2, 1, position[1] + size[1] / 2]}>
        <boxGeometry args={[size[0] + 0.2, 2.4, size[1] + 0.2]} />
        <meshBasicMaterial
          color={isSelected ? '#ffffff' : '#ab47bc'}
          wireframe
          transparent
          opacity={isSelected ? 0.8 : 0.6}
        />
      </mesh>
    </>
  );
}

export function PortalMarkers() {
  const portals = useSceneStore((s) => s.portals);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {portals.map((portal) => (
        <PortalMarker
          key={portal.id}
          position={portal.position}
          size={portal.size}
          isSelected={selectedEntity?.type === 'portal' && selectedEntity.id === portal.id}
          onSelect={() => setSelectedEntity({ type: 'portal', id: portal.id })}
        />
      ))}
    </group>
  );
}
