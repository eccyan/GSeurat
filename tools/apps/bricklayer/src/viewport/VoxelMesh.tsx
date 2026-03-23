import React, { useRef, useMemo, useCallback, useEffect } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';
import { voxelKey, parseKey, brushPositions } from '../lib/voxelUtils.js';
import type { VoxelKey } from '../store/types.js';

const _dummy = new THREE.Object3D();

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

export function VoxelMesh() {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const voxels = useSceneStore((s) => s.voxels);
  const showCollision = useSceneStore((s) => s.showCollision);
  const yClipMin = useSceneStore((s) => s.yClipMin);
  const yClipMax = useSceneStore((s) => s.yClipMax);

  // Filter to surface-only voxels (at least one exposed face), respecting Y-clip
  const surfaceEntries = useMemo(() => {
    const all = Array.from(voxels.entries()).filter(([key]) => {
      const [, y] = parseKey(key);
      return y >= yClipMin && y <= yClipMax;
    });
    if (all.length < 1000) return all; // skip culling for small sets

    return all.filter(([key]) => {
      const [x, y, z] = parseKey(key);
      for (const [dx, dy, dz] of NEIGHBORS) {
        if (!voxels.has(voxelKey(x + dx, y + dy, z + dz))) {
          return true; // at least one face exposed
        }
      }
      return false; // fully enclosed — cull
    });
  }, [voxels, yClipMin, yClipMax]);

  const count = surfaceEntries.length;

  // Build index -> key map for raycasting (maps surface index to original voxel key)
  const indexToKey = useMemo(() => {
    const map = new Map<number, VoxelKey>();
    surfaceEntries.forEach(([key], i) => map.set(i, key));
    return map;
  }, [surfaceEntries]);

  // Pre-compute matrix and color buffers from surface voxels only
  const { matrices, colors } = useMemo(() => {
    const mat = new Float32Array(count * 16);
    const col = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const [key, voxel] = surfaceEntries[i];
      const [x, y, z] = parseKey(key);

      _dummy.position.set(x, y, z);
      _dummy.scale.set(1, 1, 1);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      _dummy.matrix.toArray(mat, i * 16);

      col[i * 3 + 0] = srgbToLinear(voxel.color[0]);
      col[i * 3 + 1] = srgbToLinear(voxel.color[1]);
      col[i * 3 + 2] = srgbToLinear(voxel.color[2]);
    }

    return { matrices: mat, colors: col };
  }, [surfaceEntries, count]);

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
    const store = useSceneStore.getState();
    const normal = e.face?.normal;

    // Update selected voxel info for right panel
    const vox = store.voxels.get(key);
    if (vox) {
      store.setSelectedVoxel({ x, y, z, color: vox.color });
    }

    // Only process brush tools in terrain mode (not collision or scene)
    if (store.mode !== 'terrain' || store.activeNode?.kind === 'collision') return;

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
      case 'fill': {
        store.pushUndo();
        store.fillVoxels(x, y, z);
        break;
      }
      case 'extrude': {
        store.pushUndo();
        const positions = store.brushSize > 1
          ? brushPositions(x, y, z, store.brushSize)
          : [[x, y, z] as [number, number, number]];
        store.extrudeVoxels(positions, e.button === 2 ? 'down' : 'up');
        break;
      }
      case 'eyedropper': {
        store.eyedrop(x, y, z);
        break;
      }
      case 'select': {
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
      <meshLambertMaterial transparent={showCollision} opacity={showCollision ? 0.3 : 1} />
    </instancedMesh>
  );
}
