import React, { useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { VoxelMesh } from './VoxelMesh.js';
import { GroundPlane } from './GroundPlane.js';
import { GhostVoxel } from './GhostVoxel.js';
import { LightGizmos } from './LightGizmos.js';
import { NpcMarkers } from './NpcMarkers.js';
import { PortalMarkers } from './PortalMarkers.js';
import { ObjectMarkers } from './ObjectMarkers.js';
import { PlayerMarker } from './PlayerMarker.js';
import { CollisionOverlay } from './CollisionOverlay.js';
import { useSceneStore } from '../store/useSceneStore.js';

// Module-level ref so App.tsx can access the orbit controls for F/Home keys
type OrbitControlsRef = {
  target: THREE.Vector3;
  object: THREE.Camera;
  update: () => void;
};
let orbitControlsRef: OrbitControlsRef | null = null;

export function getOrbitControls(): OrbitControlsRef | null {
  return orbitControlsRef;
}

/**
 * Transparent raycast plane for double-click teleport.
 * Covers a large area at Y=0.
 */
function TeleportPlane() {
  const { raycaster, pointer, camera } = useThree();
  const planeRef = useRef<THREE.Mesh>(null);

  const handleDoubleClick = useCallback(() => {
    if (!planeRef.current || !orbitControlsRef) return;

    raycaster.setFromCamera(pointer, camera);

    // Raycast against scene objects first, then fall back to ground plane
    const scene = planeRef.current.parent;
    if (!scene) return;

    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length > 0) {
      const hit = intersects[0].point;
      orbitControlsRef.target.set(hit.x, hit.y, hit.z);
      orbitControlsRef.update();
    }
  }, [raycaster, pointer, camera]);

  return (
    <mesh
      ref={planeRef}
      position={[0, -0.01, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      visible={false}
      onDoubleClick={handleDoubleClick}
    >
      <planeGeometry args={[2000, 2000]} />
      <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
    </mesh>
  );
}

function SceneContent() {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const showGrid = useSceneStore((s) => s.showGrid);
  const grabMode = useSceneStore((s) => s.grabMode);
  const controlsRef = useRef<OrbitControlsRef | null>(null);

  return (
    <>
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
      <LightGizmos />
      <NpcMarkers />
      <PortalMarkers />
      <ObjectMarkers />
      <PlayerMarker />
      <CollisionOverlay />
      <TeleportPlane />

      <OrbitControls
        ref={(r: OrbitControlsRef | null) => {
          controlsRef.current = r;
          orbitControlsRef = r;
        }}
        enabled={!grabMode}
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
    </>
  );
}

export function Viewport() {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);

  return (
    <Canvas
      camera={{ position: [gridWidth / 2, 30, gridDepth + 20], fov: 50 }}
      style={{ background: '#16162a' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <SceneContent />
    </Canvas>
  );
}
