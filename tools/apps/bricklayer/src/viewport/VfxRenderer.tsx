/**
 * Live VFX rendering for Bricklayer — renders particle emitters from
 * placed VFX instances using the simulation-wasm module.
 *
 * Each VFX instance's emitter layers create WASM ParticleEmitter instances
 * that run continuously, positioned at the instance's map location.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';
import type { VfxInstanceData, VfxLayerData } from '../store/types.js';

// Dynamic import — WASM module may not be available
let wasmModule: any = null;
let wasmLoading = false;

async function loadWasm() {
  if (wasmModule || wasmLoading) return;
  wasmLoading = true;
  try {
    const createModule = (await import('@gseurat/simulation-wasm')).default;
    wasmModule = await createModule();
    console.log('[VfxRenderer] WASM simulation loaded');
  } catch (e) {
    console.warn('[VfxRenderer] WASM not available:', e);
  }
  wasmLoading = false;
}

const MAX_PARTICLES = 2048;

// ── Single emitter layer renderer ──

function EmitterLayerRenderer({ layer, instancePos }: {
  layer: VfxLayerData;
  instancePos: [number, number, number];
}) {
  const geoRef = useRef<THREE.BufferGeometry>(null);
  const emitterRef = useRef<any>(null);
  const geoInitialized = useRef(false);

  const positionBuffer = useMemo(() => new Float32Array(MAX_PARTICLES * 3), []);
  const colorBuffer = useMemo(() => new Float32Array(MAX_PARTICLES * 4), []);
  const sizeBuffer = useMemo(() => new Float32Array(MAX_PARTICLES), []);

  // Create/destroy emitter when layer config changes
  useEffect(() => {
    if (!wasmModule) return;

    const emitter = new wasmModule.ParticleEmitter();
    const cfg = layer.emitter as Record<string, unknown> | undefined;

    if (cfg?.preset) {
      const presetCfg = wasmModule.resolvePreset(cfg.preset as string);
      if (presetCfg) {
        const merged = { ...presetCfg };
        for (const [key, val] of Object.entries(cfg)) {
          if (key !== 'preset' && val !== undefined) (merged as any)[key] = val;
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

    // Position emitter at the instance's map position.
    // Ignore the emitter config's position (that's Méliès authoring context).
    emitter.setPosition(instancePos[0], instancePos[1], instancePos[2]);
    emitter.setActive(true);
    emitterRef.current = emitter;

    return () => {
      emitter.delete();
      emitterRef.current = null;
    };
  }, [layer, instancePos]);

  useFrame((_, dt) => {
    const geo = geoRef.current;
    if (!geo) return;

    if (!geoInitialized.current) {
      geo.setAttribute('position', new THREE.BufferAttribute(positionBuffer, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(colorBuffer, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizeBuffer, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      geoInitialized.current = true;
    }

    const emitter = emitterRef.current;
    if (!emitter) { geo.setDrawRange(0, 0); return; }

    emitter.update(Math.min(dt, 0.05));
    const data = emitter.gather();

    if (data && data.count > 0) {
      const count = Math.min(data.count, MAX_PARTICLES);
      positionBuffer.set(data.positions.subarray(0, count * 3));
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

  const hasEmission = ((layer.emitter as Record<string, unknown>)?.emission as number ?? 0) > 0;
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: `
      attribute float aSize;
      varying vec4 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * 20.0 * (300.0 / -mvPosition.z);
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
  }), [hasEmission]);

  return (
    <points material={material}>
      <bufferGeometry ref={geoRef} />
    </points>
  );
}

// ── Per-instance renderer ──

function InstanceRenderer({ instance }: { instance: VfxInstanceData }) {
  const emitterLayers = instance.vfx_preset.layers.filter((l) => l.type === 'emitter');

  return (
    <group>
      {emitterLayers.map((layer, i) => (
        <EmitterLayerRenderer
          key={`${instance.id}_${i}`}
          layer={layer}
          instancePos={instance.position}
        />
      ))}
    </group>
  );
}

// ── Main VfxRenderer ──

export function VfxRenderer() {
  const instances = useSceneStore((s) => s.vfxInstances);
  const [wasmReady, setWasmReady] = useState(false);

  useEffect(() => {
    loadWasm().then(() => { if (wasmModule) setWasmReady(true); });
  }, []);

  if (!wasmReady || instances.length === 0) return null;

  // Only render auto-trigger, non-muted instances
  const autoInstances = instances.filter((v) => v.trigger === 'auto' && !v.muted);

  return (
    <group>
      {autoInstances.map((inst) => (
        <InstanceRenderer key={inst.id} instance={inst} />
      ))}
    </group>
  );
}
