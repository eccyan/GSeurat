import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useVfxStore, playbackTimeRef } from '../store/useVfxStore.js';
import type { VfxElement as VfxLayer } from '../store/types.js';
import { loadPly, type PlyPoint } from '../lib/plyLoader.js';
import { loadPlyFromProject } from '../lib/projectIO.js';
import { ParticleSystem } from './ParticleSystem.js';
import { AnimationSystem } from './AnimationSystem.js';

// ── Gaussian Point Cloud (imported PLY data, updatable by AnimationSystem) ──

function GaussianPointCloud({ points, geoRef }: { points: PlyPoint[]; geoRef: React.MutableRefObject<THREE.BufferGeometry | null> }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const n = points.length;
    const positions = new Float32Array(n * 3);
    const aColor = new Float32Array(n * 4);
    const aScale = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = points[i].position[0];
      positions[i * 3 + 1] = points[i].position[1];
      positions[i * 3 + 2] = points[i].position[2];
      aColor[i * 4] = points[i].color[0];
      aColor[i * 4 + 1] = points[i].color[1];
      aColor[i * 4 + 2] = points[i].color[2];
      aColor[i * 4 + 3] = 1.0;
      aScale[i] = 1.0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aScale', new THREE.BufferAttribute(aScale, 1).setUsage(THREE.DynamicDrawUsage));
    return geo;
  }, [points]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: window.devicePixelRatio || 1.0 },
    },
    vertexShader: `
      attribute vec4 aColor;
      attribute float aScale;
      uniform float uPixelRatio;
      varying vec4 vColor;
      void main() {
        vColor = aColor;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(3.0 * aScale, 0.5) * uPixelRatio * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec4 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float alpha = vColor.a * smoothstep(0.5, 0.2, d);
        gl_FragColor = vec4(vColor.rgb, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  }), []);

  useEffect(() => { geoRef.current = geometry; }, [geometry, geoRef]);

  return <points geometry={geometry} material={material} />;
}

// ── Layer Gizmos ──

type GizmoProps = { layer: VfxLayer; active: boolean; selected: boolean; onSelect: () => void };

function ObjectGizmo({ layer, selected, onSelect }: GizmoProps) {
  const pos = layer.position ?? [0, 0, 0];
  const scale = layer.scale ?? 1;
  const [points, setPoints] = useState<PlyPoint[]>([]);

  // Load PLY file from project directory
  useEffect(() => {
    if (!layer.ply_file) return;
    const store = useVfxStore.getState();
    if (store.projectHandle) {
      loadPlyFromProject(store.projectHandle, layer.ply_file).then(async (file) => {
        if (file) {
          const pts = await loadPly(file);
          setPoints(pts);
        }
      });
    }
  }, [layer.ply_file]);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    const n = points.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = points[i].position[0] * scale;
      positions[i * 3 + 1] = points[i].position[1] * scale;
      positions[i * 3 + 2] = points[i].position[2] * scale;
      colors[i * 4] = points[i].color[0];
      colors[i * 4 + 1] = points[i].color[1];
      colors[i * 4 + 2] = points[i].color[2];
      colors[i * 4 + 3] = 1.0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 4));
    geo.setAttribute('aScale', new THREE.BufferAttribute(new Float32Array(n).fill(1.0), 1));
    return geo;
  }, [points, scale]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: window.devicePixelRatio || 1.0 } },
    vertexShader: `
      attribute vec4 aColor;
      attribute float aScale;
      uniform float uPixelRatio;
      varying vec4 vColor;
      void main() {
        vColor = aColor;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(3.0 * aScale, 0.5) * uPixelRatio * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec4 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float alpha = vColor.a * smoothstep(0.5, 0.2, d);
        gl_FragColor = vec4(vColor.rgb, alpha);
      }
    `,
    transparent: true, depthWrite: false,
  }), []);

  return (
    <group position={pos}>
      {/* Clickable marker (always visible) */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <octahedronGeometry args={[0.3]} />
        <meshBasicMaterial color={selected ? '#ffffff' : '#aaaaaa'} transparent opacity={selected ? 0.9 : 0.4} />
      </mesh>
      {/* PLY point cloud */}
      {geometry && <points geometry={geometry} material={material} />}
    </group>
  );
}

function EmitterGizmo({ layer, active, selected, onSelect }: GizmoProps) {
  const pos = layer.position ?? [0, 0, 0];
  const color = selected ? '#ffffff' : '#ec4899';
  const cfg = layer.emitter as Record<string, unknown> | undefined;
  const region = cfg?.region as { shape?: string; center?: [number, number, number]; radius?: number; half_extents?: [number, number, number] } | undefined;
  const regionCenter = region?.center ?? [0, 0, 0];
  return (
    <group position={pos}>
      {/* Center sphere */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.8 : 0.3} />
      </mesh>
      {active && (
        <mesh>
          <sphereGeometry args={[0.5, 12, 12]} />
          <meshBasicMaterial color="#ec4899" transparent opacity={0.2} />
        </mesh>
      )}
      {/* Spawn region wireframe */}
      {region && (
        <mesh position={regionCenter}>
          {region.shape === 'sphere' ? (
            <sphereGeometry args={[region.radius ?? 1, 16, 12]} />
          ) : (
            <boxGeometry args={((region.half_extents ?? [1, 1, 1]) as [number, number, number]).map((v) => v * 2) as [number, number, number]} />
          )}
          <meshBasicMaterial color="#ec4899" wireframe transparent opacity={selected ? 0.4 : 0.15} />
        </mesh>
      )}
    </group>
  );
}

function AnimationGizmo({ layer, active, selected, onSelect }: GizmoProps) {
  const pos = layer.position ?? [0, 0, 0];
  const radius = layer.region?.radius ?? 2;
  const opacity = active ? 0.5 : 0.15;
  const color = selected ? '#ffffff' : '#06b6d4';
  return (
    <group position={pos}>
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={active ? 1 : 0.4} />
      </mesh>
      <mesh>
        {layer.region?.shape === 'box' ? (
          <boxGeometry args={((layer.region?.half_extents ?? [2, 2, 2]) as [number, number, number]).map((v) => v * 2) as [number, number, number]} />
        ) : (
          <sphereGeometry args={[radius, 16, 12]} />
        )}
        <meshBasicMaterial color={color} wireframe transparent opacity={opacity} />
      </mesh>
    </group>
  );
}

function LightGizmo({ layer, active, selected, onSelect }: GizmoProps) {
  const pos = layer.position ?? [0, 0, 0];
  const light = layer.light;
  const radius = light?.radius ?? 50;
  const color = light ? `rgb(${Math.round(light.color[0] * 255)},${Math.round(light.color[1] * 255)},${Math.round(light.color[2] * 255)})` : '#ffff00';
  const displayRadius = Math.min(radius * 0.1, 5);
  const opacity = active ? 0.7 : 0.2;

  return (
    <group position={pos}>
      {/* Center sphere */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
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
  const selectLayer = useVfxStore((s) => s.selectLayer);
  const lightRef = useRef<THREE.PointLight>(null);

  // Update dynamic point light for light layers (read ref, no React re-render)
  useFrame(() => {
    if (!lightRef.current || !preset) return;
    const t = playbackTimeRef.current;
    const activeLight = (preset.elements ?? []).find((l) =>
      l.type === 'light' && l.light &&
      t >= (l.start ?? 0) && t < (l.start ?? 0) + (l.duration ?? 9999)
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
      {(preset.elements ?? []).map((layer) => {
        const active = playbackTime >= (layer.start ?? 0) && playbackTime < (layer.start ?? 0) + (layer.duration ?? 9999);
        const selected = selectedLayerId === layer.id;
        const onSelect = () => selectLayer(layer.id);
        if (layer.type === 'object') return <ObjectGizmo key={layer.id} layer={layer} active={true} selected={selected} onSelect={onSelect} />;
        if (layer.type === 'emitter') return <EmitterGizmo key={layer.id} layer={layer} active={active} selected={selected} onSelect={onSelect} />;
        if (layer.type === 'animation') return <AnimationGizmo key={layer.id} layer={layer} active={active} selected={selected} onSelect={onSelect} />;
        if (layer.type === 'light') return <LightGizmo key={layer.id} layer={layer} active={active} selected={selected} onSelect={onSelect} />;
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
  const showGizmos = useVfxStore((s) => s.showGizmos);
  const showPointCloud = useVfxStore((s) => s.showPointCloud);
  const sceneGeoRef = useRef<THREE.BufferGeometry | null>(null);

  // Callback for AnimationSystem to update point cloud geometry
  const handleUpdateGeometry = useCallback((positions: Float32Array, colors: Float32Array, scales?: Float32Array) => {
    const geo = sceneGeoRef.current;
    if (!geo) return;
    const posAttr = geo.getAttribute('position');
    const colAttr = geo.getAttribute('aColor');
    const scaleAttr = geo.getAttribute('aScale');
    if (!posAttr || !colAttr) return;
    (posAttr as THREE.BufferAttribute).set(positions);
    (colAttr as THREE.BufferAttribute).set(colors);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    if (scales) {
      const scaleAttr = geo.getAttribute('aScale') as THREE.BufferAttribute;
      if (scaleAttr) {
        // Swap backing array and force re-upload without creating a new WebGL buffer.
        // BufferAttribute.set() + needsUpdate alone doesn't work for single-component
        // custom attributes — but replacing .array does trigger a full re-upload.
        (scaleAttr as any).array = scales;
        scaleAttr.needsUpdate = true;
      }
    }
  }, []);

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <Canvas camera={{ position: [10, 10, 10], fov: 50 }} style={{ background: '#0f0f1e' }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={0.6} />
        <Grid args={[40, 40]} cellSize={1} cellColor="#2a2a4a" sectionSize={5} sectionColor="#3a3a5a" fadeDistance={30} infiniteGrid={false} />
        {scenePoints.length > 0 && showPointCloud && <GaussianPointCloud points={scenePoints} geoRef={sceneGeoRef} />}
        {showGizmos && <LayerGizmos />}
        <ParticleSystem />
        <AnimationSystem scenePoints={scenePoints} onUpdateGeometry={handleUpdateGeometry} />
        <OrbitControls />
      </Canvas>

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
