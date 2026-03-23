import React, { useCallback, useState } from 'react';
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

  const isSelected = selectedEntity?.type === 'player';
  const displayPos = dragPos ?? player.position;

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    setSelectedEntity({ type: 'player', id: 'player' });

    if (useSceneStore.getState().mode !== 'scene') return;

    const el = gl.domElement;
    _plane.set(new THREE.Vector3(0, 1, 0), -player.position[1]);
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
          player.position[1],
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
        player.position[1],
        Math.round(_intersection.z * 10) / 10,
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
            background: 'rgba(0,0,0,0.8)', color: '#ffcc00',
            padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
          }}>
            {displayPos[0].toFixed(1)}, {displayPos[1].toFixed(1)}, {displayPos[2].toFixed(1)}
          </div>
        </Html>
      )}
    </group>
  );
}
