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
import type { VfxInstanceData, VfxElementData } from '../store/types.js';

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
  layer: VfxElementData;
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

    // Configure emitter — spawn_offset_min/max are relative to emitter position,
    // so they're kept as part of the VFX design.
    // Only strip 'position' (Méliès authoring context) since Bricklayer controls placement.
    const cfgWithoutPos = { ...cfg };
    delete cfgWithoutPos.position;

    if (cfgWithoutPos.preset) {
      const presetCfg = wasmModule.resolvePreset(cfgWithoutPos.preset as string);
      if (presetCfg) {
        const merged = { ...presetCfg };
        for (const [key, val] of Object.entries(cfgWithoutPos)) {
          if (key !== 'preset' && val !== undefined) (merged as any)[key] = val;
        }
        emitter.configure(merged);
      } else {
        emitter.configure(cfgWithoutPos);
      }
    } else if (cfg) {
      emitter.configure(cfgWithoutPos);
    } else {
      emitter.configurePreset('fire');
    }

    // Set emitter at instance position — spawn offsets are relative to this
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

// ── Object PLY renderer (loads and renders a PLY point cloud) ──

function ObjectLayerRenderer({ layer, instancePos }: {
  layer: VfxElementData;
  instancePos: [number, number, number];
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const elPos = layer.position ?? [0, 0, 0];
  const scale = layer.scale ?? 1;

  useEffect(() => {
    if (!layer.ply_file) return;
    // Try loading PLY from project directory
    const store = useSceneStore.getState();
    const handle = store.projectHandle;
    if (!handle) return;

    (async () => {
      try {
        // Navigate to the file
        const parts = layer.ply_file!.split('/');
        let dir: FileSystemDirectoryHandle = handle;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]);
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]);
        const file = await fh.getFile();
        const buffer = await file.arrayBuffer();

        // Minimal PLY parser (binary, expects f_dc_0/1/2 or red/green/blue)
        const headerEnd = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength)));
        const headerLines = headerEnd.split('\n');
        let vertexCount = 0;
        let propNames: string[] = [];
        let dataStart = 0;
        for (const line of headerLines) {
          dataStart += line.length + 1;
          if (line.startsWith('element vertex')) vertexCount = parseInt(line.split(' ')[2]);
          if (line.startsWith('property float')) propNames.push(line.split(' ')[2]);
          if (line.trim() === 'end_header') break;
        }

        const stride = propNames.length * 4;
        const dataView = new DataView(buffer, dataStart);
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 4);

        const xIdx = propNames.indexOf('x');
        const yIdx = propNames.indexOf('y');
        const zIdx = propNames.indexOf('z');
        const dcR = propNames.indexOf('f_dc_0');
        const dcG = propNames.indexOf('f_dc_1');
        const dcB = propNames.indexOf('f_dc_2');
        const rIdx = propNames.indexOf('red');
        const gIdx = propNames.indexOf('green');
        const bIdx = propNames.indexOf('blue');

        for (let i = 0; i < vertexCount; i++) {
          const off = i * stride;
          positions[i * 3] = dataView.getFloat32(off + xIdx * 4, true) * scale;
          positions[i * 3 + 1] = dataView.getFloat32(off + yIdx * 4, true) * scale;
          positions[i * 3 + 2] = dataView.getFloat32(off + zIdx * 4, true) * scale;
          if (dcR >= 0) {
            colors[i * 4] = 0.5 + 0.2820948 * dataView.getFloat32(off + dcR * 4, true);
            colors[i * 4 + 1] = 0.5 + 0.2820948 * dataView.getFloat32(off + dcG * 4, true);
            colors[i * 4 + 2] = 0.5 + 0.2820948 * dataView.getFloat32(off + dcB * 4, true);
          } else if (rIdx >= 0) {
            colors[i * 4] = dataView.getUint8(off + rIdx) / 255;
            colors[i * 4 + 1] = dataView.getUint8(off + gIdx) / 255;
            colors[i * 4 + 2] = dataView.getUint8(off + bIdx) / 255;
          } else {
            colors[i * 4] = 0.7; colors[i * 4 + 1] = 0.7; colors[i * 4 + 2] = 0.7;
          }
          colors[i * 4 + 3] = 1.0;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
        setGeometry(geo);
      } catch (e) {
        console.warn('[VfxRenderer] Failed to load Object PLY:', layer.ply_file, e);
      }
    })();
  }, [layer.ply_file, scale]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: `
      varying vec4 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(0.5, 0.5) * (20.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec4 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor.rgb, vColor.a);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  }), []);

  if (!geometry) return null;

  return (
    <points
      geometry={geometry}
      material={material}
      position={[instancePos[0] + elPos[0], instancePos[1] + elPos[1], instancePos[2] + elPos[2]]}
    />
  );
}

// ── Per-instance renderer ──

function InstanceRenderer({ instance }: { instance: VfxInstanceData }) {
  const emitterLayers = (instance.vfx_preset.elements ?? []).filter((l) => l.type === 'emitter');
  const objectLayers = (instance.vfx_preset.elements ?? []).filter((l) => l.type === 'object');

  return (
    <group>
      {objectLayers.map((layer, i) => (
        <ObjectLayerRenderer
          key={`${instance.id}_obj_${i}`}
          layer={layer}
          instancePos={instance.position}
        />
      ))}
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
