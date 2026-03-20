import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { VoxelMesh } from './VoxelMesh.js';
import { GroundPlane } from './GroundPlane.js';
import { GhostVoxel } from './GhostVoxel.js';
import { LightGizmos } from './LightGizmos.js';
import { NpcMarkers } from './NpcMarkers.js';
import { PortalMarkers } from './PortalMarkers.js';
import { PlayerMarker } from './PlayerMarker.js';
import { CollisionOverlay } from './CollisionOverlay.js';
import { useSceneStore } from '../store/useSceneStore.js';

export function Viewport() {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const showGrid = useSceneStore((s) => s.showGrid);

  return (
    <Canvas
      camera={{ position: [gridWidth / 2, 30, gridDepth + 20], fov: 50 }}
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
      <LightGizmos />
      <NpcMarkers />
      <PortalMarkers />
      <PlayerMarker />
      <CollisionOverlay />

      <OrbitControls
        target={[gridWidth / 2, 0, gridDepth / 2]}
        makeDefault
        screenSpacePanning
        mouseButtons={{
          LEFT: 0,
          MIDDLE: 2,
          RIGHT: 1,
        }}
      />
    </Canvas>
  );
}
