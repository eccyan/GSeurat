import React from 'react';
import { Line } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

export function NpcMarkers() {
  const npcs = useSceneStore((s) => s.npcs);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const setInspectorTab = useSceneStore((s) => s.setInspectorTab);

  if (!showGizmos) return null;

  return (
    <group>
      {npcs.map((npc) => (
        <group key={npc.id}>
          <mesh
            position={npc.position}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedEntity({ type: 'npc', id: npc.id });
              setInspectorTab('entities');
            }}
          >
            <cylinderGeometry args={[0.3, 0.3, 1.5, 8]} />
            <meshStandardMaterial color="#4fc3f7" transparent opacity={0.7} />
          </mesh>
          {npc.waypoints.length > 1 && (
            <Line
              points={npc.waypoints.map(([wx, wz]) => [wx, npc.position[1] + 0.1, wz] as [number, number, number])}
              color="#4fc3f7"
              lineWidth={2}
              dashed
              dashSize={0.5}
              gapSize={0.3}
            />
          )}
        </group>
      ))}
    </group>
  );
}
