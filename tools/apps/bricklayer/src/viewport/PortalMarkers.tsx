import React, { useCallback, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();

function DraggablePortal({ id, position, size, isSelected, onSelect, targetScene }: {
  id: string;
  position: [number, number];
  size: [number, number];
  isSelected: boolean;
  onSelect: () => void;
  targetScene: string;
}) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<[number, number] | null>(null);

  const displayPos = dragPos ?? position;

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    onSelect();

    if (useSceneStore.getState().mode !== 'scene') return;

    const el = gl.domElement;
    _plane.set(new THREE.Vector3(0, 1, 0), -1);
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
      useSceneStore.getState().updatePortal(id, { position: snapped });
      setDragPos(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [id, position, camera, gl, onSelect]);

  return (
    <>
      {/* Invisible hit box */}
      <mesh
        position={[displayPos[0] + size[0] / 2, 1, displayPos[1] + size[1] / 2]}
        onPointerDown={handlePointerDown}
      >
        <boxGeometry args={[size[0] + 0.4, 2.4, size[1] + 0.4]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible wireframe */}
      <mesh position={[displayPos[0] + size[0] / 2, 1, displayPos[1] + size[1] / 2]}>
        <boxGeometry args={[size[0], 2, size[1]]} />
        <meshBasicMaterial
          color={dragging ? '#ffcc00' : isSelected ? '#ffffff' : '#ab47bc'}
          wireframe
          transparent
          opacity={dragging ? 0.9 : isSelected ? 0.8 : 0.6}
        />
      </mesh>
      {dragging && (
        <Html position={[displayPos[0] + size[0] / 2, 3, displayPos[1] + size[1] / 2]} center>
          <div style={{
            background: 'rgba(0,0,0,0.8)', color: '#ffcc00',
            padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
          }}>
            {displayPos[0].toFixed(1)}, {displayPos[1].toFixed(1)}
            {targetScene ? ` → ${targetScene}` : ''}
          </div>
        </Html>
      )}
    </>
  );
}

export function PortalMarkers() {
  const portals = useSceneStore((s) => s.portals);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {portals.map((portal) => (
        <DraggablePortal
          key={portal.id}
          id={portal.id}
          position={portal.position}
          size={portal.size}
          isSelected={selectedEntity?.type === 'portal' && selectedEntity.id === portal.id}
          onSelect={() => setSelectedEntity({ type: 'portal', id: portal.id })}
          targetScene={portal.target_scene}
        />
      ))}
    </group>
  );
}
