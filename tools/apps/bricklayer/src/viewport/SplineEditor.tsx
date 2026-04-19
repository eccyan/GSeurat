import React, { useRef, useEffect, useCallback } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { sampleCatmullRom } from '@gseurat/vfx-utils';
import { useSceneStore } from '../store/useSceneStore.js';

function snap(val: number): number {
  return Math.round(val * 10) / 10;
}

/**
 * Interactive spline editor rendered inside the R3F Canvas.
 * Active when `editingSpline` is set in the scene store.
 */
export function SplineEditor() {
  const editingSpline = useSceneStore((s) => s.editingSpline);
  const setEditingSpline = useSceneStore((s) => s.setEditingSpline);
  const vfxInstances = useSceneStore((s) => s.vfxInstances);
  const updateVfxInstance = useSceneStore((s) => s.updateVfxInstance);

  const { camera, gl } = useThree();
  const dragIndexRef = useRef<number | null>(null);

  const instance = editingSpline
    ? vfxInstances.find((v) => v.id === editingSpline) ?? null
    : null;

  // Escape key exits edit mode
  useEffect(() => {
    if (!editingSpline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingSpline(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingSpline, setEditingSpline]);

  const points = instance?.splinePoints ?? [];
  const instancePos = instance?.position ?? [0, 0, 0];

  // Compute Catmull-Rom curve samples
  const curvePoints = points.length >= 2 ? sampleCatmullRom(points, 64) : [];

  // Convert curve points (relative) to world-space for Line
  const linePoints = curvePoints.map(
    (p: [number, number, number]) =>
      new THREE.Vector3(
        p[0] + instancePos[0],
        p[1] + instancePos[1],
        p[2] + instancePos[2],
      ),
  );

  // Raycast against the horizontal plane at the instance's Y
  const raycastGroundPlane = useCallback(
    (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const plane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -instancePos[1],
      );
      const hit = new THREE.Vector3();
      const ok = raycaster.ray.intersectPlane(plane, hit);
      return ok ? hit : null;
    },
    [camera, gl, instancePos],
  );

  // Ground plane: click-to-place and drag tracking
  const handleGroundPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (dragIndexRef.current === null) return;
      if (!editingSpline || !instance) return;

      const hit = raycastGroundPlane(e.nativeEvent.clientX, e.nativeEvent.clientY);
      if (!hit) return;

      const rx = snap(hit.x - instancePos[0]);
      const ry = snap(hit.y - instancePos[1]);
      const rz = snap(hit.z - instancePos[2]);

      const newPoints = [...(instance.splinePoints ?? [])];
      newPoints[dragIndexRef.current] = [rx, ry, rz];
      updateVfxInstance(editingSpline, { splinePoints: newPoints });
    },
    [editingSpline, instance, instancePos, raycastGroundPlane, updateVfxInstance],
  );

  const handleGroundPointerUp = useCallback(() => {
    dragIndexRef.current = null;
  }, []);

  const handleGroundClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (e.button !== 0) return;
      if (dragIndexRef.current !== null) return;
      if (!editingSpline || !instance) return;

      const hit = raycastGroundPlane(e.nativeEvent.clientX, e.nativeEvent.clientY);
      if (!hit) return;

      const rx = snap(hit.x - instancePos[0]);
      const ry = snap(hit.y - instancePos[1]);
      const rz = snap(hit.z - instancePos[2]);

      const newPoints = [...(instance.splinePoints ?? []), [rx, ry, rz] as [number, number, number]];
      updateVfxInstance(editingSpline, { splinePoints: newPoints });
    },
    [editingSpline, instance, instancePos, raycastGroundPlane, updateVfxInstance],
  );

  // Control point handlers
  const handleSpherePointerDown = useCallback(
    (index: number) => (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      dragIndexRef.current = index;
    },
    [],
  );

  const handleSphereContextMenu = useCallback(
    (index: number) => (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (!editingSpline || !instance) return;
      const newPoints = (instance.splinePoints ?? []).filter((_, i) => i !== index);
      updateVfxInstance(editingSpline, { splinePoints: newPoints });
    },
    [editingSpline, instance, updateVfxInstance],
  );

  if (!editingSpline || !instance) return null;

  return (
    <group position={[instancePos[0], instancePos[1], instancePos[2]]}>
      {/* Interpolated curve */}
      {linePoints.length >= 2 && (
        <Line
          points={linePoints.map((p) => p.toArray() as [number, number, number])}
          color="#fbbf24"
          lineWidth={3}
        />
      )}

      {/* Control point spheres */}
      {points.map((pt, i) => (
        <mesh
          key={i}
          position={[pt[0], pt[1], pt[2]]}
          onPointerDown={handleSpherePointerDown(i)}
          onContextMenu={handleSphereContextMenu(i)}
        >
          <sphereGeometry args={[0.6, 16, 16]} />
          <meshStandardMaterial color="#f59e0b" />
        </mesh>
      ))}

      {/* Invisible ground plane for click-to-place and drag tracking */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        onPointerMove={handleGroundPointerMove}
        onPointerUp={handleGroundPointerUp}
        onClick={handleGroundClick}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
