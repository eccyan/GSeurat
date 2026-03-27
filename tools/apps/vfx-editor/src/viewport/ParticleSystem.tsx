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
  const colorBuffer = useMemo(() => new Float32Array(MAX_PARTICLES * 3), []);
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
      emitter.configurePreset(cfg.preset as string);
    } else if (cfg) {
      emitter.configure(cfg);
    } else {
      emitter.configurePreset('fire'); // fallback
    }

    emitter.setActive(true);
    emitterRef.current = emitter;

    return () => {
      emitter.delete();
      emitterRef.current = null;
      setParticleCount(0);
    };
  }, [active, layer.id, layer.emitter]);

  // Update each frame
  useFrame((_, dt) => {
    const emitter = emitterRef.current;
    if (!emitter || !active) return;

    emitter.update(Math.min(dt, 0.05)); // cap dt to avoid burst on tab refocus
    const data = emitter.gather();

    if (data && data.count > 0 && geoRef.current) {
      const count = Math.min(data.count, MAX_PARTICLES);

      // Copy data into pre-allocated buffers
      positionBuffer.set(data.positions.subarray(0, count * 3));
      colorBuffer.set(data.colors.subarray(0, count * 3));

      const posAttr = geoRef.current.getAttribute('position');
      const colAttr = geoRef.current.getAttribute('color');
      if (!posAttr || !colAttr) return;
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      geoRef.current.setDrawRange(0, count);

      if (particleCount !== count) setParticleCount(count);
    } else if (geoRef.current) {
      geoRef.current.setDrawRange(0, 0);
      if (particleCount !== 0) setParticleCount(0);
    }
  });

  // Set up geometry imperatively for reliable color attribute binding
  useEffect(() => {
    if (!geoRef.current) return;
    const geo = geoRef.current;
    geo.setAttribute('position', new THREE.BufferAttribute(positionBuffer, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colorBuffer, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
  }, []);

  if (!active || !wasmModule) return null;

  // Check if emitter has emission (self-lit)
  const cfg = layer.emitter as Record<string, unknown> | undefined;
  const hasEmission = ((cfg?.emission as number) ?? 0) > 0;

  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geoRef} />
      <pointsMaterial
        size={hasEmission ? 0.3 : 0.2}
        vertexColors
        sizeAttenuation
        transparent
        opacity={0.9}
        blending={hasEmission ? THREE.AdditiveBlending : THREE.NormalBlending}
        depthWrite={!hasEmission}
      />
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
