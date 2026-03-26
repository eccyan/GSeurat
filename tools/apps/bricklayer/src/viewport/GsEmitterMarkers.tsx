import React from 'react';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

function EmitterMarker({ position, preset, isSelected, onSelect }: {
  position: [number, number, number];
  preset: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const label = preset || 'Custom';

  return (
    <group position={[position[0], position[1], position[2]]}>
      {/* Invisible hit box */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[1.0, 12, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[0.7, 12, 12]} />
        <meshBasicMaterial
          color={isSelected ? '#ffffff' : '#ff4dc8'}
          transparent
          opacity={0.3}
        />
      </mesh>
      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshBasicMaterial color={isSelected ? '#ffffff' : '#ff4dc8'} />
      </mesh>
      {/* Label */}
      {isSelected && (
        <Html position={[0, 1.2, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#ff80dd',
            padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
          }}>
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

export function GsEmitterMarkers() {
  const emitters = useSceneStore((s) => s.gsParticleEmitters);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {emitters.map((e) => (
        <EmitterMarker
          key={e.id}
          position={e.position}
          preset={e.preset}
          isSelected={selectedEntity?.type === 'gs_emitter' && selectedEntity.id === e.id}
          onSelect={() => setSelectedEntity({ type: 'gs_emitter', id: e.id })}
        />
      ))}
    </group>
  );
}
