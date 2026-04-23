import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';
import type { AudioZoneData } from '../store/types.js';

function AudioZoneMarker({ zone, isSelected, onSelect }: {
  zone: AudioZoneData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const edgeColor = isSelected ? '#4488ff' : '#2255aa';
  const edgeOpacity = isSelected ? 1.0 : 0.5;

  const { center, halfExtents } = useMemo(() => {
    const mn = zone.bounds.min;
    const mx = zone.bounds.max;
    return {
      center: [
        (mn[0] + mx[0]) / 2,
        (mn[1] + mx[1]) / 2,
        (mn[2] + mx[2]) / 2,
      ] as [number, number, number],
      halfExtents: [
        (mx[0] - mn[0]) / 2,
        (mx[1] - mn[1]) / 2,
        (mx[2] - mn[2]) / 2,
      ] as [number, number, number],
    };
  }, [zone.bounds.min, zone.bounds.max]);

  const edgesGeo = useMemo(() => {
    return new THREE.EdgesGeometry(
      new THREE.BoxGeometry(2 * halfExtents[0], 2 * halfExtents[1], 2 * halfExtents[2])
    );
  }, [halfExtents]);

  const labelY = Math.max(...halfExtents) + 1.2;

  return (
    <group position={center}>
      {/* Center gizmo — visible solid cube as click target */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <boxGeometry args={[1.5, 1.5, 1.5]} />
        <meshBasicMaterial color={edgeColor} />
      </mesh>
      {/* Wireframe edges */}
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color={edgeColor} transparent opacity={edgeOpacity} />
      </lineSegments>
      {/* Semi-transparent fill */}
      <mesh>
        <boxGeometry args={[2 * halfExtents[0], 2 * halfExtents[1], 2 * halfExtents[2]]} />
        <meshBasicMaterial color="#4488ff" opacity={0.06} transparent side={THREE.DoubleSide} />
      </mesh>
      {/* Label when selected */}
      {isSelected && (
        <Html position={[0, labelY, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#4488ff',
            padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
          }}>
            {zone.name}
          </div>
        </Html>
      )}
    </group>
  );
}

export function AudioZoneMarkers() {
  const audioZones = useSceneStore((s) => s.audioZones);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {audioZones.map((zone) => (
        <AudioZoneMarker
          key={zone.id}
          zone={zone}
          isSelected={selectedEntity?.type === 'audio_zone' && selectedEntity.id === zone.id}
          onSelect={() => setSelectedEntity({ type: 'audio_zone', id: zone.id })}
        />
      ))}
    </group>
  );
}
