import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

export function LightGizmos() {
  const lights = useSceneStore((s) => s.staticLights);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const setInspectorTab = useSceneStore((s) => s.setInspectorTab);

  if (!showGizmos) return null;

  return (
    <group>
      {lights.map((light) => (
        <group
          key={light.id}
          position={[light.position[0], light.height, light.position[1]]}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedEntity({ type: 'light', id: light.id });
            setInspectorTab('lights');
          }}
        >
          <mesh>
            <sphereGeometry args={[0.3, 8, 8]} />
            <meshBasicMaterial
              color={`rgb(${Math.round(light.color[0] * 255)},${Math.round(light.color[1] * 255)},${Math.round(light.color[2] * 255)})`}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[light.radius - 0.05, light.radius + 0.05, 32]} />
            <meshBasicMaterial
              color={`rgb(${Math.round(light.color[0] * 255)},${Math.round(light.color[1] * 255)},${Math.round(light.color[2] * 255)})`}
              transparent
              opacity={0.5}
              side={2}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
