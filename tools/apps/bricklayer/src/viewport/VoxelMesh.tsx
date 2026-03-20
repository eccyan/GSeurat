import React, { useRef, useMemo, useCallback } from 'react';
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';
import { voxelKey, parseKey, brushPositions } from '../lib/voxelUtils.js';

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export function VoxelMesh() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const voxels = useSceneStore((s) => s.voxels);
  const activeTool = useSceneStore((s) => s.activeTool);
  const brushSize = useSceneStore((s) => s.brushSize);

  const entries = useMemo(() => Array.from(voxels.entries()), [voxels]);
  const maxCount = Math.max(entries.length, 1);

  // Build index map for raycasting
  const indexToKey = useMemo(() => {
    const map = new Map<number, string>();
    entries.forEach(([key], i) => map.set(i, key));
    return map;
  }, [entries]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    entries.forEach(([key, voxel], i) => {
      const [x, y, z] = parseKey(key);
      _dummy.position.set(x, y, z);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      _color.setRGB(voxel.color[0] / 255, voxel.color[1] / 255, voxel.color[2] / 255, THREE.SRGBColorSpace);
      mesh.setColorAt(i, _color);
    });

    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;

    const key = indexToKey.get(e.instanceId);
    if (!key) return;

    const [x, y, z] = parseKey(key as `${number},${number},${number}`);
    const store = useSceneStore.getState();
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
          const positions = brushPositions(x, y, z, store.brushSize);
          for (const [px, py, pz] of positions) {
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

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, maxCount]}
      onClick={handleClick}
      onContextMenu={handleClick}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial vertexColors />
    </instancedMesh>
  );
}
