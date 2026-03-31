import React, { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';
import type { GsParticleEmitterData } from '../store/types.js';
import { sampleCatmullRom } from '@gseurat/vfx-utils';

function SplineGizmo({ emitter, isSelected }: {
  emitter: GsParticleEmitterData;
  isSelected: boolean;
}) {
  const spline = emitter.spline;
  const points = spline?.control_points;

  const curvePoints = useMemo(
    () => (points && points.length >= 2) ? sampleCatmullRom(points, 64) : null,
    [points],
  );

  if (!spline || !curvePoints) return null;

  const color = spline.mode === 'emitter_path' ? '#22c55e' : '#f97316';
  const opacity = isSelected ? 0.8 : 0.3;

  return (
    <>
      {/* Smooth spline curve */}
      <Line
        points={curvePoints}
        color={color}
        lineWidth={isSelected ? 3 : 1.5}
        opacity={opacity}
        transparent
      />
      {/* Control point handles */}
      {spline.control_points.map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[isSelected ? 0.25 : 0.15, 8, 8]} />
          <meshBasicMaterial color={color} opacity={opacity} transparent />
        </mesh>
      ))}
    </>
  );
}

function EmitterMarker({ emitter, isSelected, onSelect }: {
  emitter: GsParticleEmitterData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const label = emitter.preset || 'Custom';
  const region = emitter.spawn_region;
  const regionCenter = region?.center ?? [0, 0, 0];

  return (
    <group position={[emitter.position[0], emitter.position[1], emitter.position[2]]}>
      {/* Invisible hit box */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[1.0, 12, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Outer glow */}
      <mesh>
        <sphereGeometry args={[0.7, 12, 12]} />
        <meshBasicMaterial
          color={isSelected ? '#ffffff' : '#ff4dc8'}
          transparent
          opacity={0.3}
        />
      </mesh>
      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshBasicMaterial color={isSelected ? '#ffffff' : '#ff4dc8'} />
      </mesh>
      {/* Spawn region wireframe */}
      {region && (
        <mesh position={[regionCenter[0], regionCenter[1], regionCenter[2]]}>
          {(region.shape ?? 'sphere') === 'sphere' ? (
            <sphereGeometry args={[region.radius ?? 1, 16, 12]} />
          ) : (
            <boxGeometry args={[
              (region.half_extents?.[0] ?? 1) * 2,
              (region.half_extents?.[1] ?? 1) * 2,
              (region.half_extents?.[2] ?? 1) * 2,
            ]} />
          )}
          <meshBasicMaterial
            color={isSelected ? '#ffffff' : '#ff4dc8'}
            wireframe
            transparent
            opacity={isSelected ? 0.3 : 0.15}
          />
        </mesh>
      )}
      {/* Spline path gizmo */}
      <SplineGizmo emitter={emitter} isSelected={isSelected} />
      {/* Label */}
      {isSelected && (
        <Html position={[0, 1.2, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#ff80dd',
            padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
          }}>
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

export function GsEmitterMarkers() {
  const emitters = useSceneStore((s) => s.gsParticleEmitters);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {emitters.map((e) => (
        <EmitterMarker
          key={e.id}
          emitter={e}
          isSelected={selectedEntity?.type === 'gs_emitter' && selectedEntity.id === e.id}
          onSelect={() => setSelectedEntity({ type: 'gs_emitter', id: e.id })}
        />
      ))}
    </group>
  );
}
