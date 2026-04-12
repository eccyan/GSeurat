import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

function PortalMarker({ position, regionShape, regionRadius, regionHalfExtents, isSelected, onSelect }: {
  position: [number, number, number];
  regionShape: 'box' | 'sphere';
  regionRadius: number;
  regionHalfExtents: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = isSelected ? '#ffffff' : '#ab47bc';
  const opacity = isSelected ? 0.8 : 0.6;

  if (regionShape === 'sphere') {
    return (
      <>
        {/* Invisible hit sphere */}
        <mesh
          position={[position[0], position[1] + regionRadius, position[2]]}
          onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
        >
          <sphereGeometry args={[regionRadius + 0.4, 16, 12]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        {/* Visible wireframe sphere */}
        <mesh position={[position[0], position[1] + regionRadius, position[2]]}>
          <sphereGeometry args={[regionRadius, 16, 12]} />
          <meshBasicMaterial
            color={color}
            wireframe
            transparent
            opacity={opacity}
          />
        </mesh>
      </>
    );
  }

  // Box region
  const w = regionHalfExtents[0] * 2;
  const h = regionHalfExtents[1] * 2;
  const d = regionHalfExtents[2] * 2;

  return (
    <>
      {/* Invisible hit box */}
      <mesh
        position={[position[0], position[1] + regionHalfExtents[1], position[2]]}
        onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <boxGeometry args={[w + 0.8, h + 0.8, d + 0.8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible wireframe box */}
      <mesh position={[position[0], position[1] + regionHalfExtents[1], position[2]]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={opacity}
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
          regionShape={portal.region_shape}
          regionRadius={portal.region_radius}
          regionHalfExtents={portal.region_half_extents}
          isSelected={selectedEntity?.type === 'portal' && selectedEntity.id === portal.id}
          onSelect={() => setSelectedEntity({ type: 'portal', id: portal.id })}
        />
      ))}
    </group>
  );
}
