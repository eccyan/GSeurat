import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useVfxStore } from '../store/useVfxStore.js';
import type { VfxLayer } from '../store/types.js';
import type { PlyPoint } from '../lib/plyLoader.js';
import { ParticleSystem } from './ParticleSystem.js';

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

// ── Layer Gizmos ──

function EmitterGizmo({ layer, active, selected }: { layer: VfxLayer; active: boolean; selected: boolean }) {
  const cfg = layer.emitter as Record<string, unknown> | undefined;
  const pos: [number, number, number] = (cfg?.position as [number, number, number]) ?? [0, 1, 0];
  const offsetMin = (cfg?.spawn_offset_min as [number, number, number]) ?? [0, 0, 0];
  const offsetMax = (cfg?.spawn_offset_max as [number, number, number]) ?? [0, 0, 0];
  const hasOffset = offsetMin.some((v) => v !== 0) || offsetMax.some((v) => v !== 0);
  const boxSize: [number, number, number] = [
    offsetMax[0] - offsetMin[0] || 0.5,
    offsetMax[1] - offsetMin[1] || 0.5,
    offsetMax[2] - offsetMin[2] || 0.5,
  ];
  const boxCenter: [number, number, number] = [
    pos[0] + (offsetMin[0] + offsetMax[0]) / 2,
    pos[1] + (offsetMin[1] + offsetMax[1]) / 2,
    pos[2] + (offsetMin[2] + offsetMax[2]) / 2,
  ];
  const opacity = active ? 0.7 : 0.2;
  const color = selected ? '#ffffff' : '#ec4899';

  return (
    <group>
      {/* Center sphere */}
      <mesh position={pos}>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.8 : 0.3} />
      </mesh>
      {/* Outer glow when active */}
      {active && (
        <mesh position={pos}>
          <sphereGeometry args={[0.5, 12, 12]} />
          <meshBasicMaterial color="#ec4899" transparent opacity={0.2} />
        </mesh>
      )}
      {/* Spawn offset box */}
      {hasOffset && (
        <mesh position={boxCenter}>
          <boxGeometry args={boxSize} />
          <meshBasicMaterial color="#ec4899" wireframe transparent opacity={opacity * 0.5} />
        </mesh>
      )}
    </group>
  );
}

function AnimationGizmo({ layer, active, selected }: { layer: VfxLayer; active: boolean; selected: boolean }) {
  const anim = layer.animation as Record<string, unknown> | undefined;
  const effect = (anim?.effect as string) ?? 'detach';
  const opacity = active ? 0.5 : 0.15;
  const color = selected ? '#ffffff' : '#06b6d4';

  return (
    <group position={[0, 1, 0]}>
      {/* Region sphere */}
      <mesh>
        <sphereGeometry args={[2, 16, 12]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={opacity} />
      </mesh>
      {/* Center dot */}
      <mesh>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={active ? 1 : 0.4} />
      </mesh>
    </group>
  );
}

function LightGizmo({ layer, active, selected }: { layer: VfxLayer; active: boolean; selected: boolean }) {
  const light = layer.light;
  const radius = light?.radius ?? 50;
  const color = light ? `rgb(${Math.round(light.color[0] * 255)},${Math.round(light.color[1] * 255)},${Math.round(light.color[2] * 255)})` : '#ffff00';
  const displayRadius = Math.min(radius * 0.1, 5); // Scale down for viewport
  const opacity = active ? 0.7 : 0.2;

  return (
    <group position={[0, 2, 0]}>
      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial color={selected ? '#ffffff' : color} transparent opacity={active ? 0.9 : 0.4} />
      </mesh>
      {/* Radius ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[displayRadius - 0.05, displayRadius + 0.05, 32]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} side={2} />
      </mesh>
      {/* Flash burst when active */}
      {active && (
        <mesh>
          <sphereGeometry args={[displayRadius * 0.5, 12, 12]} />
          <meshBasicMaterial color={color} transparent opacity={0.15} />
        </mesh>
      )}
    </group>
  );
}

function LayerGizmos() {
  const preset = useVfxStore((s) => {
    return s.presets.find((p) => p.id === s.selectedPresetId);
  });
  const playbackTime = useVfxStore((s) => s.playbackTime);
  const selectedLayerId = useVfxStore((s) => s.selectedLayerId);
  const lightRef = useRef<THREE.PointLight>(null);

  // Update dynamic point light for light layers
  useFrame(() => {
    if (!lightRef.current || !preset) return;
    const activeLight = preset.layers.find((l) =>
      l.type === 'light' && l.light &&
      playbackTime >= l.start && playbackTime < l.start + l.duration
    );
    if (activeLight?.light) {
      lightRef.current.visible = true;
      lightRef.current.intensity = activeLight.light.intensity;
      lightRef.current.color.setRGB(activeLight.light.color[0], activeLight.light.color[1], activeLight.light.color[2]);
      lightRef.current.distance = activeLight.light.radius;
    } else {
      lightRef.current.visible = false;
    }
  });

  if (!preset) return null;

  return (
    <group>
      <pointLight ref={lightRef} position={[0, 2, 0]} visible={false} />
      {preset.layers.map((layer) => {
        const active = playbackTime >= layer.start && playbackTime < layer.start + layer.duration;
        const selected = selectedLayerId === layer.id;
        if (layer.type === 'emitter') return <EmitterGizmo key={layer.id} layer={layer} active={active} selected={selected} />;
        if (layer.type === 'animation') return <AnimationGizmo key={layer.id} layer={layer} active={active} selected={selected} />;
        if (layer.type === 'light') return <LightGizmo key={layer.id} layer={layer} active={active} selected={selected} />;
        return null;
      })}
    </group>
  );
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
        <LayerGizmos />
        <ParticleSystem />
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
