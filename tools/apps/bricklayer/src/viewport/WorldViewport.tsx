import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { OrbitControls } from '@react-three/drei';
import { chunkAabbMin, chunkGridKey, type WorldChunk, type StreamingVolumeData } from '@gseurat/project-root';
import { useWorldStore } from '../store/useWorldStore.js';

// ── ChunkBox ──

function ChunkBox({
  min,
  size,
  color,
  onClick,
}: {
  min: [number, number, number];
  size: [number, number, number];
  color: string;
  onClick: () => void;
}) {
  const cx = min[0] + size[0] / 2;
  const cy = min[1] + size[1] / 2;
  const cz = min[2] + size[2] / 2;

  const geo = useMemo(() => new THREE.BoxGeometry(size[0], size[1], size[2]), [size[0], size[1], size[2]]);

  return (
    <group position={[cx, cy, cz]}>
      {/* invisible hit target */}
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }} visible={false}>
        <boxGeometry args={[size[0], size[1], size[2]]} />
        <meshBasicMaterial />
      </mesh>
      {/* wireframe edges */}
      <lineSegments>
        <edgesGeometry args={[geo]} />
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  );
}

// ── VolumeBox ──

function VolumeBox({
  position,
  halfExtents,
  color,
  onClick,
}: {
  position: [number, number, number];
  halfExtents: [number, number, number];
  color: string;
  onClick: () => void;
}) {
  const sx = halfExtents[0] * 2;
  const sy = halfExtents[1] * 2;
  const sz = halfExtents[2] * 2;
  const geo = useMemo(() => new THREE.BoxGeometry(sx, sy, sz), [sx, sy, sz]);

  return (
    <group position={position}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }} visible={false}>
        <boxGeometry args={[sx, sy, sz]} />
        <meshBasicMaterial />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geo]} />
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  );
}

// ── VolumeSphere ──

function VolumeSphere({
  position,
  radius,
  color,
  onClick,
}: {
  position: [number, number, number];
  radius: number;
  color: string;
  onClick: () => void;
}) {
  return (
    <group position={position}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }} visible={false}>
        <sphereGeometry args={[radius + 0.4, 12, 8]} />
        <meshBasicMaterial />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius, 16, 10]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

// ── WorldSceneContent ──

function WorldSceneContent() {
  const manifest = useWorldStore((s) => s.manifest);
  const selectedEntity = useWorldStore((s) => s.selectedEntity);
  const setSelectedEntity = useWorldStore((s) => s.setSelectedEntity);

  const cellSize = manifest.grid_cell_size;
  const gridDivisions = 64;
  const gridSize = 512;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 100, 50]} intensity={0.8} />

      {/* Ground grid */}
      <gridHelper
        args={[gridSize, gridDivisions, '#334466', '#223344']}
        position={[0, -0.01, 0]}
      />

      {/* Chunks */}
      {manifest.chunks.map((chunk: WorldChunk) => {
        const key = chunkGridKey(chunk.grid);
        const min = chunkAabbMin(chunk.grid, cellSize);
        const isSelected = selectedEntity?.type === 'chunk' && selectedEntity.id === key;
        const color = isSelected ? '#4488ff' : chunk.ply_file ? '#44cc66' : '#888888';
        return (
          <ChunkBox
            key={key}
            min={min}
            size={cellSize}
            color={color}
            onClick={() => setSelectedEntity({ type: 'chunk', id: key })}
          />
        );
      })}

      {/* Streaming Volumes */}
      {manifest.streaming_volumes.map((sv: StreamingVolumeData) => {
        const isSelected = selectedEntity?.type === 'streaming_volume' && selectedEntity.id === sv.id;
        const color = isSelected ? '#ffaa00' : '#ff8800';
        if (sv.shape === 'sphere') {
          return (
            <VolumeSphere
              key={sv.id}
              position={sv.position}
              radius={sv.radius ?? 8}
              color={color}
              onClick={() => setSelectedEntity({ type: 'streaming_volume', id: sv.id })}
            />
          );
        }
        return (
          <VolumeBox
            key={sv.id}
            position={sv.position}
            halfExtents={sv.half_extents ?? [8, 8, 8]}
            color={color}
            onClick={() => setSelectedEntity({ type: 'streaming_volume', id: sv.id })}
          />
        );
      })}

      <OrbitControls
        target={[0, 0, 0]}
        makeDefault
        screenSpacePanning
        mouseButtons={{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }}
        touches={{ ONE: 0, TWO: 1 }}
      />
    </>
  );
}

// ── WorldViewport ──

export function WorldViewport() {
  useComponentRegistry('WorldViewport');
  return <WorldSceneContent />;
}
