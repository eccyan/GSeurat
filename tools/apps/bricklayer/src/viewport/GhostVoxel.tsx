import React, { useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';

const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2(-999, -999);

export function GhostVoxel() {
  const [position, setPosition] = useState<[number, number, number] | null>(null);
  const activeColor = useSceneStore((s) => s.activeColor);
  const activeTool = useSceneStore((s) => s.activeTool);
  const { scene, camera, gl } = useThree();

  useFrame(() => {
    if (activeTool !== 'place') {
      if (position) setPosition(null);
      return;
    }

    _raycaster.setFromCamera(_pointer, camera);
    const intersects = _raycaster.intersectObjects(scene.children, true);

    for (const hit of intersects) {
      if (!hit.face) continue;
      const n = hit.face.normal;
      const p = hit.point;
      const x = Math.round(p.x + n.x * 0.5);
      const y = Math.round(p.y + n.y * 0.5);
      const z = Math.round(p.z + n.z * 0.5);
      setPosition([x, y, z]);
      return;
    }
    if (position) setPosition(null);
  });

  // Track pointer
  React.useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      _pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    el.addEventListener('pointermove', onMove);
    return () => el.removeEventListener('pointermove', onMove);
  }, [gl]);

  if (!position) return null;

  return (
    <mesh position={position}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={`rgb(${activeColor[0]},${activeColor[1]},${activeColor[2]})`}
        transparent
        opacity={0.4}
        depthWrite={false}
      />
    </mesh>
  );
}
