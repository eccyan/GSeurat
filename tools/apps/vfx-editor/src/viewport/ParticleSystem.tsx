/**
 * WASM-powered particle rendering for VFX Editor.
 *
 * Uses the exact same C++ simulation code as the engine,
 * compiled to WebAssembly. Each active emitter layer gets
 * its own ParticleEmitter instance that spawns, updates,
 * and renders particles as Three.js Points.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVfxStore } from '../store/useVfxStore.js';
import type { VfxLayer } from '../store/types.js';

// Dynamic import — WASM module may not be available
let wasmModule: any = null;
let wasmLoading = false;
let wasmError: string | null = null;

async function loadWasm() {
  if (wasmModule || wasmLoading) return;
  wasmLoading = true;
  try {
    const createModule = (await import('@gseurat/simulation-wasm')).default;
    wasmModule = await createModule();
    console.log('[ParticleSystem] WASM simulation loaded');
  } catch (e) {
    wasmError = String(e);
    console.warn('[ParticleSystem] WASM not available:', e);
    console.warn('Run: cd tools/packages/simulation-wasm && bash build.sh');
  }
  wasmLoading = false;
}

// ── Single Emitter Renderer ──

const MAX_PARTICLES = 2048;

function EmitterRenderer({ layer, active }: { layer: VfxLayer; active: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);
  const emitterRef = useRef<any>(null);
  const geoRef = useRef<THREE.BufferGeometry>(null);

  // Pre-allocate buffers
  const positionBuffer = useMemo(() => new Float32Array(MAX_PARTICLES * 3), []);
  const colorBuffer = useMemo(() => new Float32Array(MAX_PARTICLES * 4), []); // RGBA for per-particle opacity
  const sizeBuffer = useMemo(() => new Float32Array(MAX_PARTICLES), []);
  const [particleCount, setParticleCount] = useState(0);

  // Create/destroy emitter
  useEffect(() => {
    if (!wasmModule || !active) {
      if (emitterRef.current) {
        emitterRef.current.delete();
        emitterRef.current = null;
        setParticleCount(0);
      }
      return;
    }

    const emitter = new wasmModule.ParticleEmitter();
    const cfg = layer.emitter as Record<string, unknown> | undefined;

    if (cfg?.preset) {
      // Start from preset, then apply any custom overrides
      const presetCfg = wasmModule.resolvePreset(cfg.preset as string);
      if (presetCfg) {
        // Merge: preset defaults + layer overrides
        const merged = { ...presetCfg };
        for (const [key, val] of Object.entries(cfg)) {
          if (key !== 'preset' && val !== undefined) {
            (merged as any)[key] = val;
          }
        }
        emitter.configure(merged);
      } else {
        emitter.configure(cfg);
      }
    } else if (cfg) {
      emitter.configure(cfg);
    } else {
      emitter.configurePreset('fire');
    }

    emitter.setActive(true);
    emitterRef.current = emitter;

    return () => {
      emitter.delete();
      emitterRef.current = null;
      setParticleCount(0);
    };
  }, [active, layer.id, layer.emitter]);

  const geoInitialized = useRef(false);

  // Update each frame
  useFrame((_, dt) => {
    const geo = geoRef.current;
    if (!geo) return;

    // Lazy init geometry attributes (can't use useEffect — component may remount)
    if (!geoInitialized.current) {
      geo.setAttribute('position', new THREE.BufferAttribute(positionBuffer, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(colorBuffer, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizeBuffer, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      geoInitialized.current = true;
    }

    const emitter = emitterRef.current;
    if (!emitter || !active) {
      geo.setDrawRange(0, 0);
      return;
    }

    emitter.update(Math.min(dt, 0.05));
    const data = emitter.gather();

    if (data && data.count > 0) {
      const count = Math.min(data.count, MAX_PARTICLES);
      positionBuffer.set(data.positions.subarray(0, count * 3));

      // Write RGBA colors with per-particle opacity + per-particle scale
      for (let i = 0; i < count; i++) {
        colorBuffer[i * 4] = data.colors[i * 3];
        colorBuffer[i * 4 + 1] = data.colors[i * 3 + 1];
        colorBuffer[i * 4 + 2] = data.colors[i * 3 + 2];
        colorBuffer[i * 4 + 3] = data.opacities[i];
        sizeBuffer[i] = data.scales[i];
      }

      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
      geo.setDrawRange(0, count);
    } else {
      geo.setDrawRange(0, 0);
    }
  });

  const shaderMaterial = useMemo(() => {
    const cfg = layer.emitter as Record<string, unknown> | undefined;
    const hasEmission = ((cfg?.emission as number) ?? 0) > 0;
    return new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aSize;
        varying vec4 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 80.0 * (300.0 / -mvPosition.z);
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
      vertexColors: true,
      transparent: true,
      blending: hasEmission ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
  }, [layer.emitter]);

  if (!wasmModule) return null;

  return (
    <points ref={pointsRef} visible={active} material={shaderMaterial}>
      <bufferGeometry ref={geoRef} />
    </points>
  );
}

// ── Main ParticleSystem ──

export function ParticleSystem() {
  const preset = useVfxStore((s) => {
    return s.presets.find((p) => p.id === s.selectedPresetId);
  });
  const playbackTime = useVfxStore((s) => s.playbackTime);
  const playing = useVfxStore((s) => s.playing);
  const [wasmReady, setWasmReady] = useState(false);

  // Load WASM on mount
  useEffect(() => {
    loadWasm().then(() => {
      if (wasmModule) setWasmReady(true);
    });
  }, []);

  if (!wasmReady || !preset) return null;

  return (
    <group>
      {preset.layers
        .filter((l) => l.type === 'emitter')
        .map((layer) => {
          const active = playing &&
            playbackTime >= layer.start &&
            playbackTime < layer.start + layer.duration;
          return (
            <EmitterRenderer
              key={layer.id}
              layer={layer}
              active={active}
            />
          );
        })}
    </group>
  );
}
