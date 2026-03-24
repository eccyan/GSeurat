import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const [heightMode, setHeightMode] = useState(false);
  const lastClientY = useRef(0);
  const currentY = useRef(0);
  const currentXZ = useRef<[number, number]>([0, 0]);

  const grabMode = useSceneStore((s) => s.grabMode);

  // Clear local drag state when grab mode activates
  useEffect(() => {
    if (grabMode) {
      setDragging(false);
      setDragPos(null);
      setHeightMode(false);
    }
  }, [grabMode]);

  const displayPos = dragPos ?? position;

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    onSelect();

    const storeState = useSceneStore.getState();
    if (storeState.mode !== 'scene') return;
    if (storeState.grabMode) return; // Grab plane handles movement

    const el = gl.domElement;
    currentY.current = position[1];
    currentXZ.current = [position[0], position[2]];
    lastClientY.current = e.clientY;
    _plane.set(new THREE.Vector3(0, 1, 0), -position[1]);
    setDragging(true);
    setHeightMode(false);

    const onMove = (ev: PointerEvent) => {
      if (ev.shiftKey) {
        // Shift held: vertical mouse movement adjusts Y
        setHeightMode(true);
        const deltaY = (lastClientY.current - ev.clientY) * 0.05;
        lastClientY.current = ev.clientY;
        currentY.current = Math.round((currentY.current + deltaY) * 10) / 10;
        setDragPos([currentXZ.current[0], currentY.current, currentXZ.current[1]]);
      } else {
        // Normal XZ plane drag
        setHeightMode(false);
        lastClientY.current = ev.clientY;
        const rect = el.getBoundingClientRect();
        const pointer = new THREE.Vector2(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        _plane.set(new THREE.Vector3(0, 1, 0), -currentY.current);
        _raycaster.setFromCamera(pointer, camera);
        if (_raycaster.ray.intersectPlane(_plane, _intersection)) {
          const sx = Math.round(_intersection.x * 10) / 10;
          const sz = Math.round(_intersection.z * 10) / 10;
          currentXZ.current = [sx, sz];
          setDragPos([sx, currentY.current, sz]);
        }
      }
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      setDragging(false);
      setHeightMode(false);
      const snapped: [number, number, number] = [
        currentXZ.current[0],
        currentY.current,
        currentXZ.current[1],
      ];
      useSceneStore.getState().updatePlacedObject(id, { position: snapped });
      setDragPos(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [id, position, camera, gl, onSelect]);

  return (
    <>
      {/* Invisible solid mesh for click/drag detection */}
      <mesh
        position={displayPos}
        onPointerDown={handlePointerDown}
      >
        <boxGeometry args={[scale * 1.2, scale * 1.2, scale * 1.2]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible wireframe */}
      <mesh position={displayPos}>
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
            background: 'rgba(0,0,0,0.8)', color: heightMode ? '#88aaff' : '#ffcc00',
            padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
          }}>
            {displayPos[0].toFixed(1)}, {heightMode ? `Y:${displayPos[1].toFixed(1)}` : displayPos[1].toFixed(1)}, {displayPos[2].toFixed(1)}
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
