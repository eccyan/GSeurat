import React, { useCallback, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();

function DraggableMarker({ id, position, scale, color, isSelected, onSelect }: {
  id: string;
  position: [number, number, number];
  scale: number;
  color: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<[number, number, number] | null>(null);

  const displayPos = dragPos ?? position;

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    onSelect();

    if (useSceneStore.getState().mode !== 'scene') return;

    const el = gl.domElement;
    _plane.set(new THREE.Vector3(0, 1, 0), -position[1]);
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
          position[1],
          Math.round(_intersection.z * 10) / 10,
        ]);
      }
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      setDragging(false);
      const snapped: [number, number, number] = [
        Math.round(_intersection.x * 10) / 10,
        position[1],
        Math.round(_intersection.z * 10) / 10,
      ];
      useSceneStore.getState().updatePlacedObject(id, { position: snapped });
      setDragPos(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [id, position, camera, gl, onSelect]);

  return (
    <>
      <mesh
        position={displayPos}
        onPointerDown={handlePointerDown}
      >
        <boxGeometry args={[scale, scale, scale]} />
        <meshBasicMaterial
          color={dragging ? '#ffcc00' : isSelected ? '#ffffff' : color}
          wireframe
          transparent
          opacity={dragging ? 0.9 : isSelected ? 0.8 : 0.6}
        />
      </mesh>
      {dragging && (
        <Html position={[displayPos[0], displayPos[1] + scale + 0.5, displayPos[2]]} center>
          <div style={{
            background: 'rgba(0,0,0,0.8)', color: '#ffcc00',
            padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
          }}>
            {displayPos[0].toFixed(1)}, {displayPos[1].toFixed(1)}, {displayPos[2].toFixed(1)}
          </div>
        </Html>
      )}
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
        <DraggableMarker
          key={obj.id}
          id={obj.id}
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
