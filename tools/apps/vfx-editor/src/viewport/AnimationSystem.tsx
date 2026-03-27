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
import { useVfxStore } from '../store/useVfxStore.js';
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
  onUpdateGeometry: (positions: Float32Array, colors: Float32Array) => void;
}) {
  const preset = useVfxStore((s) => s.presets.find((p) => p.id === s.selectedPresetId));
  const playbackTime = useVfxStore((s) => s.playbackTime);
  const playing = useVfxStore((s) => s.playing);

  const animatorRef = useRef<any>(null);
  const activeGroupsRef = useRef<Map<string, number>>(new Map()); // layerId → groupId
  const sceneLoadedRef = useRef(false);
  const [wasmReady, setWasmReady] = useState(false);

  // Load WASM
  useEffect(() => {
    ensureWasm().then((sim) => { if (sim) setWasmReady(true); });
  }, []);

  // Create animator and load scene when points change
  useEffect(() => {
    if (!wasmReady || !wasmModule || scenePoints.length === 0) return;

    // Create or reuse animator
    if (animatorRef.current) {
      animatorRef.current.delete();
    }
    const animator = new wasmModule.Animator();

    // Build position/color arrays from PlyPoints
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
    animator.loadScene(positions, colors, count);
    animatorRef.current = animator;
    sceneLoadedRef.current = true;
    activeGroupsRef.current.clear();

    return () => {
      animator.delete();
      animatorRef.current = null;
      sceneLoadedRef.current = false;
    };
  }, [wasmReady, scenePoints]);

  // Each frame: manage animation groups and update
  useFrame((_, dt) => {
    const animator = animatorRef.current;
    if (!animator || !preset || !playing || scenePoints.length === 0) return;

    const activeGroups = activeGroupsRef.current;

    // Check each animation layer
    for (const layer of preset.layers) {
      if (layer.type !== 'animation') continue;

      const isActive = playbackTime >= layer.start && playbackTime < layer.start + layer.duration;
      const hasGroup = activeGroups.has(layer.id);

      if (isActive && !hasGroup) {
        // Layer just became active — tag region
        const anim = (layer.animation ?? {}) as Record<string, unknown>;
        const effect = EFFECT_MAP[(anim.effect as string) ?? 'detach'] ?? 0;
        const params = anim.params as Record<string, unknown> | undefined;

        let groupId: number;
        if (params && Object.keys(params).length > 0) {
          groupId = animator.tagSphereWithParams(
            0, 0, 0, // center (relative to scene)
            999, // large radius to capture all points in region
            effect,
            layer.duration,
            params
          );
        } else {
          groupId = animator.tagSphere(0, 0, 0, 999, effect, layer.duration);
        }
        activeGroups.set(layer.id, groupId);
      } else if (!isActive && hasGroup) {
        // Layer deactivated — will expire naturally
        activeGroups.delete(layer.id);
      }
    }

    // Update animation
    if (animator.hasActiveGroups()) {
      animator.update(Math.min(dt, 0.05));

      // Get modified scene data
      const data = animator.getSceneData();
      if (data) {
        onUpdateGeometry(data.positions, data.colors);
      }
    }
  });

  // Reset when playback stops or resets
  useEffect(() => {
    if (!playing && animatorRef.current && sceneLoadedRef.current) {
      animatorRef.current.resetScene();
      activeGroupsRef.current.clear();
      // Restore original geometry
      const data = animatorRef.current.getSceneData();
      if (data) {
        onUpdateGeometry(data.positions, data.colors);
      }
    }
  }, [playing]);

  return null; // This component doesn't render — it modifies the parent's geometry
}
