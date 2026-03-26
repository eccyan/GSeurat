import React from 'react';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

function AnimMarker({ center, shape, radius, halfExtents, effect, isSelected, onSelect }: {
  center: [number, number, number];
  shape: string;
  radius: number;
  halfExtents: [number, number, number];
  effect: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <group position={[center[0], center[1], center[2]]}>
      {/* Invisible hit box */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[1.0, 12, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Center dot */}
      <mesh>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial color={isSelected ? '#ffffff' : '#00ddff'} />
      </mesh>
      {/* Region wireframe */}
      {shape === 'sphere' ? (
        <mesh>
          <sphereGeometry args={[radius, 16, 12]} />
          <meshBasicMaterial
            color={isSelected ? '#ffffff' : '#00ddff'}
            wireframe
            transparent
            opacity={0.3}
          />
        </mesh>
      ) : (
        <mesh>
          <boxGeometry args={[halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2]} />
          <meshBasicMaterial
            color={isSelected ? '#ffffff' : '#00ddff'}
            wireframe
            transparent
            opacity={0.3}
          />
        </mesh>
      )}
      {/* Label */}
      {isSelected && (
        <Html position={[0, (shape === 'sphere' ? radius : halfExtents[1]) + 1, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#00ddff',
            padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
          }}>
            {effect}
          </div>
        </Html>
      )}
    </group>
  );
}

export function GsAnimationMarkers() {
  const animations = useSceneStore((s) => s.gsAnimations);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {animations.map((a) => (
        <AnimMarker
          key={a.id}
          center={a.center}
          shape={a.shape}
          radius={a.radius}
          halfExtents={a.half_extents}
          effect={a.effect}
          isSelected={selectedEntity?.type === 'gs_animation' && selectedEntity.id === a.id}
          onSelect={() => setSelectedEntity({ type: 'gs_animation', id: a.id })}
        />
      ))}
    </group>
  );
}
