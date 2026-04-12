import React, { useRef, useEffect } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
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

/** Ensures R3F renders on first mount when the store has pre-loaded data.
 *  Dispatches a resize event to kick-start the WebGL render loop. */
function InitialInvalidator() {
  useEffect(() => {
    // R3F defers initial rendering until a resize/interaction event.
    // Dispatch resize to ensure the first frame renders immediately.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }, []);
  return null;
}

/** Auto-fits the camera to the voxel bounding box when the voxel count changes significantly. */
function CameraFitter() {
  const voxels = useCharacterStore((s) => s.asset?.voxels ?? new Map());
  const { camera, controls } = useThree();
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
      const maxExtent = Math.max(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1);

      // Position camera to frame the model
      const dist = maxExtent * 1.8;
      camera.position.set(cx, cy + dist * 0.5, cz + dist);
      (camera as THREE.PerspectiveCamera).lookAt(cx, cy, cz);

      // Update OrbitControls target
      const orbitControls = controls as any;
      if (orbitControls?.target) {
        orbitControls.target.set(cx, cy, cz);
        orbitControls.update();
      }
    }
    prevCount.current = count;
  }, [voxels, camera, controls]);

  return null;
}

export function CharacterViewport() {
  useComponentRegistry('CharacterViewport');
  const gridWidth = useCharacterStore((s) => s.asset?.gridWidth ?? 32);
  const gridDepth = useCharacterStore((s) => s.asset?.gridDepth ?? 32);
  const showGrid = useCharacterStore((s) => s.showGrid);

  return (
    <Canvas
      frameloop="always"
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
      <InitialInvalidator />

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
