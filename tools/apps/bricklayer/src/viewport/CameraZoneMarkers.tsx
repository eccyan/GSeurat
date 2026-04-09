import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CameraZoneVolume, CameraZoneTrigger, CameraShape } from '../store/types.js';

function ShapeWireframe({ shape, color, opacity = 1 }: { shape: CameraShape; color: string; opacity?: number }) {
  const edgesGeo = useMemo(() => {
    if (shape.type === 'aabb') {
      const [hx, hy, hz] = shape.half_extents ?? [2, 2, 2];
      return new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz));
    } else {
      const r = shape.radius ?? 2;
      return new THREE.EdgesGeometry(new THREE.SphereGeometry(r, 24, 16));
    }
  }, [shape]);

  return (
    <lineSegments geometry={edgesGeo}>
      <lineBasicMaterial color={color} transparent opacity={opacity} />
    </lineSegments>
  );
}

function ShapeFill({ shape }: { shape: CameraShape }) {
  if (shape.type === 'aabb') {
    const [hx, hy, hz] = shape.half_extents ?? [2, 2, 2];
    return (
      <mesh>
        <boxGeometry args={[2 * hx, 2 * hy, 2 * hz]} />
        <meshBasicMaterial color="#00ccff" opacity={0.08} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  } else {
    const r = shape.radius ?? 2;
    return (
      <mesh>
        <sphereGeometry args={[r, 24, 16]} />
        <meshBasicMaterial color="#00ccff" opacity={0.08} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  }
}

function VolumeMarker({ volume, isSelected, onSelect, onMove }: {
  volume: CameraZoneVolume;
  isSelected: boolean;
  onSelect: () => void;
  onMove: (pos: [number, number, number]) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { shape } = volume;
  const edgeColor = isSelected ? '#00ffff' : '#00cccc';
  const edgeOpacity = isSelected ? 1.0 : 0.5;
  const center = shape.center;

  const hitSize = useMemo(() => {
    if (shape.type === 'aabb') {
      return Math.max(...(shape.half_extents ?? [2, 2, 2]));
    }
    return shape.radius ?? 2;
  }, [shape]);

  return (
    <>
      <group ref={groupRef} position={[center[0], center[1], center[2]]}>
        {/* Invisible hit mesh */}
        <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
          <sphereGeometry args={[Math.max(hitSize, 1.5), 12, 12]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        {/* Wireframe edges */}
        <ShapeWireframe shape={shape} color={edgeColor} opacity={edgeOpacity} />
        {/* Semi-transparent fill */}
        <ShapeFill shape={shape} />
        {/* Label when selected */}
        {isSelected && (
          <Html position={[0, hitSize + 1.2, 0]} center>
            <div style={{
              background: 'rgba(0,0,0,0.7)', color: '#00ffff',
              padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
            }}>
              {volume.name}
            </div>
          </Html>
        )}
      </group>
      {isSelected && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode="translate"
          onObjectChange={(e) => {
            const pos = (e as { target?: { object?: THREE.Object3D } })?.target?.object?.position;
            if (pos) onMove([pos.x, pos.y, pos.z]);
          }}
        />
      )}
    </>
  );
}

function TriggerMarker({ trigger, isSelected, onSelect, onMove }: {
  trigger: CameraZoneTrigger;
  isSelected: boolean;
  onSelect: () => void;
  onMove: (pos: [number, number, number]) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { shape } = trigger;
  const edgeColor = isSelected ? '#ff00ff' : '#cc00cc';
  const edgeOpacity = isSelected ? 1.0 : 0.5;
  const center = shape.center;

  const hitSize = useMemo(() => {
    if (shape.type === 'aabb') {
      return Math.max(...(shape.half_extents ?? [2, 2, 2]));
    }
    return shape.radius ?? 2;
  }, [shape]);

  const fillGeo = useMemo(() => {
    if (shape.type === 'aabb') {
      const [hx, hy, hz] = shape.half_extents ?? [2, 2, 2];
      return <boxGeometry args={[2 * hx, 2 * hy, 2 * hz]} />;
    } else {
      const r = shape.radius ?? 2;
      return <sphereGeometry args={[r, 24, 16]} />;
    }
  }, [shape]);

  return (
    <>
      <group ref={groupRef} position={[center[0], center[1], center[2]]}>
        {/* Invisible hit mesh */}
        <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
          <sphereGeometry args={[Math.max(hitSize, 1.5), 12, 12]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        {/* Wireframe edges */}
        <ShapeWireframe shape={shape} color={edgeColor} opacity={edgeOpacity} />
        {/* Semi-transparent fill */}
        <mesh>
          {fillGeo}
          <meshBasicMaterial color="#ff00ff" opacity={0.08} transparent side={THREE.DoubleSide} />
        </mesh>
        {/* Label when selected */}
        {isSelected && (
          <Html position={[0, hitSize + 1.2, 0]} center>
            <div style={{
              background: 'rgba(0,0,0,0.7)', color: '#ff00ff',
              padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
            }}>
              Trigger → {trigger.to_zone}
            </div>
          </Html>
        )}
      </group>
      {isSelected && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode="translate"
          onObjectChange={(e) => {
            const pos = (e as { target?: { object?: THREE.Object3D } })?.target?.object?.position;
            if (pos) onMove([pos.x, pos.y, pos.z]);
          }}
        />
      )}
    </>
  );
}

export function CameraZoneMarkers() {
  const cameraVolumes = useSceneStore((s) => s.cameraVolumes);
  const cameraTriggers = useSceneStore((s) => s.cameraTriggers);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const updateCameraVolume = useSceneStore((s) => s.updateCameraVolume);
  const updateCameraTrigger = useSceneStore((s) => s.updateCameraTrigger);

  if (!showGizmos) return null;

  return (
    <group>
      {cameraVolumes.map((volume) => (
        <VolumeMarker
          key={volume.id}
          volume={volume}
          isSelected={selectedEntity?.type === 'camera_volume' && selectedEntity.id === volume.id}
          onSelect={() => setSelectedEntity({ type: 'camera_volume', id: volume.id })}
          onMove={(pos) => updateCameraVolume(volume.id, {
            shape: { ...volume.shape, center: pos },
          })}
        />
      ))}
      {cameraTriggers.map((trigger) => (
        <TriggerMarker
          key={trigger.id}
          trigger={trigger}
          isSelected={selectedEntity?.type === 'camera_trigger' && selectedEntity.id === trigger.id}
          onSelect={() => setSelectedEntity({ type: 'camera_trigger', id: trigger.id })}
          onMove={(pos) => updateCameraTrigger(trigger.id, {
            shape: { ...trigger.shape, center: pos },
          })}
        />
      ))}
    </group>
  );
}
