/**
 * WASM-powered GS animation preview for Méliès.
 *
 * When animation layers are active during playback, applies effects
 * (orbit, scatter, dissolve, etc.) to the imported scene point cloud
 * using the exact same C++ code as the engine.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVfxStore, playbackTimeRef } from '../store/useVfxStore.js';
import type { VfxLayer } from '../store/types.js';
import type { PlyPoint } from '../lib/plyLoader.js';

// Effect name → WASM constant mapping
const EFFECT_MAP: Record<string, number> = {
  detach: 0, float: 1, orbit: 2, dissolve: 3, reform: 4,
  pulse: 5, vortex: 6, wave: 7, scatter: 8,
};

let wasmModule: any = null;

async function ensureWasm() {
  if (wasmModule) return wasmModule;
  try {
    const createModule = (await import('@gseurat/simulation-wasm')).default;
    wasmModule = await createModule();
  } catch {}
  return wasmModule;
}

export function AnimationSystem({ scenePoints, onUpdateGeometry }: {
  scenePoints: PlyPoint[];
  onUpdateGeometry: (positions: Float32Array, colors: Float32Array, scales?: Float32Array) => void;
}) {
  const preset = useVfxStore((s) => s.presets.find((p) => p.id === s.selectedPresetId));
  const playing = useVfxStore((s) => s.playing);

  // One animator per animation layer for isolation
  const animatorsRef = useRef<Map<string, { animator: any; groupId: number }>>(new Map());
  const scenePositionsRef = useRef<Float32Array | null>(null);
  const sceneColorsRef = useRef<Float32Array | null>(null);
  const sceneCountRef = useRef(0);
  // Pre-allocated buffers for restore-original path (avoid per-frame allocation)
  const origColorsRef = useRef<Float32Array | null>(null);   // count * 4
  const origScalesRef = useRef<Float32Array | null>(null);   // count, filled with 1.0
  const [wasmReady, setWasmReady] = useState(false);

  // Load WASM
  useEffect(() => {
    ensureWasm().then((sim) => { if (sim) setWasmReady(true); });
  }, []);

  // Cache scene data for creating per-layer animators
  useEffect(() => {
    if (scenePoints.length === 0) return;
    const count = scenePoints.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = scenePoints[i].position[0];
      positions[i * 3 + 1] = scenePoints[i].position[1];
      positions[i * 3 + 2] = scenePoints[i].position[2];
      colors[i * 3] = scenePoints[i].color[0];
      colors[i * 3 + 1] = scenePoints[i].color[1];
      colors[i * 3 + 2] = scenePoints[i].color[2];
    }
    scenePositionsRef.current = positions;
    sceneColorsRef.current = colors;
    sceneCountRef.current = count;
    // Pre-allocate restore buffers
    const oc = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      oc[i * 4] = colors[i * 3];
      oc[i * 4 + 1] = colors[i * 3 + 1];
      oc[i * 4 + 2] = colors[i * 3 + 2];
      oc[i * 4 + 3] = 1.0;
    }
    origColorsRef.current = oc;
    origScalesRef.current = new Float32Array(count).fill(1.0);
  }, [scenePoints]);

  // Cleanup all animators
  useEffect(() => {
    return () => {
      for (const { animator } of animatorsRef.current.values()) animator.delete();
      animatorsRef.current.clear();
    };
  }, []);

  // Each frame: one animator per active animation layer, compose results
  useFrame((_, dt) => {
    if (!wasmReady || !wasmModule || !preset || !playing || scenePoints.length === 0) return;
    if (!scenePositionsRef.current || !sceneColorsRef.current) return;

    const animators = animatorsRef.current;
    const count = sceneCountRef.current;
    let anyActive = false;

    // Read playback time from ref (no React re-render)
    const playbackTime = playbackTimeRef.current;

    // Manage per-layer animators
    for (const layer of preset.layers) {
      if (layer.type !== 'animation') continue;

      const isActive = playbackTime >= layer.start && playbackTime < layer.start + layer.duration;
      const hasAnimator = animators.has(layer.id);

      if (isActive && !hasAnimator) {
        // Create fresh animator for this layer
        const animator = new wasmModule.Animator();
        animator.loadScene(scenePositionsRef.current, sceneColorsRef.current, count);

        const anim = (layer.animation ?? {}) as Record<string, unknown>;
        const effect = EFFECT_MAP[(anim.effect as string) ?? 'detach'] ?? 0;
        const params = anim.params as Record<string, unknown> | undefined;

        // Wave/Pulse are truly continuous — use large lifetime so particles don't die.
        // Orbit/Vortex use t=age/lifetime for rotation progress — need real duration.
        // Destructive effects (detach/scatter/dissolve/float) need real duration for fade.
        const effectName = (anim.effect as string) ?? 'detach';
        const infiniteLifetimeEffects = ['wave', 'pulse'];
        const lifetime = infiniteLifetimeEffects.includes(effectName) ? 9999 : layer.duration;

        let groupId: number;
        if (params && Object.keys(params).length > 0) {
          groupId = animator.tagSphereWithParams(0, 0, 0, 999, effect, lifetime, params);
        } else {
          groupId = animator.tagSphere(0, 0, 0, 999, effect, lifetime);
        }
        animators.set(layer.id, { animator, groupId });
      } else if (!isActive && hasAnimator) {
        // Destroy animator for this layer
        animators.get(layer.id)!.animator.delete();
        animators.delete(layer.id);
      }

      if (isActive) anyActive = true;
    }

    // Update all active animators and compose: use the LAST active layer's output
    // (layers later in the list take precedence)
    let lastData: any = null;
    for (const [, { animator }] of animators) {
      animator.update(Math.min(dt, 0.05));
      const data = animator.getSceneData();
      if (data) lastData = data;
    }

    if (lastData) {
      // Scales are pre-normalized in WASM (ratio: 1.0 = original size)
      onUpdateGeometry(lastData.positions, lastData.colors, lastData.scales);
    } else if (!anyActive && animators.size === 0) {
      // No animations active — restore original (pre-allocated buffers, no alloc)
      onUpdateGeometry(scenePositionsRef.current!, origColorsRef.current!, origScalesRef.current!);
    }
  });

  // Reset when playback stops
  useEffect(() => {
    if (!playing) {
      for (const { animator } of animatorsRef.current.values()) animator.delete();
      animatorsRef.current.clear();
      // Restore original geometry (pre-allocated buffers, no alloc)
      if (scenePositionsRef.current && origColorsRef.current) {
        onUpdateGeometry(scenePositionsRef.current, origColorsRef.current, origScalesRef.current!);
      }
    }
  }, [playing]);

  return null; // This component doesn't render — it modifies the parent's geometry
}
