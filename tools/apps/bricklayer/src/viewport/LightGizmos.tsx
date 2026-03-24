import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();

function DraggableLight({ id, position, height, radius, color, isSelected, onSelect }: {
  id: string;
  position: [number, number];
  height: number;
  radius: number;
  color: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<[number, number] | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [heightMode, setHeightMode] = useState(false);
  const lastClientY = useRef(0);
  const currentHeight = useRef(0);
  const currentXZ = useRef<[number, number]>([0, 0]);

  const displayPos = dragPos ?? position;
  const displayHeight = dragHeight ?? height;
  const colorStr = `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    onSelect();

    const storeState = useSceneStore.getState();
    if (storeState.mode !== 'scene') return;
    if (storeState.grabMode) return; // Grab plane handles movement

    const el = gl.domElement;
    currentHeight.current = height;
    currentXZ.current = [...position];
    lastClientY.current = e.clientY;
    _plane.set(new THREE.Vector3(0, 1, 0), -height);
    setDragging(true);
    setHeightMode(false);

    const onMove = (ev: PointerEvent) => {
      if (ev.shiftKey) {
        // Shift held: vertical mouse movement adjusts height
        setHeightMode(true);
        const deltaY = (lastClientY.current - ev.clientY) * 0.05;
        lastClientY.current = ev.clientY;
        currentHeight.current = Math.round((currentHeight.current + deltaY) * 10) / 10;
        setDragHeight(currentHeight.current);
      } else {
        // Normal XZ plane drag
        setHeightMode(false);
        lastClientY.current = ev.clientY;
        const rect = el.getBoundingClientRect();
        const pointer = new THREE.Vector2(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        _plane.set(new THREE.Vector3(0, 1, 0), -currentHeight.current);
        _raycaster.setFromCamera(pointer, camera);
        if (_raycaster.ray.intersectPlane(_plane, _intersection)) {
          const sx = Math.round(_intersection.x * 10) / 10;
          const sz = Math.round(_intersection.z * 10) / 10;
          currentXZ.current = [sx, sz];
          setDragPos([sx, sz]);
        }
      }
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      setDragging(false);
      setHeightMode(false);
      useSceneStore.getState().updateLight(id, {
        position: currentXZ.current,
        height: currentHeight.current,
      });
      setDragPos(null);
      setDragHeight(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [id, position, height, camera, gl, onSelect]);

  return (
    <group position={[displayPos[0], displayHeight, displayPos[1]]}>
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
      {/* Radius ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.05, radius + 0.05, 32]} />
        <meshBasicMaterial color={colorStr} transparent opacity={0.5} side={2} />
      </mesh>
      {dragging && (
        <Html position={[0, 1.5, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.8)', color: heightMode ? '#88aaff' : '#ffcc00',
            padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
          }}>
            {displayPos[0].toFixed(1)}, {displayPos[1].toFixed(1)}{heightMode ? ` H:${displayHeight.toFixed(1)}` : ''}
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
        />
      ))}
    </group>
  );
}
