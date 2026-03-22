import React, { useCallback, useMemo } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { BodyPart, PoseData } from '../store/types.js';

const DEG2RAD = Math.PI / 180;

/** Compute posed joint positions via FK. */
function computePosedJoints(
  parts: BodyPart[],
  pose: PoseData,
): Map<string, [number, number, number]> {
  const result = new Map<string, [number, number, number]>();
  const partMap = new Map<string, BodyPart>();
  for (const p of parts) partMap.set(p.id, p);
  const tfCache = new Map<string, THREE.Matrix4>();

  function getTransform(partId: string): THREE.Matrix4 {
    const cached = tfCache.get(partId);
    if (cached) return cached;

    const part = partMap.get(partId);
    if (!part) {
      const identity = new THREE.Matrix4();
      tfCache.set(partId, identity);
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
    tfCache.set(partId, accumulated);
    return accumulated;
  }

  for (const part of parts) {
    const tf = getTransform(part.id);
    const v = new THREE.Vector3(part.joint[0], part.joint[1], part.joint[2]);
    v.applyMatrix4(tf);
    result.set(part.id, [v.x, v.y, v.z]);
  }

  return result;
}

export function JointGizmos() {
  const characterParts = useCharacterStore((s) => s.characterParts);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const showGizmos = useCharacterStore((s) => s.showGizmos);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);
  const previewPose = useCharacterStore((s) => s.previewPose);
  const selectedPose = useCharacterStore((s) => s.selectedPose);
  const characterPoses = useCharacterStore((s) => s.characterPoses);

  const handleClick = useCallback((partId: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    setSelectedPart(partId);
  }, [setSelectedPart]);

  // Compute posed joint positions
  const posedJoints = useMemo(() => {
    if (!previewPose || !selectedPose) return null;
    const pose = characterPoses[selectedPose];
    if (!pose) return null;
    return computePosedJoints(characterParts, pose);
  }, [previewPose, selectedPose, characterPoses, characterParts]);

  if (!showGizmos || characterParts.length === 0) return null;

  const partMap = new Map(characterParts.map((p) => [p.id, p]));

  return (
    <group>
      {characterParts.map((part) => {
        const isSelected = part.id === selectedPart;
        const jointPos = posedJoints?.get(part.id) ?? part.joint;
        const [jx, jy, jz] = jointPos;

        // Line to parent joint
        let line = null;
        if (part.parent) {
          const parent = partMap.get(part.parent);
          if (parent) {
            const parentPos = posedJoints?.get(part.parent) ?? parent.joint;
            const [px, py, pz] = parentPos;
            line = (
              <Line
                points={[[jx, jy, jz], [px, py, pz]]}
                color="#ffffff"
                lineWidth={1}
              />
            );
          }
        }

        return (
          <React.Fragment key={part.id}>
            {line}
            <mesh
              position={[jx, jy, jz]}
              onClick={handleClick(part.id)}
            >
              <sphereGeometry args={[0.3, 12, 12]} />
              <meshStandardMaterial
                color={isSelected ? '#ffcc00' : '#ffffff'}
                emissive={isSelected ? '#ffcc00' : '#444444'}
                emissiveIntensity={isSelected ? 0.5 : 0.2}
              />
            </mesh>
          </React.Fragment>
        );
      })}
    </group>
  );
}
