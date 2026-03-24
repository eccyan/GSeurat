import React, { useMemo, useCallback, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();

function DraggableLight({ id, position, height, radius, color, isSelected, onSelect, coneAngle, direction }: {
  id: string;
  position: [number, number];
  height: number;
  radius: number;
  color: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
  coneAngle: number;       // degrees, 180 = point light
  direction: [number, number, number];
}) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<[number, number] | null>(null);

  const displayPos = dragPos ?? position;
  const colorStr = `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;
  const isSpot = coneAngle < 180;

  // Compute rotation quaternion to orient cone along direction vector
  const coneRotation = useMemo(() => {
    if (!isSpot) return undefined;
    const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
    const q = new THREE.Quaternion();
    // coneGeometry points along +Y by default, we want it along dir
    q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    return new THREE.Euler().setFromQuaternion(q);
  }, [isSpot, direction]);

  // Cone geometry dimensions from angle + a fixed visual length
  const coneLength = Math.min(radius * 0.5, 10);
  const coneRadius = isSpot ? coneLength * Math.tan((coneAngle / 2) * Math.PI / 180) : 0;

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    onSelect();

    if (useSceneStore.getState().mode !== 'scene') return;

    const el = gl.domElement;
    _plane.set(new THREE.Vector3(0, 1, 0), -height);
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      _raycaster.setFromCamera(pointer, camera);
      if (_raycaster.ray.intersectPlane(_plane, _intersection)) {
        setDragPos([
          Math.round(_intersection.x * 10) / 10,
          Math.round(_intersection.z * 10) / 10,
        ]);
      }
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      setDragging(false);
      const snapped: [number, number] = [
        Math.round(_intersection.x * 10) / 10,
        Math.round(_intersection.z * 10) / 10,
      ];
      useSceneStore.getState().updateLight(id, { position: snapped });
      setDragPos(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [id, position, height, camera, gl, onSelect]);

  return (
    <group position={[displayPos[0], height, displayPos[1]]}>
      {/* Invisible hit box for pointer events */}
      <mesh onPointerDown={handlePointerDown}>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible sphere */}
      <mesh>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshBasicMaterial color={dragging ? '#ffcc00' : isSelected ? '#ffffff' : colorStr} />
      </mesh>
      {/* Point light: radius ring */}
      {!isSpot && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius - 0.05, radius + 0.05, 32]} />
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
      {dragging && (
        <Html position={[0, 1.5, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.8)', color: '#ffcc00',
            padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
          }}>
            {displayPos[0].toFixed(1)}, {displayPos[1].toFixed(1)}
          </div>
        </Html>
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
        <DraggableLight
          key={light.id}
          id={light.id}
          position={light.position}
          height={light.height}
          radius={light.radius}
          color={light.color}
          isSelected={selectedEntity?.type === 'light' && selectedEntity.id === light.id}
          onSelect={() => setSelectedEntity({ type: 'light', id: light.id })}
          coneAngle={light.cone_angle ?? 180}
          direction={light.direction ?? [0, -1, 0]}
        />
      ))}
    </group>
  );
}
