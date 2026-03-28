import React from 'react';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

function VfxMarker({ position, name, radius, isSelected, onSelect }: {
  position: [number, number, number];
  name: string;
  radius: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = isSelected ? '#ffffff' : '#f59e0b';

  return (
    <group position={[position[0], position[1], position[2]]}>
      {/* Invisible hit box */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[1.0, 12, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Center diamond */}
      <mesh rotation={[0, Math.PI / 4, 0]}>
        <octahedronGeometry args={[0.5]} />
        <meshBasicMaterial color={color} transparent opacity={isSelected ? 0.9 : 0.6} />
      </mesh>
      {/* Radius wireframe */}
      <mesh>
        <sphereGeometry args={[radius, 24, 16]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={isSelected ? 0.2 : 0.08} />
      </mesh>
      {/* Label */}
      {isSelected && (
        <Html position={[0, 1.2, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#f59e0b',
            padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
          }}>
            {name}
          </div>
        </Html>
      )}
    </group>
  );
}

export function VfxInstanceMarkers() {
  const instances = useSceneStore((s) => s.vfxInstances);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {instances.map((v) => (
        <VfxMarker
          key={v.id}
          position={v.position}
          name={v.name}
          radius={v.radius}
          isSelected={selectedEntity?.type === 'vfx_instance' && selectedEntity.id === v.id}
          onSelect={() => setSelectedEntity({ type: 'vfx_instance', id: v.id })}
        />
      ))}
    </group>
  );
}
