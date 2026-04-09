import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CameraZoneRail } from '../store/types.js';

function RailMarker({ rail, isSelected, selectedPointIndex, onSelect, onSelectPoint, onMovePoint }: {
  rail: CameraZoneRail;
  isSelected: boolean;
  selectedPointIndex: number | null;
  onSelect: () => void;
  onSelectPoint: (index: number) => void;
  onMovePoint: (index: number, pos: [number, number, number]) => void;
}) {
  const pointRefs = useRef<(THREE.Mesh | null)[]>([]);

  const curveLine = useMemo(() => {
    if (rail.control_points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(
      rail.control_points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'catmullrom',
    );
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
    const mat = new THREE.LineBasicMaterial({ color: isSelected ? '#ffff00' : '#cccc00', depthTest: false });
    return new THREE.Line(geo, mat);
  }, [rail.control_points, isSelected]);

  const targetCurveLine = useMemo(() => {
    if (!rail.target_points || rail.target_points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(
      rail.target_points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'catmullrom',
    );
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
    const mat = new THREE.LineDashedMaterial({ color: '#ff8800', dashSize: 1, gapSize: 0.5, depthTest: false });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    return line;
  }, [rail.target_points]);

  return (
    <group>
      {/* Main rail spline */}
      {curveLine && <primitive object={curveLine} />}

      {/* Target points spline (dashed orange) */}
      {targetCurveLine && <primitive object={targetCurveLine} />}

      {/* Control point spheres */}
      {rail.control_points.map((pt, i) => {
        const isPointSelected = isSelected && selectedPointIndex === i;
        return (
          <React.Fragment key={i}>
            <mesh
              ref={(el) => { pointRefs.current[i] = el; }}
              position={[pt[0], pt[1], pt[2]]}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect();
                onSelectPoint(i);
              }}
            >
              <sphereGeometry args={[isPointSelected ? 0.45 : 0.3, 12, 8]} />
              <meshBasicMaterial
                color={isPointSelected ? '#ffffff' : (isSelected ? '#ffff00' : '#cccc00')}
              />
            </mesh>
            {isPointSelected && pointRefs.current[i] && (
              <TransformControls
                object={pointRefs.current[i]!}
                mode="translate"
                onObjectChange={(e) => {
                  const pos = (e as { target?: { object?: THREE.Object3D } })?.target?.object?.position;
                  if (pos) onMovePoint(i, [pos.x, pos.y, pos.z]);
                }}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* Rail name label */}
      {isSelected && rail.control_points.length > 0 && (
        <Html position={[
          rail.control_points[0][0],
          rail.control_points[0][1] + 1.5,
          rail.control_points[0][2],
        ]} center>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#ffff00',
            padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
          }}>
            {rail.name}
          </div>
        </Html>
      )}

      {/* Invisible click zone at first control point when not selected */}
      {!isSelected && rail.control_points.length > 0 && (
        <mesh
          position={[
            rail.control_points[0][0],
            rail.control_points[0][1],
            rail.control_points[0][2],
          ]}
          onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
        >
          <sphereGeometry args={[1.0, 8, 8]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
    </group>
  );
}

export function CameraRailMarkers() {
  const cameraRails = useSceneStore((s) => s.cameraRails);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const updateRailControlPoint = useSceneStore((s) => s.updateRailControlPoint);

  // Track which control point index is selected for the active rail
  const selectedPointIndex = useMemo(() => {
    if (!selectedEntity || selectedEntity.type !== 'camera_rail') return null;
    // Store the selected point index in the entity id as "railId:pointIndex"
    const parts = selectedEntity.id.split(':');
    if (parts.length === 2) return parseInt(parts[1], 10);
    return null;
  }, [selectedEntity]);

  const selectedRailId = useMemo(() => {
    if (!selectedEntity || selectedEntity.type !== 'camera_rail') return null;
    return selectedEntity.id.split(':')[0];
  }, [selectedEntity]);

  if (!showGizmos) return null;

  return (
    <group>
      {cameraRails.map((rail) => (
        <RailMarker
          key={rail.id}
          rail={rail}
          isSelected={selectedRailId === rail.id}
          selectedPointIndex={selectedRailId === rail.id ? selectedPointIndex : null}
          onSelect={() => setSelectedEntity({ type: 'camera_rail', id: rail.id })}
          onSelectPoint={(index) =>
            setSelectedEntity({ type: 'camera_rail', id: `${rail.id}:${index}` })
          }
          onMovePoint={(index, pos) => updateRailControlPoint(rail.id, index, pos)}
        />
      ))}
    </group>
  );
}
