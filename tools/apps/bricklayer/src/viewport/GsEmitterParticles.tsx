/**
 * Live particle rendering for direct GS particle emitters in Bricklayer.
 *
 * Each GsParticleEmitterData in the scene gets a WASM ParticleEmitter
 * instance that runs continuously, rendering particles as Three.js Points.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';
import type { GsParticleEmitterData } from '../store/types.js';
import { loadSimulationWasm } from '@gseurat/vfx-utils';

const MAX_PARTICLES = 2048;

function EmitterRenderer({ emitter, wasm }: {
  emitter: GsParticleEmitterData;
  wasm: any;
}) {
  const geoRef = useRef<THREE.BufferGeometry>(null);
  const emitterRef = useRef<any>(null);
  const geoInitialized = useRef(false);

  const positionBuffer = useMemo(() => new Float32Array(MAX_PARTICLES * 3), []);
  const colorBuffer = useMemo(() => new Float32Array(MAX_PARTICLES * 4), []);
  const sizeBuffer = useMemo(() => new Float32Array(MAX_PARTICLES), []);

  useEffect(() => {
    if (!wasm) return;

    const em = new wasm.ParticleEmitter();

    // Build config from GsParticleEmitterData fields
    const cfg: Record<string, unknown> = {
      spawn_rate: emitter.spawn_rate,
      lifetime_min: emitter.lifetime_min,
      lifetime_max: emitter.lifetime_max,
      velocity_min: emitter.velocity_min,
      velocity_max: emitter.velocity_max,
      acceleration: emitter.acceleration,
      color_start: emitter.color_start,
      color_end: emitter.color_end,
      scale_min: emitter.scale_min,
      scale_max: emitter.scale_max,
      scale_end_factor: emitter.scale_end_factor,
      opacity_start: emitter.opacity_start,
      opacity_end: emitter.opacity_end,
      emission: emitter.emission,
      burst_duration: emitter.burst_duration,
    };
    if (emitter.spawn_region) cfg.region = emitter.spawn_region;
    if (emitter.spline) cfg.spline = emitter.spline;

    if (emitter.preset) {
      const presetCfg = wasm.resolvePreset(emitter.preset);
      if (presetCfg) {
        const merged = { ...presetCfg };
        for (const [key, val] of Object.entries(cfg)) {
          if (val !== undefined) (merged as any)[key] = val;
        }
        em.configure(merged);
      } else {
        em.configure(cfg);
      }
    } else {
      em.configure(cfg);
    }

    em.setPosition(emitter.position[0], emitter.position[1], emitter.position[2]);
    em.setActive(true);
    emitterRef.current = em;

    return () => {
      em.delete();
      emitterRef.current = null;
    };
  }, [wasm, emitter]);

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

    const em = emitterRef.current;
    if (!em) { geo.setDrawRange(0, 0); return; }

    em.update(Math.min(dt, 0.05));
    const data = em.gather();

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

  const hasEmission = (emitter.emission ?? 0) > 0;
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

export function GsEmitterParticles() {
  const emitters = useSceneStore((s) => s.gsParticleEmitters);
  const [wasm, setWasm] = useState<any>(null);

  useEffect(() => {
    loadSimulationWasm().then((m) => { if (m) setWasm(m); });
  }, []);

  if (!wasm || emitters.length === 0) return null;

  const active = emitters.filter((e) => !e.muted);

  return (
    <group>
      {active.map((e) => (
        <EmitterRenderer key={e.id} emitter={e} wasm={wasm} />
      ))}
    </group>
  );
}
