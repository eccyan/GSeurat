import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

function LightMarker({ position, height, radius, color, isSelected, onSelect }: {
  position: [number, number];
  height: number;
  radius: number;
  color: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
}) {
  const colorStr = `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;

  return (
    <group position={[position[0], height, position[1]]}>
      {/* Invisible hit box for pointer events */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[1.0, 12, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible sphere */}
      <mesh>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshBasicMaterial color={isSelected ? '#ffffff' : colorStr} />
      </mesh>
      {/* Radius ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.1, radius + 0.1, 32]} />
        <meshBasicMaterial color={colorStr} transparent opacity={0.5} side={2} />
      </mesh>
    </group>
  );
}

export function LightGizmos() {
  const lights = useSceneStore((s) => s.staticLights);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {lights.map((light) => (
        <LightMarker
          key={light.id}
          position={light.position}
          height={light.height}
          radius={light.radius}
          color={light.color}
          isSelected={selectedEntity?.type === 'light' && selectedEntity.id === light.id}
          onSelect={() => setSelectedEntity({ type: 'light', id: light.id })}
        />
      ))}
    </group>
  );
}
