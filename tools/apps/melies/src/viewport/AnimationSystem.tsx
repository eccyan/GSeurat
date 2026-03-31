/**
 * WASM-powered GS animation preview for Méliès.
 *
 * Uses a single shared Animator so multiple animation layers compose
 * naturally (e.g., Pulse + Wave). The C++ GaussianAnimator resets to
 * baselines then accumulates each effect additively/multiplicatively.
 */

import React, { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVfxStore, playbackTimeRef } from '../store/useVfxStore.js';
import type { PlyPoint } from '@gseurat/vfx-utils';
import { loadSimulationWasm } from '@gseurat/vfx-utils';

// Effect name → WASM constant mapping
const EFFECT_MAP: Record<string, number> = {
  detach: 0, float: 1, orbit: 2, dissolve: 3, reform: 4,
  pulse: 5, vortex: 6, wave: 7, scatter: 8,
};

export function AnimationSystem({ scenePoints, objectPointsMap, objectGeoRefs, onUpdateGeometry }: {
  scenePoints: PlyPoint[];
  objectPointsMap?: Map<string, { points: PlyPoint[]; scale: number }>;
  objectGeoRefs?: Map<string, React.MutableRefObject<THREE.BufferGeometry | null>>;
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
  const [wasm, setWasm] = useState<any>(null);

  // Load WASM
  useEffect(() => {
    loadSimulationWasm().then((m) => { if (m) setWasm(m); });
  }, []);

  // Track object point offsets for splitting output
  const objectOffsetsRef = useRef<Map<string, { offset: number; count: number; pos: [number, number, number] }>>(new Map());

  // Cache scene + object data merged into one buffer
  useEffect(() => {
    // Collect all object PLY points
    const objectEntries: { id: string; points: PlyPoint[]; scale: number; pos: [number, number, number] }[] = [];
    if (objectPointsMap) {
      const preset = useVfxStore.getState().presets.find((p) => p.id === useVfxStore.getState().selectedPresetId);
      for (const [id, { points, scale }] of objectPointsMap) {
        const el = (preset?.elements ?? []).find((e) => e.id === id);
        const elPos = (el?.position ?? [0, 0, 0]) as [number, number, number];
        objectEntries.push({ id, points, scale, pos: elPos });
      }
    }

    const totalObjectPoints = objectEntries.reduce((sum, e) => sum + e.points.length, 0);
    const totalCount = scenePoints.length + totalObjectPoints;
    if (totalCount === 0) return;

    const positions = new Float32Array(totalCount * 3);
    const colors = new Float32Array(totalCount * 3);
    let offset = 0;

    // Scene points first
    for (let i = 0; i < scenePoints.length; i++) {
      positions[(offset + i) * 3] = scenePoints[i].position[0];
      positions[(offset + i) * 3 + 1] = scenePoints[i].position[1];
      positions[(offset + i) * 3 + 2] = scenePoints[i].position[2];
      colors[(offset + i) * 3] = scenePoints[i].color[0];
      colors[(offset + i) * 3 + 1] = scenePoints[i].color[1];
      colors[(offset + i) * 3 + 2] = scenePoints[i].color[2];
    }
    offset += scenePoints.length;

    // Object points after scene
    const offsets = new Map<string, { offset: number; count: number; pos: [number, number, number] }>();
    for (const { id, points, scale, pos } of objectEntries) {
      offsets.set(id, { offset, count: points.length, pos });
      for (let i = 0; i < points.length; i++) {
        // Prefab-space coordinates (element position included so animation regions overlap correctly)
        positions[(offset + i) * 3] = points[i].position[0] * scale + pos[0];
        positions[(offset + i) * 3 + 1] = points[i].position[1] * scale + pos[1];
        positions[(offset + i) * 3 + 2] = points[i].position[2] * scale + pos[2];
        colors[(offset + i) * 3] = points[i].color[0];
        colors[(offset + i) * 3 + 1] = points[i].color[1];
        colors[(offset + i) * 3 + 2] = points[i].color[2];
      }
      offset += points.length;
    }
    objectOffsetsRef.current = offsets;

    scenePositionsRef.current = positions;
    sceneColorsRef.current = colors;
    sceneCountRef.current = totalCount;
    const oc = new Float32Array(totalCount * 4);
    for (let i = 0; i < totalCount; i++) {
      oc[i * 4] = colors[i * 3];
      oc[i * 4 + 1] = colors[i * 3 + 1];
      oc[i * 4 + 2] = colors[i * 3 + 2];
      oc[i * 4 + 3] = 1.0;
    }
    origColorsRef.current = oc;
    origScalesRef.current = new Float32Array(totalCount).fill(1.0);
  }, [scenePoints, objectPointsMap]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animatorRef.current) { animatorRef.current.delete(); animatorRef.current = null; }
      activeGroupsRef.current.clear();
    };
  }, []);

  useFrame((_, dt) => {
    const hasPoints = scenePoints.length > 0 || (objectPointsMap && objectPointsMap.size > 0);
    if (!wasm || !preset || !playing || !hasPoints) return;
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
          animatorRef.current = new wasm.Animator();
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
        const sceneCount = scenePoints.length;
        // Scene geometry update (first N points)
        if (sceneCount > 0) {
          onUpdateGeometry(
            data.positions.subarray(0, sceneCount * 3),
            data.colors.subarray(0, sceneCount * 4),
            data.scales.subarray(0, sceneCount),
          );
        }
        // Object geometry updates (remaining points, split by offset)
        if (objectGeoRefs) {
          for (const [objId, { offset, count: objCount, pos: objPos }] of objectOffsetsRef.current) {
            const geo = objectGeoRefs.get(objId)?.current;
            if (!geo) continue;
            const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
            const colAttr = geo.getAttribute('aColor') as THREE.BufferAttribute;
            const scaleAttr = geo.getAttribute('aScale') as THREE.BufferAttribute;
            if (!posAttr || !colAttr) continue;
            // Copy subset of positions, subtracting element position
            // (ObjectGizmo's <group position={pos}> adds it back in Three.js)
            const objPositions = data.positions.subarray(offset * 3, (offset + objCount) * 3);
            const localPositions = new Float32Array(objCount * 3);
            for (let i = 0; i < objCount; i++) {
              localPositions[i * 3] = objPositions[i * 3] - objPos[0];
              localPositions[i * 3 + 1] = objPositions[i * 3 + 1] - objPos[1];
              localPositions[i * 3 + 2] = objPositions[i * 3 + 2] - objPos[2];
            }
            posAttr.set(localPositions);
            posAttr.needsUpdate = true;
            // Copy subset of colors (4 floats per point — RGBA)
            colAttr.set(data.colors.subarray(offset * 4, (offset + objCount) * 4));
            colAttr.needsUpdate = true;
            if (scaleAttr) {
              (scaleAttr as any).array = data.scales.subarray(offset, offset + objCount);
              scaleAttr.needsUpdate = true;
            }
          }
        }
      }
    } else if (!anyActive) {
      // No animations active — clean up animator and restore original
      if (animatorRef.current) {
        animatorRef.current.delete();
        animatorRef.current = null;
        activeGroups.clear();
      }
      const sceneCount = scenePoints.length;
      if (sceneCount > 0) {
        onUpdateGeometry(scenePositionsRef.current!.subarray(0, sceneCount * 3),
          origColorsRef.current!.subarray(0, sceneCount * 4),
          origScalesRef.current!.subarray(0, sceneCount));
      }
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
