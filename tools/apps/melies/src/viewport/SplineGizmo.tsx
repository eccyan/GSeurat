import React, { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { VfxElement, SplineConfig } from '../store/types.js';
import { sampleCatmullRom } from '../lib/catmullRom.js';

export function SplineGizmo({ layer, selected }: { layer: VfxElement; selected: boolean }) {
  const spline = layer.emitter?.spline as SplineConfig | undefined;
  if (!spline || !spline.mode || !spline.control_points || spline.control_points.length < 2) {
    return null;
  }

  const color = spline.mode === 'emitter_path' ? '#22c55e' : '#f97316';
  const opacity = selected ? 0.8 : 0.3;

  const curvePoints = useMemo(
    () => sampleCatmullRom(spline.control_points, 64),
    [spline.control_points],
  );

  return (
    <group position={layer.position ?? [0, 0, 0]}>
      {/* Smooth spline curve */}
      <Line
        points={curvePoints}
        color={color}
        lineWidth={selected ? 3 : 1.5}
        opacity={opacity}
        transparent
      />
      {/* Control point handles */}
      {spline.control_points.map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[selected ? 0.25 : 0.15, 8, 8]} />
          <meshBasicMaterial color={color} opacity={opacity} transparent />
        </mesh>
      ))}
    </group>
  );
}
