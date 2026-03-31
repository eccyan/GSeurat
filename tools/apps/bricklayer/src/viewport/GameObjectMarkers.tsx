import React from 'react';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';

function Marker({ id, name, position, hasComponents, isSelected, onSelect }: {
  id: string;
  name: string;
  position: [number, number, number];
  hasComponents: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = isSelected ? '#ffffff' : hasComponents ? '#4488ff' : '#888888';
  const opacity = isSelected ? 0.8 : 0.6;

  return (
    <group key={id}>
      {/* Invisible hit box for click detection */}
      <mesh
        position={position}
        onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <boxGeometry args={[1.5, 1.5, 1.5]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Visible wireframe cube */}
      <mesh position={position}>
        <boxGeometry args={[1.2, 1.2, 1.2]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={opacity}
        />
      </mesh>
      {/* Name label when selected */}
      {isSelected && (
        <Html position={[position[0], position[1] + 1.2, position[2]]} center>
          <div style={{
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: 3,
            fontSize: 10,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            {name}
          </div>
        </Html>
      )}
    </group>
  );
}

export function GameObjectMarkers() {
  const gameObjects = useSceneStore((s) => s.gameObjects);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {gameObjects.map((obj) => (
        <Marker
          key={obj.id}
          id={obj.id}
          name={obj.name}
          position={obj.position}
          hasComponents={Object.keys(obj.components).length > 0}
          isSelected={selectedEntity?.type === 'game_object' && selectedEntity.id === obj.id}
          onSelect={() => setSelectedEntity({ type: 'game_object', id: obj.id })}
        />
      ))}
    </group>
  );
}
