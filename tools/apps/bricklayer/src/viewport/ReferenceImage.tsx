import React, { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';

function ReferenceImagePlane({ url }: { url: string }) {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);

  const texture = useMemo(() => {
    const tex = new THREE.TextureLoader().load(url);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [url]);

  // Position: centered on the voxel grid, on the X,Y plane (facing +Z toward camera)
  // The image width maps to gridWidth (X), height maps to gridDepth (Y)
  return (
    <mesh
      position={[gridWidth / 2 - 0.5, gridDepth / 2 - 0.5, -1]}
      renderOrder={-1}
    >
      <planeGeometry args={[gridWidth, gridDepth]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export function ReferenceImage() {
  const url = useSceneStore((s) => s.referenceImageUrl);
  const show = useSceneStore((s) => s.showReferenceImage);

  if (!show || !url) return null;

  return <ReferenceImagePlane url={url} />;
}
