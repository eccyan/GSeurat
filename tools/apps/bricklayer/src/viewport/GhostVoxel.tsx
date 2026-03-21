import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';

const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2(-999, -999);

export function GhostVoxel() {
  const meshRef = useRef<THREE.Mesh>(null);
  const activeColor = useSceneStore((s) => s.activeColor);
  const activeTool = useSceneStore((s) => s.activeTool);
  const { scene, camera, gl } = useThree();

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (activeTool !== 'place') {
      mesh.visible = false;
      return;
    }

    _raycaster.setFromCamera(_pointer, camera);

    // Collect raycast targets, excluding the ghost mesh itself
    const targets: THREE.Object3D[] = [];
    for (const child of scene.children) {
      if (child === mesh) continue;
      targets.push(child);
    }

    const intersects = _raycaster.intersectObjects(targets, true);

    for (const hit of intersects) {
      if (!hit.face) continue;
      const n = hit.face.normal;
      const p = hit.point;
      mesh.position.set(
        Math.round(p.x + n.x * 0.5),
        Math.round(p.y + n.y * 0.5),
        Math.round(p.z + n.z * 0.5),
      );
      mesh.visible = true;
      return;
    }

    mesh.visible = false;
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

  return (
    <mesh ref={meshRef} visible={false}>
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
