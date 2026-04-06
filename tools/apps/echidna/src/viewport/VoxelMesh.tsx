import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { voxelKey, parseKey, brushPositions } from '../lib/voxelUtils.js';
import type { VoxelKey, BodyPart, PoseData } from '../store/types.js';
import { applyEasing } from '../lib/easing.js';
import type { AnimationKeyframe, EasingType } from '../store/types.js';

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

    const [rx, ry, rz] = pose.rotations[partId] ?? [0, 0, 0];
    const euler = new THREE.Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD);
    const j = part.joint;

    const local = new THREE.Matrix4()
      .makeTranslation(j[0], j[1], j[2])
      .multiply(new THREE.Matrix4().makeRotationFromEuler(euler))
      .multiply(new THREE.Matrix4().makeTranslation(-j[0], -j[1], -j[2]));

    const parentTf = part.parent ? getTransform(part.parent) : new THREE.Matrix4();
    const accumulated = parentTf.clone().multiply(local);
    result.set(partId, accumulated);
    return accumulated;
  }

  for (const part of parts) getTransform(part.id);
  return result;
}

/** Get the interpolated rotation for a single part at a given time, applying easing. */
function interpolatePartRotation(
  keyframes: AnimationKeyframe[],
  poses: Record<string, PoseData>,
  time: number,
  partId: string,
): [number, number, number] {
  if (keyframes.length === 0) return [0, 0, 0];

  // Filter keyframes relevant to this part
  const relevantKfs = keyframes.filter((kf) => !kf.parts || kf.parts.includes(partId));
  if (relevantKfs.length === 0) return [0, 0, 0];

  // Find the two keyframes surrounding `time`
  let prevKf = relevantKfs[0];
  let nextKf = relevantKfs[relevantKfs.length - 1];

  for (let i = 0; i < relevantKfs.length - 1; i++) {
    if (time >= relevantKfs[i].time && time < relevantKfs[i + 1].time) {
      prevKf = relevantKfs[i];
      nextKf = relevantKfs[i + 1];
      break;
    }
  }

  if (time <= prevKf.time) {
    const pose = poses[prevKf.poseName];
    return pose?.rotations[partId] ?? [0, 0, 0];
  }
  if (time >= nextKf.time) {
    const pose = poses[nextKf.poseName];
    return pose?.rotations[partId] ?? [0, 0, 0];
  }

  const fromPose = poses[prevKf.poseName];
  const toPose = poses[nextKf.poseName];
  const fromRot = fromPose?.rotations[partId] ?? [0, 0, 0];
  const toRot = toPose?.rotations[partId] ?? [0, 0, 0];

  const range = nextKf.time - prevKf.time;
  const rawT = range > 0 ? (time - prevKf.time) / range : 0;
  const easedT = applyEasing(prevKf.easing, rawT, prevKf.curve);

  return [
    fromRot[0] + (toRot[0] - fromRot[0]) * easedT,
    fromRot[1] + (toRot[1] - fromRot[1]) * easedT,
    fromRot[2] + (toRot[2] - fromRot[2]) * easedT,
  ];
}

function OnionGhost({ time, tint, opacity, surfaceEntries, characterParts, characterPoses, voxelToPartId, keyframes }: {
  time: number;
  tint: [number, number, number];
  opacity: number;
  surfaceEntries: [VoxelKey, { color: [number, number, number, number] }][];
  characterParts: BodyPart[];
  characterPoses: Record<string, PoseData>;
  voxelToPartId: Map<VoxelKey, string>;
  keyframes: AnimationKeyframe[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const count = surfaceEntries.length;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;

    const rotations: Record<string, [number, number, number]> = {};
    for (const part of characterParts) {
      rotations[part.id] = interpolatePartRotation(keyframes, characterPoses, time, part.id);
    }
    const fk = computeFKTransforms(characterParts, { rotations });
    const pos = new THREE.Vector3();

    mesh.count = count;
    for (let i = 0; i < count; i++) {
      const [key] = surfaceEntries[i];
      const [x, y, z] = parseKey(key);
      pos.set(x, y, z);
      const partId = voxelToPartId.get(key);
      if (partId) {
        const tf = fk.get(partId);
        if (tf) pos.applyMatrix4(tf);
      }
      _dummy.position.copy(pos);
      _dummy.scale.set(1, 1, 1);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      const color = new THREE.Color(tint[0], tint[1], tint[2]);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [time, surfaceEntries, characterParts, characterPoses, voxelToPartId, keyframes, tint, count]);

  if (count === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(count, 1)]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial transparent opacity={opacity} vertexColors />
    </instancedMesh>
  );
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
  const colorByPart = useCharacterStore((s) => s.colorByPart);
  const partColors = useCharacterStore((s) => s.partColors);
  const boxSelection = useCharacterStore((s) => s.boxSelection);
  const isPlaying = useCharacterStore((s) => s.isPlaying);
  const selectedAnimation = useCharacterStore((s) => s.selectedAnimation);
  const animations = useCharacterStore((s) => s.animations);
  const playbackTime = useCharacterStore((s) => s.playbackTime);
  const mode = useCharacterStore((s) => s.mode);
  const xrayMode = useCharacterStore((s) => s.xrayMode);
  const onionSkinning = useCharacterStore((s) => s.onionSkinning);

  // Box select state
  const [boxStart, setBoxStart] = useState<[number, number, number] | null>(null);

  // Animation playback via useFrame
  useFrame((_, delta) => {
    if (!isPlaying || !selectedAnimation) return;
    const clip = animations[selectedAnimation];
    if (!clip) return;
    const store = useCharacterStore.getState();
    let newTime = store.playbackTime + delta * store.playbackSpeed;

    const playbackMode = store.playbackMode;
    if (playbackMode === 'loop') {
      if (newTime > clip.duration) newTime = newTime % clip.duration;
    } else if (playbackMode === 'ping-pong') {
      // Wrap within 2x duration, reverse direction in second half
      const period = clip.duration * 2;
      newTime = newTime % period;
      if (newTime > clip.duration) newTime = period - newTime;
    } else {
      // 'once' — clamp and stop
      if (newTime >= clip.duration) {
        newTime = clip.duration;
        store.togglePlayback(); // stop
      }
    }
    store.setPlaybackTime(newTime);
  });

  // Compute interpolated pose during animation playback or scrubbing
  const animationPose = useMemo(() => {
    if (mode !== 'animate' || !selectedAnimation) return null;
    const clip = animations[selectedAnimation];
    if (!clip || clip.keyframes.length === 0) return null;

    const kfs = clip.keyframes;
    const time = playbackTime;

    if (kfs.length === 1) {
      return characterPoses[kfs[0].poseName] ?? null;
    }

    // Build a PoseData with per-part eased interpolation
    const rotations: Record<string, [number, number, number]> = {};
    for (const part of characterParts) {
      rotations[part.id] = interpolatePartRotation(kfs, characterPoses, time, part.id);
    }
    return { rotations } as PoseData;
  }, [mode, selectedAnimation, animations, playbackTime, characterPoses, characterParts]);

  // Filter to surface-only voxels, then apply Y-clip
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

    if (yClip !== null) {
      filtered = filtered.filter(([key]) => {
        const [, y] = parseKey(key);
        return y <= yClip;
      });
    }

    return filtered;
  }, [voxels, yClip]);

  const count = surfaceEntries.length;

  const indexToKey = useMemo(() => {
    const map = new Map<number, VoxelKey>();
    surfaceEntries.forEach(([key], i) => map.set(i, key));
    return map;
  }, [surfaceEntries]);

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

  const voxelToPartId = useMemo(() => {
    const map = new Map<VoxelKey, string>();
    for (const part of characterParts) {
      for (const k of part.voxelKeys) map.set(k, part.id);
    }
    return map;
  }, [characterParts]);

  const boxSelectionSet = useMemo(() => {
    return boxSelection ? new Set(boxSelection) : null;
  }, [boxSelection]);

  // FK transforms: animation pose takes priority over preview pose
  const fkTransforms = useMemo(() => {
    if (animationPose) {
      return computeFKTransforms(characterParts, animationPose);
    }
    if (!previewPose || !selectedPose) return null;
    const pose = characterPoses[selectedPose];
    if (!pose) return null;
    return computeFKTransforms(characterParts, pose);
  }, [previewPose, selectedPose, characterPoses, characterParts, animationPose]);

  const { matrices, colors } = useMemo(() => {
    const mat = new Float32Array(count * 16);
    const col = new Float32Array(count * 3);
    const hasHighlighting = characterParts.length > 0 && selectedPart;
    const _pos = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const [key, voxel] = surfaceEntries[i];
      const [x, y, z] = parseKey(key);

      _pos.set(x, y, z);

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

      let r: number, g: number, b: number;

      if (colorByPart) {
        const partId = voxelToPartId.get(key);
        if (partId && partColors[partId]) {
          const pc = partColors[partId];
          r = srgbToLinear(pc[0]);
          g = srgbToLinear(pc[1]);
          b = srgbToLinear(pc[2]);
        } else {
          r = 0.3; g = 0.3; b = 0.3;
        }
      } else {
        r = srgbToLinear(voxel.color[0]);
        g = srgbToLinear(voxel.color[1]);
        b = srgbToLinear(voxel.color[2]);
      }

      if (hasHighlighting && !colorByPart) {
        if (selectedKeys.has(key)) {
          b = Math.min(1, b + 0.15);
        } else if (otherPartKeys.has(key)) {
          r *= 0.6; g *= 0.6; b *= 0.6;
        }
      }

      // Box selection highlight (green tint)
      if (boxSelectionSet?.has(key)) {
        g = Math.min(1, g + 0.2);
      }

      col[i * 3 + 0] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }

    return { matrices: mat, colors: col };
  }, [surfaceEntries, count, characterParts, selectedPart, selectedKeys, otherPartKeys, fkTransforms, voxelToPartId, colorByPart, partColors, boxSelectionSet]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;

    mesh.count = count;

    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;

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

    // In Animate mode, clicking always assigns voxels to the selected bone
    if (store.mode === 'animate') {
      const partId = store.selectedPart;
      if (!partId) return;
      store.pushUndo();
      const positions = brushPositions(x, y, z, store.brushSize);
      const keys = positions
        .filter(([px, py, pz]) => store.voxels.has(voxelKey(px, py, pz)))
        .map(([px, py, pz]) => voxelKey(px, py, pz));
      store.assignVoxelsToPart(keys, partId);
      return;
    }

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
      case 'fill': {
        store.pushUndo();
        store.fillVoxels(key);
        break;
      }
      case 'extrude': {
        const dy = e.button === 2 ? -1 : 1;
        store.pushUndo();
        // If there's a selection, extrude the selection; otherwise extrude the clicked voxel
        if (store.boxSelection || store.lassoSelection) {
          store.extrudeSelection(dy);
        } else {
          // Single voxel extrude: temporarily set selection to clicked voxel
          store.setBoxSelection([key]);
          store.extrudeSelection(dy);
          store.setBoxSelection(null);
        }
        break;
      }
      case 'box_select': {
        if (!boxStart) {
          setBoxStart([x, y, z]);
        } else {
          const [sx, sy, sz] = boxStart;
          const minX = Math.min(sx, x), maxX = Math.max(sx, x);
          const minY = Math.min(sy, y), maxY = Math.max(sy, y);
          const minZ = Math.min(sz, z), maxZ = Math.max(sz, z);
          const selected: VoxelKey[] = [];
          for (const [vk] of store.voxels) {
            const [vx, vy, vz] = parseKey(vk);
            if (vx >= minX && vx <= maxX && vy >= minY && vy <= maxY && vz >= minZ && vz <= maxZ) {
              selected.push(vk);
            }
          }
          store.setBoxSelection(selected);
          setBoxStart(null);
        }
        break;
      }
    }
  }, [indexToKey, boxStart]);

  // Compute previous/next keyframe times for onion skinning
  const { prevKfTime, nextKfTime } = useMemo(() => {
    if (!selectedAnimation || !onionSkinning) return { prevKfTime: null, nextKfTime: null };
    const clip = animations[selectedAnimation];
    if (!clip || clip.keyframes.length < 2) return { prevKfTime: null, nextKfTime: null };
    const kfs = clip.keyframes;
    let prev: number | null = null;
    let next: number | null = null;
    for (let i = 0; i < kfs.length; i++) {
      if (kfs[i].time < playbackTime) prev = kfs[i].time;
      if (kfs[i].time > playbackTime && next === null) next = kfs[i].time;
    }
    return { prevKfTime: prev, nextKfTime: next };
  }, [selectedAnimation, animations, playbackTime, onionSkinning]);

  return (
    <group>
      <instancedMesh
        key={count}
        ref={meshRef}
        args={[undefined, undefined, Math.max(count, 1)]}
        onClick={handleClick}
        onContextMenu={handleClick}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial transparent={xrayMode || colorByPart || !!boxSelection} opacity={xrayMode ? 0.3 : 1} />
      </instancedMesh>
      {onionSkinning && prevKfTime !== null && (
        <OnionGhost time={prevKfTime} tint={[0.3, 0.3, 1.0]} opacity={0.2}
          surfaceEntries={surfaceEntries} characterParts={characterParts}
          characterPoses={characterPoses} voxelToPartId={voxelToPartId}
          keyframes={animations[selectedAnimation!]?.keyframes ?? []} />
      )}
      {onionSkinning && nextKfTime !== null && (
        <OnionGhost time={nextKfTime} tint={[1.0, 0.3, 0.3]} opacity={0.2}
          surfaceEntries={surfaceEntries} characterParts={characterParts}
          characterPoses={characterPoses} voxelToPartId={voxelToPartId}
          keyframes={animations[selectedAnimation!]?.keyframes ?? []} />
      )}
    </group>
  );
}
