import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';

function LightMarker({ position, height, radius, color, isSelected, onSelect, areaWidth, areaHeight, coneAngle, direction }: {
  position: [number, number];
  height: number;
  radius: number;
  color: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
  areaWidth: number;
  areaHeight: number;
  coneAngle: number;
  direction: [number, number, number];
}) {
  const colorStr = `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;
  const isArea = areaWidth > 0 && areaHeight > 0;
  const isSpot = coneAngle < 180 && !isArea;

  // Compute rotation for spot cone along direction vector
  const coneRotation = useMemo(() => {
    if (!isSpot) return undefined;
    const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    return new THREE.Euler().setFromQuaternion(q);
  }, [isSpot, direction]);

  const coneLength = Math.min(radius * 0.5, 10);
  const coneRadius = isSpot ? coneLength * Math.tan((coneAngle / 2) * Math.PI / 180) : 0;

  return (
    <group position={[position[0], height, position[1]]}>
      {/* Invisible hit box */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[1.0, 12, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[isArea || isSpot ? 0.4 : 0.6, 12, 12]} />
        <meshBasicMaterial color={isSelected ? '#ffffff' : colorStr} />
      </mesh>
      {/* Point light: radius ring */}
      {!isArea && !isSpot && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius - 0.1, radius + 0.1, 32]} />
          <meshBasicMaterial color={colorStr} transparent opacity={0.5} side={2} />
        </mesh>
      )}
      {/* Spot light: cone wireframe */}
      {isSpot && coneRotation && (
        <mesh rotation={coneRotation}>
          <coneGeometry args={[coneRadius, coneLength, 16, 1, true]} />
          <meshBasicMaterial
            color={isSelected ? '#ffffff' : colorStr}
            wireframe
            transparent
            opacity={0.6}
          />
        </mesh>
      )}
      {/* Area light: rectangle wireframe */}
      {isArea && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[areaWidth, areaHeight]} />
          <meshBasicMaterial
            color={isSelected ? '#ffffff' : colorStr}
            wireframe
            transparent
            opacity={0.7}
            side={2}
          />
        </mesh>
      )}
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
          areaWidth={light.area_width ?? 0}
          areaHeight={light.area_height ?? 0}
          coneAngle={light.cone_angle ?? 180}
          direction={light.direction ?? [0, -1, 0]}
        />
      ))}
    </group>
  );
}
