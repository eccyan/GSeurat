import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

export function PortalMarkers() {
  const portals = useSceneStore((s) => s.portals);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const setInspectorTab = useSceneStore((s) => s.setInspectorTab);

  if (!showGizmos) return null;

  return (
    <group>
      {portals.map((portal) => (
        <mesh
          key={portal.id}
          position={[
            portal.position[0] + portal.size[0] / 2,
            1,
            portal.position[1] + portal.size[1] / 2,
          ]}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedEntity({ type: 'portal', id: portal.id });
            setInspectorTab('entities');
          }}
        >
          <boxGeometry args={[portal.size[0], 2, portal.size[1]]} />
          <meshBasicMaterial color="#ab47bc" wireframe transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  );
}
