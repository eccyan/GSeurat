import React, { useMemo } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

// HSL hue per nav zone (golden angle spacing for good contrast)
function zoneColor(zone: number): string {
  if (zone <= 0) return '#ff1744';
  const hue = (zone * 137.508) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

function elevationColor(elev: number, minElev: number, maxElev: number): string {
  if (maxElev <= minElev) return '#ff1744';
  const t = (elev - minElev) / (maxElev - minElev);
  // blue (low) -> red (high)
  const r = Math.round(t * 255);
  const b = Math.round((1 - t) * 255);
  return `rgb(${r}, 40, ${b})`;
}

interface CellProps {
  x: number;
  z: number;
  cellSize: number;
  elevation: number;
  color: string;
  opacity: number;
}

function Cell({ x, z, cellSize, elevation, color, opacity }: CellProps) {
  return (
    <mesh position={[x * cellSize, elevation + 0.01, z * cellSize]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[cellSize, cellSize]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

export function CollisionOverlay() {
  const collisionGridData = useSceneStore((s) => s.collisionGridData);
  const showCollision = useSceneStore((s) => s.showCollision);

  const cells = useMemo(() => {
    if (!showCollision || !collisionGridData) return [];

    const g = collisionGridData;
    const result: { x: number; z: number; elevation: number; color: string; opacity: number; key: string }[] = [];

    // Determine if elevation varies
    let minElev = Infinity;
    let maxElev = -Infinity;
    for (let i = 0; i < g.solid.length; i++) {
      if (g.solid[i]) {
        minElev = Math.min(minElev, g.elevation[i]);
        maxElev = Math.max(maxElev, g.elevation[i]);
      }
    }
    const elevVaries = minElev < maxElev;

    // Check if any non-zero nav zones exist
    let hasZones = false;
    for (let i = 0; i < g.nav_zone.length; i++) {
      if (g.nav_zone[i] > 0) { hasZones = true; break; }
    }

    for (let z = 0; z < g.height; z++) {
      for (let x = 0; x < g.width; x++) {
        const idx = z * g.width + x;
        if (!g.solid[idx]) continue;

        let color: string;
        if (hasZones && g.nav_zone[idx] > 0) {
          color = zoneColor(g.nav_zone[idx]);
        } else if (elevVaries) {
          color = elevationColor(g.elevation[idx], minElev, maxElev);
        } else {
          color = '#ff1744';
        }

        result.push({
          x,
          z,
          elevation: g.elevation[idx],
          color,
          opacity: 0.35,
          key: `${x},${z}`,
        });
      }
    }

    return result;
  }, [collisionGridData, showCollision]);

  if (!showCollision || !collisionGridData) return null;

  return (
    <group>
      {cells.map((c) => (
        <Cell
          key={c.key}
          x={c.x}
          z={c.z}
          cellSize={collisionGridData.cell_size}
          elevation={c.elevation}
          color={c.color}
          opacity={c.opacity}
        />
      ))}
    </group>
  );
}
