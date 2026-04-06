import React, { useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { VoxelMesh } from './VoxelMesh.js';
import { GroundPlane } from './GroundPlane.js';
import { GhostVoxel } from './GhostVoxel.js';
import { JointGizmos } from './JointGizmos.js';
import { MirrorPlane } from './MirrorPlane.js';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { parseKey } from '../lib/voxelUtils.js';

/** Auto-fits the camera to the voxel bounding box when the voxel count changes significantly. */
function CameraFitter() {
  const voxels = useCharacterStore((s) => s.voxels);
  const gridWidth = useCharacterStore((s) => s.gridWidth);
  const gridDepth = useCharacterStore((s) => s.gridDepth);
  const { camera } = useThree();
  const prevCount = useRef(0);

  useEffect(() => {
    const count = voxels.size;
    // Only auto-fit when going from 0 voxels to some (initial load)
    if (prevCount.current === 0 && count > 0) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const key of voxels.keys()) {
        const [x, y, z] = parseKey(key);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      const extentX = maxX - minX + 1;
      const extentY = maxY - minY + 1;
      const extentZ = maxZ - minZ + 1;
      const maxExtent = Math.max(extentX, extentY, extentZ);

      // Position camera to frame the model
      const dist = maxExtent * 1.8;
      camera.position.set(cx, cy + dist * 0.5, cz + dist);
      (camera as THREE.PerspectiveCamera).lookAt(cx, cy, cz);

      // Update OrbitControls target
      const controls = (camera as any).__r3f_controls;
      if (controls?.target) {
        controls.target.set(cx, cy, cz);
        controls.update();
      }
    }
    prevCount.current = count;
  }, [voxels, camera, gridWidth, gridDepth]);

  return null;
}

export function CharacterViewport() {
  const gridWidth = useCharacterStore((s) => s.gridWidth);
  const gridDepth = useCharacterStore((s) => s.gridDepth);
  const showGrid = useCharacterStore((s) => s.showGrid);

  return (
    <Canvas
      camera={{ position: [gridWidth / 2, 20, gridDepth + 15], fov: 50 }}
      style={{ background: '#16162a' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[20, 40, 30]} intensity={0.8} />
      <directionalLight position={[-10, 20, -20]} intensity={0.3} />

      {showGrid && (
        <Grid
          args={[gridWidth, gridDepth]}
          position={[gridWidth / 2 - 0.5, -0.5, gridDepth / 2 - 0.5]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#334"
          sectionSize={8}
          sectionThickness={1}
          sectionColor="#446"
          fadeDistance={200}
          infiniteGrid={false}
        />
      )}

      <VoxelMesh />
      <GroundPlane />
      <GhostVoxel />
      <JointGizmos />
      <MirrorPlane />
      <CameraFitter />

      <OrbitControls
        target={[gridWidth / 2, 0, gridDepth / 2]}
        makeDefault
        screenSpacePanning
        mouseButtons={{
          LEFT: 0,
          MIDDLE: 1,
          RIGHT: 2,
        }}
        touches={{
          ONE: 0,
          TWO: 1,
        }}
      />
    </Canvas>
  );
}
