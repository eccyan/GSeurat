import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';

const DEG2RAD = THREE.MathUtils.degToRad;

interface ColliderShape {
  type: string;
  half_extents?: [number, number, number];
  radius?: number;
  half_height?: number;
}

function ColliderWireframe({ shape, color, opacity }: {
  shape: ColliderShape;
  color: string;
  opacity: number;
}) {
  const edgesGeo = useMemo(() => {
    if (shape.type === 'box') {
      const [hx, hy, hz] = shape.half_extents ?? [0.5, 0.5, 0.5];
      return new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz));
    } else if (shape.type === 'sphere') {
      const r = shape.radius ?? 0.5;
      return new THREE.EdgesGeometry(new THREE.SphereGeometry(r, 24, 16));
    } else {
      // capsule
      const r = shape.radius ?? 0.3;
      const hh = shape.half_height ?? 0.5;
      return new THREE.EdgesGeometry(new THREE.CapsuleGeometry(r, 2 * hh, 12, 8));
    }
  }, [shape.type, shape.half_extents, shape.radius, shape.half_height]);

  return (
    <lineSegments geometry={edgesGeo}>
      <lineBasicMaterial color={color} transparent opacity={opacity} />
    </lineSegments>
  );
}

function ColliderFill({ shape, color, opacity }: {
  shape: ColliderShape;
  color: string;
  opacity: number;
}) {
  if (shape.type === 'box') {
    const [hx, hy, hz] = shape.half_extents ?? [0.5, 0.5, 0.5];
    return (
      <mesh>
        <boxGeometry args={[2 * hx, 2 * hy, 2 * hz]} />
        <meshBasicMaterial color={color} opacity={opacity} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  } else if (shape.type === 'sphere') {
    const r = shape.radius ?? 0.5;
    return (
      <mesh>
        <sphereGeometry args={[r, 24, 16]} />
        <meshBasicMaterial color={color} opacity={opacity} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  } else {
    const r = shape.radius ?? 0.3;
    const hh = shape.half_height ?? 0.5;
    return (
      <mesh>
        <capsuleGeometry args={[r, 2 * hh, 12, 8]} />
        <meshBasicMaterial color={color} opacity={opacity} transparent side={THREE.DoubleSide} />
      </mesh>
    );
  }
}

function ColliderHitMesh({ shape, onSelect }: {
  shape: ColliderShape;
  onSelect: () => void;
}) {
  if (shape.type === 'box') {
    const [hx, hy, hz] = shape.half_extents ?? [0.5, 0.5, 0.5];
    return (
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <boxGeometry args={[2 * hx, 2 * hy, 2 * hz]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    );
  } else if (shape.type === 'sphere') {
    const r = shape.radius ?? 0.5;
    return (
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[r, 24, 16]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    );
  } else {
    const r = shape.radius ?? 0.3;
    const hh = shape.half_height ?? 0.5;
    return (
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <capsuleGeometry args={[r, 2 * hh, 12, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    );
  }
}

function SingleColliderMarker({ objPosition, objRotation, collider, isSelected, showCollision, onSelect }: {
  objPosition: [number, number, number];
  objRotation: [number, number, number];
  collider: Record<string, unknown>;
  isSelected: boolean;
  showCollision: boolean;
  onSelect: () => void;
}) {
  const shape = collider.shape as ColliderShape | undefined;
  if (!shape || !shape.type) return null;

  const offset = (collider.offset as [number, number, number]) ?? [0, 0, 0];
  const isTrigger = (collider.is_trigger as boolean) ?? false;
  const localRotation = (collider.local_rotation as [number, number, number, number]) ?? [0, 0, 0, 1];

  // Visibility: selected always visible; unselected only when showCollision is ON
  const visible = isSelected || showCollision;
  if (!visible) return null;

  // Colors: green for solid, orange for trigger
  const wireColor = isTrigger
    ? (isSelected ? '#ff8800' : '#885500')
    : (isSelected ? '#00ff44' : '#228833');
  const wireOpacity = isSelected ? 1.0 : 0.3;
  const fillOpacity = isSelected ? 0.08 : 0.04;

  return (
    <group
      position={objPosition}
      rotation={[DEG2RAD(objRotation[0]), DEG2RAD(objRotation[1]), DEG2RAD(objRotation[2])]}
    >
      <group quaternion={localRotation}>
        <group position={offset}>
          <ColliderWireframe shape={shape} color={wireColor} opacity={wireOpacity} />
          <ColliderFill shape={shape} color={wireColor} opacity={fillOpacity} />
          <ColliderHitMesh shape={shape} onSelect={onSelect} />
        </group>
      </group>
    </group>
  );
}

export function ColliderMarkers() {
  const gameObjects = useSceneStore((s) => s.gameObjects);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const showCollision = useSceneStore((s) => s.showCollision);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {gameObjects.map((obj) => {
        const collider = obj.components['ColliderComponent'] as Record<string, unknown> | undefined;
        if (!collider) return null;
        const isSelected = selectedEntity?.type === 'game_object' && selectedEntity.id === obj.id;
        return (
          <SingleColliderMarker
            key={obj.id}
            objPosition={obj.position}
            objRotation={obj.rotation}
            collider={collider}
            isSelected={isSelected}
            showCollision={showCollision}
            onSelect={() => setSelectedEntity({ type: 'game_object', id: obj.id })}
          />
        );
      })}
    </group>
  );
}
