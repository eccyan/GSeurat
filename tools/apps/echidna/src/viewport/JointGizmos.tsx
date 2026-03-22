import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ThreeEvent, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Line, Html } from '@react-three/drei';
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

const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();

function DraggableJoint({ part, isSelected, jointPos, parentPos, onSelect }: {
  part: BodyPart;
  isSelected: boolean;
  jointPos: [number, number, number];
  parentPos: [number, number, number] | null;
  onSelect: (id: string) => void;
}) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<[number, number, number] | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const [jx, jy, jz] = dragPos ?? jointPos;

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onSelect(part.id);

    const el = gl.domElement;
    // Use horizontal plane at joint Y for intuitive dragging
    _plane.set(new THREE.Vector3(0, 1, 0), -jointPos[1]);

    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      _raycaster.setFromCamera(pointer, camera);
      if (_raycaster.ray.intersectPlane(_plane, _intersection)) {
        setDragPos([
          Math.round(_intersection.x),
          jointPos[1],
          Math.round(_intersection.z),
        ]);
      }
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      setDragging(false);
      // Read latest dragPos from closure - use _intersection as last known
      const snapped: [number, number, number] = [
        Math.round(_intersection.x),
        jointPos[1],
        Math.round(_intersection.z),
      ];
      useCharacterStore.getState().updatePartJoint(part.id, snapped);
      setDragPos(null);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [part.id, onSelect, camera, gl, jointPos]);

  return (
    <>
      {parentPos && (
        <Line
          points={[[jx, jy, jz], parentPos]}
          color="#ffffff"
          lineWidth={1}
        />
      )}
      <mesh
        ref={meshRef}
        position={[jx, jy, jz]}
        onPointerDown={handlePointerDown}
      >
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshStandardMaterial
          color={dragging ? '#ff8800' : isSelected ? '#ffcc00' : '#ffffff'}
          emissive={dragging ? '#ff8800' : isSelected ? '#ffcc00' : '#444444'}
          emissiveIntensity={isSelected || dragging ? 0.5 : 0.2}
        />
      </mesh>
      {dragging && (
        <Html position={[jx, jy + 1.5, jz]} center>
          <div style={{
            background: 'rgba(0,0,0,0.8)',
            color: '#ffcc00',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 11,
            whiteSpace: 'nowrap',
          }}>
            {Math.round(jx)}, {Math.round(jy)}, {Math.round(jz)}
          </div>
        </Html>
      )}
    </>
  );
}

export function JointGizmos() {
  const characterParts = useCharacterStore((s) => s.characterParts);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const showGizmos = useCharacterStore((s) => s.showGizmos);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);
  const previewPose = useCharacterStore((s) => s.previewPose);
  const selectedPose = useCharacterStore((s) => s.selectedPose);
  const characterPoses = useCharacterStore((s) => s.characterPoses);

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

        let parentPos: [number, number, number] | null = null;
        if (part.parent) {
          const parent = partMap.get(part.parent);
          if (parent) {
            parentPos = posedJoints?.get(part.parent) ?? parent.joint;
          }
        }

        return (
          <DraggableJoint
            key={part.id}
            part={part}
            isSelected={isSelected}
            jointPos={jointPos}
            parentPos={parentPos}
            onSelect={setSelectedPart}
          />
        );
      })}
    </group>
  );
}
