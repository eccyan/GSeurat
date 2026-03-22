import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { VoxelMesh } from './VoxelMesh.js';
import { GroundPlane } from './GroundPlane.js';
import { GhostVoxel } from './GhostVoxel.js';
import { JointGizmos } from './JointGizmos.js';
import { MirrorPlane } from './MirrorPlane.js';
import { useCharacterStore } from '../store/useCharacterStore.js';

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
