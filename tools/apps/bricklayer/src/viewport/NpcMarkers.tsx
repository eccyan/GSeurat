import React, { useCallback, useRef, useState } from 'react';
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
  const [heightMode, setHeightMode] = useState(false);
  const lastClientY = useRef(0);
  const currentY = useRef(0);
  const currentXZ = useRef<[number, number]>([0, 0]);

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
