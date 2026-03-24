import React, { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();

export function PlayerMarker() {
  const player = useSceneStore((s) => s.player);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<[number, number, number] | null>(null);
  const [heightMode, setHeightMode] = useState(false);
  const lastClientY = useRef(0);
  const currentY = useRef(0);
  const currentXZ = useRef<[number, number]>([0, 0]);

  const isSelected = selectedEntity?.type === 'player';
  const displayPos = dragPos ?? player.position;

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    setSelectedEntity({ type: 'player', id: 'player' });

    const storeState = useSceneStore.getState();
    if (storeState.mode !== 'scene') return;
    if (storeState.grabMode) return; // Grab plane handles movement

    const el = gl.domElement;
    currentY.current = player.position[1];
    currentXZ.current = [player.position[0], player.position[2]];
    lastClientY.current = e.clientY;
    _plane.set(new THREE.Vector3(0, 1, 0), -player.position[1]);
    setDragging(true);
    setHeightMode(false);

    const onMove = (ev: PointerEvent) => {
      if (ev.shiftKey) {
        setHeightMode(true);
        const deltaY = (lastClientY.current - ev.clientY) * 0.05;
        lastClientY.current = ev.clientY;
        currentY.current = Math.round((currentY.current + deltaY) * 10) / 10;
        setDragPos([currentXZ.current[0], currentY.current, currentXZ.current[1]]);
      } else {
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
      useSceneStore.getState().updatePlayer({ position: snapped });
      setDragPos(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [player.position, camera, gl, setSelectedEntity]);

  if (!showGizmos) return null;

  return (
    <group position={displayPos}>
      {/* Invisible hit box */}
      <mesh position={[0, 0.75, 0]} onPointerDown={handlePointerDown}>
        <cylinderGeometry args={[0.5, 0.5, 2, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible cylinder */}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 1.5, 8]} />
        <meshStandardMaterial
          color={dragging ? '#ffcc00' : isSelected ? '#ffffff' : '#66bb6a'}
          transparent
          opacity={dragging ? 0.9 : isSelected ? 0.8 : 0.7}
        />
      </mesh>
      {/* Direction arrow */}
      <mesh position={[0, 1.8, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.25, 0.5, 8]} />
        <meshStandardMaterial color={dragging ? '#ffcc00' : '#66bb6a'} />
      </mesh>
      {dragging && (
        <Html position={[0, 2.5, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.8)', color: heightMode ? '#88aaff' : '#ffcc00',
            padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
          }}>
            {displayPos[0].toFixed(1)}, {heightMode ? `Y:${displayPos[1].toFixed(1)}` : displayPos[1].toFixed(1)}, {displayPos[2].toFixed(1)}
          </div>
        </Html>
      )}
    </group>
  );
}
