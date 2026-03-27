import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useVfxStore } from '../store/useVfxStore.js';
import type { PlyPoint } from '../lib/plyLoader.js';

// ── Gaussian Point Cloud (imported PLY data) ──

function GaussianPointCloud({ points }: { points: PlyPoint[] }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i].position[0];
      positions[i * 3 + 1] = points[i].position[1];
      positions[i * 3 + 2] = points[i].position[2];
      colors[i * 3] = points[i].color[0];
      colors[i * 3 + 1] = points[i].color[1];
      colors[i * 3 + 2] = points[i].color[2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [points]);

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.15} vertexColors sizeAttenuation />
    </points>
  );
}

// ── Active Layer Indicators ──

function ActiveLayers() {
  const preset = useVfxStore((s) => {
    const p = s.presets.find((p) => p.id === s.selectedPresetId);
    return p;
  });
  const playbackTime = useVfxStore((s) => s.playbackTime);
  const lightRef = useRef<THREE.PointLight>(null);

  // Find active layers at current playback time
  const activeLayers = useMemo(() => {
    if (!preset) return [];
    return preset.layers.filter((l) =>
      playbackTime >= l.start && playbackTime < l.start + l.duration
    );
  }, [preset, playbackTime]);

  // Update light flash
  useFrame(() => {
    if (!lightRef.current) return;
    const lightLayer = activeLayers.find((l) => l.type === 'light');
    if (lightLayer?.light) {
      lightRef.current.visible = true;
      lightRef.current.intensity = lightLayer.light.intensity;
      lightRef.current.color.setRGB(
        lightLayer.light.color[0],
        lightLayer.light.color[1],
        lightLayer.light.color[2]
      );
      lightRef.current.distance = lightLayer.light.radius;
    } else {
      lightRef.current.visible = false;
    }
  });

  // Emitter particle indicators (simple spheres at origin)
  const emitterLayers = activeLayers.filter((l) => l.type === 'emitter');
  const animLayers = activeLayers.filter((l) => l.type === 'animation');

  return (
    <group>
      <pointLight ref={lightRef} position={[0, 2, 0]} visible={false} />
      {emitterLayers.map((l) => (
        <mesh key={l.id} position={[0, 1, 0]}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshBasicMaterial color="#ec4899" transparent opacity={0.5} wireframe />
        </mesh>
      ))}
      {animLayers.map((l) => (
        <mesh key={l.id} position={[0, 1, 0]}>
          <sphereGeometry args={[0.5, 12, 12]} />
          <meshBasicMaterial color="#06b6d4" transparent opacity={0.3} wireframe />
        </mesh>
      ))}
    </group>
  );
}

// ── Phase Indicator ──

function PhaseIndicator() {
  const preset = useVfxStore((s) => {
    const p = s.presets.find((p) => p.id === s.selectedPresetId);
    return p;
  });
  const playbackTime = useVfxStore((s) => s.playbackTime);

  if (!preset) return null;

  let phase = 'Idle';
  let color = '#666';
  if (playbackTime < preset.phases.anticipation) {
    phase = 'Anticipation';
    color = '#f59e0b';
  } else if (playbackTime < preset.phases.impact) {
    phase = 'Impact';
    color = '#ef4444';
  } else if (playbackTime < preset.duration) {
    phase = 'Residual';
    color = '#3b82f6';
  }

  return null; // Phase shown in HTML overlay instead
}

// ── Main Preview Component ──

export function Preview({ scenePoints }: { scenePoints: PlyPoint[] }) {
  const preset = useVfxStore((s) => {
    const p = s.presets.find((p) => p.id === s.selectedPresetId);
    return p;
  });
  const playbackTime = useVfxStore((s) => s.playbackTime);

  // Determine current phase for overlay
  let phaseName = '';
  let phaseColor = '#666';
  if (preset) {
    if (playbackTime < preset.phases.anticipation) {
      phaseName = 'Anticipation';
      phaseColor = '#f59e0b';
    } else if (playbackTime < preset.phases.impact) {
      phaseName = 'Impact';
      phaseColor = '#ef4444';
    } else if (playbackTime < preset.duration) {
      phaseName = 'Residual';
      phaseColor = '#3b82f6';
    }
  }

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <Canvas camera={{ position: [10, 10, 10], fov: 50 }} style={{ background: '#0f0f1e' }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={0.6} />
        <Grid args={[40, 40]} cellSize={1} cellColor="#1a1a3a" sectionSize={5} sectionColor="#2a2a4a" fadeDistance={30} infiniteGrid={false} />
        {scenePoints.length > 0 && <GaussianPointCloud points={scenePoints} />}
        <ActiveLayers />
        <OrbitControls />
      </Canvas>

      {/* Phase overlay */}
      {phaseName && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          padding: '2px 8px', borderRadius: 3,
          background: `${phaseColor}20`, border: `1px solid ${phaseColor}40`,
          color: phaseColor, fontSize: 10, letterSpacing: 1,
          textTransform: 'uppercase', pointerEvents: 'none',
        }}>
          {phaseName}
        </div>
      )}

      {/* Scene info */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        fontSize: 9, color: '#50506a', pointerEvents: 'none',
      }}>
        {scenePoints.length > 0 ? `${scenePoints.length.toLocaleString()} points` : 'No scene loaded — File > Import Scene'}
      </div>
    </div>
  );
}
