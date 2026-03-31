import React, { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore.js';
import type { VfxInstanceData, VfxElementData } from '../store/types.js';
import { sampleCatmullRom } from '../lib/catmullRom.js';

// Element type colors
const ELEMENT_COLORS: Record<string, string> = {
  object: '#aaaaaa',
  emitter: '#ec4899',
  animation: '#06b6d4',
  light: '#eab308',
};

function EmitterSplineGizmo({ points, mode }: {
  points: [number, number, number][];
  mode: string;
}) {
  const curvePoints = useMemo(() => sampleCatmullRom(points, 64), [points]);
  const color = mode === 'emitter_path' ? '#22c55e' : '#f97316';

  return (
    <>
      <Line points={curvePoints} color={color} lineWidth={2} opacity={0.7} transparent />
      {points.map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshBasicMaterial color={color} opacity={0.7} transparent />
        </mesh>
      ))}
    </>
  );
}

function ElementGizmo({ element }: { element: VfxElementData }) {
  const pos = element.position ?? [0, 0, 0];
  const color = ELEMENT_COLORS[element.type] ?? '#888';

  return (
    <group position={pos}>
      {/* Center dot */}
      <mesh>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} />
      </mesh>
      {/* Type-specific gizmo */}
      {element.type === 'emitter' && (() => {
        const emitterData = element.emitter as Record<string, any> | undefined;
        const region = emitterData?.region;
        const spline = emitterData?.spline as { mode?: string; control_points?: [number, number, number][] } | undefined;
        return (
          <>
            {region ? (
              <mesh position={region.center ?? [0, 0, 0]}>
                {region.shape === 'sphere' ? (
                  <sphereGeometry args={[region.radius ?? 1, 16, 12]} />
                ) : (
                  <boxGeometry args={((region.half_extents ?? [1, 1, 1]) as [number, number, number]).map((v: number) => v * 2) as [number, number, number]} />
                )}
                <meshBasicMaterial color={color} wireframe transparent opacity={0.2} />
              </mesh>
            ) : (
              <mesh>
                <sphereGeometry args={[0.5, 8, 8]} />
                <meshBasicMaterial color={color} transparent opacity={0.15} />
              </mesh>
            )}
            {spline?.control_points && spline.control_points.length >= 2 && (
              <EmitterSplineGizmo points={spline.control_points} mode={spline.mode ?? 'emitter_path'} />
            )}
          </>
        );
      })()}
      {element.type === 'animation' && (
        <mesh>
          {element.region?.shape === 'box' ? (
            <boxGeometry args={((element.region?.half_extents ?? [2, 2, 2]) as [number, number, number]).map((v) => v * 2) as [number, number, number]} />
          ) : (
            <sphereGeometry args={[element.region?.radius ?? 2, 16, 12]} />
          )}
          <meshBasicMaterial color={color} wireframe transparent opacity={0.25} />
        </mesh>
      )}
      {element.type === 'object' && (
        <mesh rotation={[0, Math.PI / 4, 0]}>
          <octahedronGeometry args={[0.3]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
        </mesh>
      )}
      {element.type === 'light' && (() => {
        const light = element.light as Record<string, any> | undefined;
        const radius = light?.radius ?? 5;
        return (
          <>
            <mesh>
              <sphereGeometry args={[0.3, 8, 8]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} />
            </mesh>
            <mesh>
              <sphereGeometry args={[radius, 16, 12]} />
              <meshBasicMaterial color={color} wireframe transparent opacity={0.15} />
            </mesh>
          </>
        );
      })()}
      {/* Label */}
      <Html position={[0, 0.5, 0]} center>
        <div style={{
          fontSize: 8, color, whiteSpace: 'nowrap', opacity: 0.7,
          textShadow: '0 0 3px rgba(0,0,0,0.8)',
        }}>
          {element.name}
        </div>
      </Html>
    </group>
  );
}

function VfxMarker({ instance, isSelected, onSelect }: {
  instance: VfxInstanceData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { position, name, radius } = instance;
  const rotY = (instance.rotation_y ?? 0) * Math.PI / 180;
  const color = isSelected ? '#ffffff' : '#f59e0b';

  return (
    <group position={[position[0], position[1], position[2]]} rotation={[0, rotY, 0]}>
      {/* Invisible hit box */}
      <mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[1.0, 12, 12]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Center diamond */}
      <mesh rotation={[0, Math.PI / 4, 0]}>
        <octahedronGeometry args={[0.5]} />
        <meshBasicMaterial color={color} transparent opacity={isSelected ? 0.9 : 0.6} />
      </mesh>
      {/* Radius wireframe */}
      <mesh>
        <sphereGeometry args={[radius, 24, 16]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={isSelected ? 0.2 : 0.08} />
      </mesh>
      {/* Label */}
      {isSelected && (
        <Html position={[0, 1.2, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.7)', color: '#f59e0b',
            padding: '1px 5px', borderRadius: 3, fontSize: 10, whiteSpace: 'nowrap',
          }}>
            {name}
          </div>
        </Html>
      )}
      {/* Element gizmos (shown when selected) */}
      {isSelected && (instance.vfx_preset.elements ?? []).map((el, i) => (
        <ElementGizmo key={`${instance.id}_el_${i}`} element={el} />
      ))}
    </group>
  );
}

export function VfxInstanceMarkers() {
  const instances = useSceneStore((s) => s.vfxInstances);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  if (!showGizmos) return null;

  return (
    <group>
      {instances.map((v) => (
        <VfxMarker
          key={v.id}
          instance={v}
          isSelected={selectedEntity?.type === 'vfx_instance' && selectedEntity.id === v.id}
          onSelect={() => setSelectedEntity({ type: 'vfx_instance', id: v.id })}
        />
      ))}
    </group>
  );
}
