import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CameraZoneVolume, CameraZoneParams } from '../store/types.js';

const DISPLAY_DIST = 8;
const ASPECT = 9 / 16; // 16:9 assumed

/** Build arc points in the XY plane (local) sweeping from startDeg to endDeg at radius r */
function arcPoints(startDeg: number, endDeg: number, radius: number, steps = 24): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const startRad = startDeg * Math.PI / 180;
  const endRad = endDeg * Math.PI / 180;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = startRad + t * (endRad - startRad);
    pts.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  return pts;
}

/** Build a fan shape (origin + arc) as a ShapeGeometry */
function buildFanGeometry(startDeg: number, endDeg: number, radius: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const arc = arcPoints(startDeg, endDeg, radius);
  shape.moveTo(arc[0].x, arc[0].y);
  arc.forEach((p) => shape.lineTo(p.x, p.y));
  shape.lineTo(0, 0);
  return new THREE.ShapeGeometry(shape);
}

function FrustumGizmo({ volume }: { volume: CameraZoneVolume }) {
  const { params, shape } = volume;
  const cameraRails = useSceneStore((s) => s.cameraRails);

  const cameraOrigin = useMemo(() => {
    const center = shape.center;
    const offset = params.offset ?? [0, 5, -10];

    switch (params.mode) {
      case 'fixed_point': {
        if (params.fixed_position) return new THREE.Vector3(...params.fixed_position);
        // Fall through to free_look default
        break;
      }
      case 'rail_follow':
      case 'cinematic_rail': {
        if (params.rail_id) {
          const rail = cameraRails.find((r) => r.id === params.rail_id);
          if (rail && rail.control_points.length > 0) {
            return new THREE.Vector3(...rail.control_points[0]);
          }
        }
        break;
      }
      case 'side_scroll': {
        return new THREE.Vector3(
          center[0] + offset[0],
          center[1] + offset[1],
          center[2] + offset[2],
        );
      }
      default:
        break;
    }

    // free_look default: center + offset + orbit at azimuth=0, elevation=0
    const orbitDist = params.orbit_distance ?? 10;
    return new THREE.Vector3(
      center[0] + offset[0],
      center[1] + offset[1],
      center[2] + offset[2] + orbitDist,
    );
  }, [params, shape.center, cameraRails]);

  const frustumData = useMemo(() => {
    const fov = params.fov ?? 45;
    const halfFovRad = (fov / 2) * Math.PI / 180;
    const halfW = Math.tan(halfFovRad) * DISPLAY_DIST;
    const halfH = halfW * ASPECT;

    const origin = cameraOrigin;
    const forward = new THREE.Vector3(0, 0, -1); // camera looks -Z in local space

    // 4 corner positions in world space (origin + local offset)
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const corners: [number, number, number][] = [
      [ox - halfW, oy + halfH, oz - DISPLAY_DIST],
      [ox + halfW, oy + halfH, oz - DISPLAY_DIST],
      [ox + halfW, oy - halfH, oz - DISPLAY_DIST],
      [ox - halfW, oy - halfH, oz - DISPLAY_DIST],
    ];

    return { origin, corners, forward };
  }, [params.fov, cameraOrigin]);

  const { origin, corners } = frustumData;

  // Frustum edge lines: origin → each corner, plus the near rect connecting corners
  const frustumLines = useMemo(() => {
    const o = [origin.x, origin.y, origin.z] as [number, number, number];
    const lines: { points: [number, number, number][]; }[] = [
      // 4 rays from origin to corners
      { points: [o, corners[0]] },
      { points: [o, corners[1]] },
      { points: [o, corners[2]] },
      { points: [o, corners[3]] },
      // near rect
      { points: [corners[0], corners[1], corners[2], corners[3], corners[0]] },
    ];
    return lines;
  }, [origin, corners]);

  // Pitch constraint fan (vertical arc in YZ plane at camera origin)
  const pitchFanGeo = useMemo(() => {
    const pMin = params.pitch_min ?? -60;
    const pMax = params.pitch_max ?? 10;
    const isDefault = pMin <= -90 && pMax >= 90;
    if (isDefault) return null;
    return buildFanGeometry(pMin, pMax, DISPLAY_DIST * 0.6);
  }, [params.pitch_min, params.pitch_max]);

  // Yaw constraint fan (horizontal arc in XZ plane at camera origin)
  const yawFanGeo = useMemo(() => {
    const yMin = params.yaw_min ?? -180;
    const yMax = params.yaw_max ?? 180;
    const isDefault = yMin <= -180 && yMax >= 180;
    if (isDefault) return null;
    return buildFanGeometry(yMin, yMax, DISPLAY_DIST * 0.6);
  }, [params.yaw_min, params.yaw_max]);

  const isFixedPoint = params.mode === 'fixed_point';
  const volumeCenter = new THREE.Vector3(...shape.center);

  return (
    <group>
      {/* Frustum lines */}
      {frustumLines.map((line, i) => (
        <Line
          key={i}
          points={line.points}
          color="#00ffff"
          lineWidth={1.5}
          opacity={0.7}
          transparent
        />
      ))}

      {/* Pitch constraint fan — rotated to stand vertical (XZ → XY) */}
      {pitchFanGeo && (
        <mesh
          geometry={pitchFanGeo}
          position={[origin.x, origin.y, origin.z]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <meshBasicMaterial
            color="#00ffff"
            opacity={0.12}
            transparent
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Yaw constraint fan — flat on XZ plane */}
      {yawFanGeo && (
        <mesh
          geometry={yawFanGeo}
          position={[origin.x, origin.y, origin.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <meshBasicMaterial
            color="#00ffff"
            opacity={0.12}
            transparent
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Camera icon for fixed_point mode */}
      {isFixedPoint && (
        <group position={[origin.x, origin.y, origin.z]}>
          {/* Camera body */}
          <mesh>
            <boxGeometry args={[0.8, 0.5, 0.5]} />
            <meshBasicMaterial color="#00ffff" opacity={0.8} transparent />
          </mesh>
          {/* Lens cone */}
          <mesh position={[0.65, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.3, 0.4, 12]} />
            <meshBasicMaterial color="#00ffff" opacity={0.8} transparent />
          </mesh>
          {/* Dashed line from camera icon to volume center */}
          <Line
            points={[
              [0, 0, 0],
              [
                volumeCenter.x - origin.x,
                volumeCenter.y - origin.y,
                volumeCenter.z - origin.z,
              ],
            ]}
            color="#00cccc"
            lineWidth={1}
            opacity={0.4}
            transparent
            dashed
            dashScale={3}
          />
        </group>
      )}
    </group>
  );
}

export function CameraFrustumGizmo() {
  const cameraVolumes = useSceneStore((s) => s.cameraVolumes);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const showGizmos = useSceneStore((s) => s.showGizmos);

  if (!showGizmos) return null;
  if (!selectedEntity || selectedEntity.type !== 'camera_volume') return null;

  const volume = cameraVolumes.find((v) => v.id === selectedEntity.id);
  if (!volume) return null;

  return <FrustumGizmo volume={volume} />;
}
