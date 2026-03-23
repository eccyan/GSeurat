import React, { useCallback, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();

function DraggableNpc({ id, position, isSelected, onSelect, waypoints }: {
  id: string;
  position: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
  waypoints: [number, number][];
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
      useSceneStore.getState().updateNpc(id, { position: snapped });
      setDragPos(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [id, position, camera, gl, onSelect]);

  return (
    <group key={id}>
      {/* Invisible hit box */}
      <mesh position={displayPos} onPointerDown={handlePointerDown}>
        <cylinderGeometry args={[0.5, 0.5, 1.8, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible mesh */}
      <mesh position={displayPos}>
        <cylinderGeometry args={[0.3, 0.3, 1.5, 8]} />
        <meshStandardMaterial
          color={dragging ? '#ffcc00' : isSelected ? '#ffffff' : '#4fc3f7'}
          transparent
          opacity={dragging ? 0.9 : isSelected ? 0.8 : 0.7}
        />
      </mesh>
      {waypoints.length > 1 && (
        <Line
          points={waypoints.map(([wx, wz]) => [wx, displayPos[1] + 0.1, wz] as [number, number, number])}
          color="#4fc3f7"
          lineWidth={2}
          dashed
          dashSize={0.5}
          gapSize={0.3}
        />
      )}
      {dragging && (
        <Html position={[displayPos[0], displayPos[1] + 1.5, displayPos[2]]} center>
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

export function NpcMarkers() {
  const npcs = useSceneStore((s) => s.npcs);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {npcs.map((npc) => (
        <DraggableNpc
          key={npc.id}
          id={npc.id}
          position={npc.position}
          isSelected={selectedEntity?.type === 'npc' && selectedEntity.id === npc.id}
          onSelect={() => setSelectedEntity({ type: 'npc', id: npc.id })}
          waypoints={npc.waypoints}
        />
      ))}
    </group>
  );
}
