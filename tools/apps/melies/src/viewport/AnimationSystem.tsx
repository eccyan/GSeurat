/**
 * WASM-powered GS animation preview for Méliès.
 *
 * Uses a single shared Animator so multiple animation layers compose
 * naturally (e.g., Pulse + Wave). The C++ GaussianAnimator resets to
 * baselines then accumulates each effect additively/multiplicatively.
 */

import React, { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useVfxStore, playbackTimeRef } from '../store/useVfxStore.js';
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
  const isLayerVisible = useVfxStore((s) => s.isLayerVisible);

  // Single shared animator — multiple tagSphere calls compose via reset-then-accumulate
  const animatorRef = useRef<any>(null);
  const activeGroupsRef = useRef<Map<string, number>>(new Map()); // layerId → groupId
  const scenePositionsRef = useRef<Float32Array | null>(null);
  const sceneColorsRef = useRef<Float32Array | null>(null);
  const sceneCountRef = useRef(0);
  // Pre-allocated buffers for restore-original path
  const origColorsRef = useRef<Float32Array | null>(null);
  const origScalesRef = useRef<Float32Array | null>(null);
  const [wasmReady, setWasmReady] = useState(false);

  // Load WASM
  useEffect(() => {
    ensureWasm().then((sim) => { if (sim) setWasmReady(true); });
  }, []);

  // Cache scene data
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

  // Cleanup
  useEffect(() => {
    return () => {
      if (animatorRef.current) { animatorRef.current.delete(); animatorRef.current = null; }
      activeGroupsRef.current.clear();
    };
  }, []);

  useFrame((_, dt) => {
    if (!wasmReady || !wasmModule || !preset || !playing || scenePoints.length === 0) return;
    if (!scenePositionsRef.current || !sceneColorsRef.current) return;

    const count = sceneCountRef.current;
    const playbackTime = playbackTimeRef.current;
    const activeGroups = activeGroupsRef.current;
    let anyActive = false;

    // Manage animation layers — tag/untag on the shared animator
    for (const layer of (preset.elements ?? [])) {
      if (layer.type !== 'animation') continue;

      const ls = layer.start ?? 0;
      const ld = layer.duration ?? 9999;
      const isActive = isLayerVisible(layer.id) && playbackTime >= ls && playbackTime < ls + ld;
      const hasGroup = activeGroups.has(layer.id);

      if (isActive && !hasGroup) {
        // Create shared animator on first active layer
        if (!animatorRef.current) {
          animatorRef.current = new wasmModule.Animator();
          animatorRef.current.loadScene(scenePositionsRef.current, sceneColorsRef.current, count);
        }

        const anim = (layer.animation ?? {}) as Record<string, unknown>;
        const effect = EFFECT_MAP[(anim.effect as string) ?? 'detach'] ?? 0;
        const params = anim.params as Record<string, unknown> | undefined;

        const effectName = (anim.effect as string) ?? 'detach';
        const infiniteLifetimeEffects = ['wave', 'pulse'];
        const lifetime = infiniteLifetimeEffects.includes(effectName) ? 9999 : (layer.duration ?? 9999);

        // Build region object with element position as center
        const pos = layer.position ?? [0, 0, 0];
        const regionObj: Record<string, unknown> = {
          shape: layer.region?.shape ?? 'sphere',
          center: pos,
          radius: layer.region?.radius ?? 999,
        };
        if (layer.region?.half_extents) regionObj.half_extents = layer.region.half_extents;

        let groupId: number;
        if (animatorRef.current.tagRegionWithParams) {
          groupId = animatorRef.current.tagRegionWithParams(regionObj, effect, lifetime, params ?? {});
        } else if (params && Object.keys(params).length > 0) {
          groupId = animatorRef.current.tagSphereWithParams(pos[0], pos[1], pos[2], regionObj.radius as number, effect, lifetime, params);
        } else {
          groupId = animatorRef.current.tagSphere(pos[0], pos[1], pos[2], regionObj.radius as number, effect, lifetime);
        }
        activeGroups.set(layer.id, groupId);
      } else if (!isActive && hasGroup) {
        // Group expired or layer deactivated — remove tracking
        // (the C++ animator handles group expiration naturally)
        activeGroups.delete(layer.id);
      }

      if (isActive) anyActive = true;
    }

    // Update the single shared animator — all effects compose via reset-then-accumulate
    if (animatorRef.current && anyActive) {
      animatorRef.current.update(Math.min(dt, 0.05));
      const data = animatorRef.current.getSceneData();
      if (data) {
        onUpdateGeometry(data.positions, data.colors, data.scales);
      }
    } else if (!anyActive) {
      // No animations active — clean up animator and restore original
      if (animatorRef.current) {
        animatorRef.current.delete();
        animatorRef.current = null;
        activeGroups.clear();
      }
      onUpdateGeometry(scenePositionsRef.current!, origColorsRef.current!, origScalesRef.current!);
    }
  });

  // Reset when playback stops
  useEffect(() => {
    if (!playing) {
      if (animatorRef.current) {
        animatorRef.current.delete();
        animatorRef.current = null;
      }
      activeGroupsRef.current.clear();
      if (scenePositionsRef.current && origColorsRef.current) {
        onUpdateGeometry(scenePositionsRef.current, origColorsRef.current, origScalesRef.current!);
      }
    }
  }, [playing]);

  return null;
}
