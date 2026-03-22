import React, { useRef, useMemo, useCallback, useEffect } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { voxelKey, parseKey, brushPositions } from '../lib/voxelUtils.js';
import type { VoxelKey, BodyPart, PoseData } from '../store/types.js';

const _dummy = new THREE.Object3D();
const DEG2RAD = Math.PI / 180;

// sRGB -> linear conversion for a single channel (0-255 input, 0-1 linear output)
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// 6-neighbor offsets for surface detection
const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** Compute accumulated FK transforms for all parts given a pose. */
function computeFKTransforms(
  parts: BodyPart[],
  pose: PoseData,
): Map<string, THREE.Matrix4> {
  const result = new Map<string, THREE.Matrix4>();
  const partMap = new Map<string, BodyPart>();
  for (const p of parts) partMap.set(p.id, p);

  function getTransform(partId: string): THREE.Matrix4 {
    const cached = result.get(partId);
    if (cached) return cached;

    const part = partMap.get(partId);
    if (!part) {
      const identity = new THREE.Matrix4();
      result.set(partId, identity);
      return identity;
    }

    // Local rotation around this part's joint
    const [rx, ry, rz] = pose.rotations[partId] ?? [0, 0, 0];
    const euler = new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD);
    const j = part.joint;

    const local = new THREE.Matrix4()
      .makeTranslation(j[0], j[1], j[2])
      .multiply(new THREE.Matrix4().makeRotationFromEuler(euler))
      .multiply(new THREE.Matrix4().makeTranslation(-j[0], -j[1], -j[2]));

    // Accumulate parent transform
    const parentTf = part.parent ? getTransform(part.parent) : new THREE.Matrix4();
    const accumulated = parentTf.clone().multiply(local);
    result.set(partId, accumulated);
    return accumulated;
  }

  for (const part of parts) getTransform(part.id);
  return result;
}

export function VoxelMesh() {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const voxels = useCharacterStore((s) => s.voxels);
  const characterParts = useCharacterStore((s) => s.characterParts);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const previewPose = useCharacterStore((s) => s.previewPose);
  const selectedPose = useCharacterStore((s) => s.selectedPose);
  const characterPoses = useCharacterStore((s) => s.characterPoses);
  const yClip = useCharacterStore((s) => s.yClip);

  // Filter to surface-only voxels (at least one exposed face), then apply Y-clip
  const surfaceEntries = useMemo(() => {
    const all = Array.from(voxels.entries());

    let filtered = all;
    if (all.length >= 1000) {
      filtered = all.filter(([key]) => {
        const [x, y, z] = parseKey(key);
        for (const [dx, dy, dz] of NEIGHBORS) {
          if (!voxels.has(voxelKey(x + dx, y + dy, z + dz))) {
            return true;
          }
        }
        return false;
      });
    }

    // Apply Y-clip
    if (yClip !== null) {
      filtered = filtered.filter(([key]) => {
        const [, y] = parseKey(key);
        return y <= yClip;
      });
    }

    return filtered;
  }, [voxels, yClip]);

  const count = surfaceEntries.length;

  // Build index -> key map for raycasting (maps surface index to original voxel key)
  const indexToKey = useMemo(() => {
    const map = new Map<number, VoxelKey>();
    surfaceEntries.forEach(([key], i) => map.set(i, key));
    return map;
  }, [surfaceEntries]);

  // Build highlight/dim sets for part-based coloring
  const { selectedKeys, otherPartKeys } = useMemo(() => {
    const sel = new Set<VoxelKey>();
    const other = new Set<VoxelKey>();
    if (characterParts.length > 0 && selectedPart) {
      for (const part of characterParts) {
        if (part.id === selectedPart) {
          for (const k of part.voxelKeys) sel.add(k);
        } else {
          for (const k of part.voxelKeys) other.add(k);
        }
      }
    }
    return { selectedKeys: sel, otherPartKeys: other };
  }, [characterParts, selectedPart]);

  // Build voxelKey → partId lookup for FK
  const voxelToPartId = useMemo(() => {
    const map = new Map<VoxelKey, string>();
    for (const part of characterParts) {
      for (const k of part.voxelKeys) map.set(k, part.id);
    }
    return map;
  }, [characterParts]);

  // Compute FK transforms when previewing
  const fkTransforms = useMemo(() => {
    if (!previewPose || !selectedPose) return null;
    const pose = characterPoses[selectedPose];
    if (!pose) return null;
    return computeFKTransforms(characterParts, pose);
  }, [previewPose, selectedPose, characterPoses, characterParts]);

  // Pre-compute matrix and color buffers from surface voxels only
  const { matrices, colors } = useMemo(() => {
    const mat = new Float32Array(count * 16);
    const col = new Float32Array(count * 3);
    const hasHighlighting = characterParts.length > 0 && selectedPart;
    const _pos = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const [key, voxel] = surfaceEntries[i];
      const [x, y, z] = parseKey(key);

      _pos.set(x, y, z);

      // Apply FK transform if previewing
      if (fkTransforms) {
        const partId = voxelToPartId.get(key);
        if (partId) {
          const tf = fkTransforms.get(partId);
          if (tf) _pos.applyMatrix4(tf);
        }
      }

      _dummy.position.copy(_pos);
      _dummy.scale.set(1, 1, 1);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      _dummy.matrix.toArray(mat, i * 16);

      let r = srgbToLinear(voxel.color[0]);
      let g = srgbToLinear(voxel.color[1]);
      let b = srgbToLinear(voxel.color[2]);

      if (hasHighlighting) {
        if (selectedKeys.has(key)) {
          // Boost blue channel for selected part
          b = Math.min(1, b + 0.15);
        } else if (otherPartKeys.has(key)) {
          // Dim other parts
          r *= 0.6;
          g *= 0.6;
          b *= 0.6;
        }
      }

      col[i * 3 + 0] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }

    return { matrices: mat, colors: col };
  }, [surfaceEntries, count, characterParts, selectedPart, selectedKeys, otherPartKeys, fkTransforms, voxelToPartId]);

  // Apply buffers to the InstancedMesh
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;

    mesh.count = count;

    // Write instance matrices
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;

    // Write instance colors
    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 3), 3
      );
    }
    if (mesh.instanceColor.array.length < count * 3) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 3), 3
      );
    }
    (mesh.instanceColor.array as Float32Array).set(colors);
    mesh.instanceColor.needsUpdate = true;

    mesh.computeBoundingSphere();
  }, [matrices, colors, count]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;

    const key = indexToKey.get(e.instanceId);
    if (!key) return;

    const [x, y, z] = parseKey(key);
    const store = useCharacterStore.getState();
    const normal = e.face?.normal;

    switch (store.activeTool) {
      case 'place': {
        if (!normal) return;
        const nx = x + Math.round(normal.x);
        const ny = y + Math.round(normal.y);
        const nz = z + Math.round(normal.z);
        store.pushUndo();
        if (store.brushSize > 1) {
          store.placeVoxels(brushPositions(nx, ny, nz, store.brushSize));
        } else {
          store.placeVoxel(nx, ny, nz);
        }
        break;
      }
      case 'paint': {
        store.pushUndo();
        if (store.brushSize > 1) {
          for (const [px, py, pz] of brushPositions(x, y, z, store.brushSize)) {
            store.paintVoxel(px, py, pz);
          }
        } else {
          store.paintVoxel(x, y, z);
        }
        break;
      }
      case 'erase': {
        store.pushUndo();
        if (store.brushSize > 1) {
          store.eraseVoxels(brushPositions(x, y, z, store.brushSize));
        } else {
          store.eraseVoxel(x, y, z);
        }
        break;
      }
      case 'eyedropper': {
        store.eyedrop(x, y, z);
        break;
      }
      case 'assign_part': {
        const partId = store.selectedPart;
        if (!partId) break;
        store.pushUndo();
        const positions = brushPositions(x, y, z, store.brushSize);
        const keys = positions
          .filter(([px, py, pz]) => store.voxels.has(voxelKey(px, py, pz)))
          .map(([px, py, pz]) => voxelKey(px, py, pz));
        store.assignVoxelsToPart(keys, partId);
        break;
      }
    }
  }, [indexToKey]);

  // Key forces remount when count changes so buffer sizes match
  return (
    <instancedMesh
      key={count}
      ref={meshRef}
      args={[undefined, undefined, Math.max(count, 1)]}
      onClick={handleClick}
      onContextMenu={handleClick}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}
