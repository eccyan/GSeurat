import React, { useCallback, useMemo } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { ThreeEvent } from '@react-three/fiber';

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

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const store = useSceneStore.getState();
    // Only handle clicks in TERRAIN mode
    if (store.mode !== 'terrain') return;
    const grid = store.collisionGridData;
    if (!grid) return;

    // Raycast hit point on the click plane
    const point = e.point;
    const cellX = Math.round(point.x / grid.cell_size);
    const cellZ = Math.round(point.z / grid.cell_size);

    if (cellX < 0 || cellX >= grid.width || cellZ < 0 || cellZ >= grid.height) return;

    store.pushUndo();

    switch (store.collisionLayer) {
      case 'solid':
        store.toggleCellSolid(cellX, cellZ);
        break;
      case 'elevation':
        store.setCellElevation(cellX, cellZ, store.collisionHeight);
        break;
      case 'nav_zone':
        store.setCellNavZone(cellX, cellZ, store.activeNavZone);
        break;
    }
  }, []);

  const cells = useMemo(() => {
    if (!showCollision || !collisionGridData) return [];

    const g = collisionGridData;
    const result: { x: number; z: number; elevation: number; color: string; opacity: number; key: string }[] = [];

    // Determine if elevation varies
    let minElev = Infinity;
    let maxElev = -Infinity;
    for (let i = 0; i < g.elevation.length; i++) {
      if (g.elevation[i] !== 0) {
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
        const isSolid = g.solid[idx];

        let color: string;
        let opacity: number;

        if (isSolid) {
          // Solid cells: red, or colored by zone/elevation
          if (hasZones && g.nav_zone[idx] > 0) {
            color = zoneColor(g.nav_zone[idx]);
          } else if (elevVaries) {
            color = elevationColor(g.elevation[idx], minElev, maxElev);
          } else {
            color = '#ff1744';
          }
          opacity = 0.4;
        } else if (hasZones && g.nav_zone[idx] > 0) {
          // Walkable with zone
          color = zoneColor(g.nav_zone[idx]);
          opacity = 0.2;
        } else if (g.elevation[idx] !== 0) {
          // Walkable with elevation
          color = elevationColor(g.elevation[idx], minElev || -10, maxElev || 10);
          opacity = 0.15;
        } else {
          // Walkable default — subtle green grid
          color = '#44aa44';
          opacity = 0.08;
        }

        result.push({
          x,
          z,
          elevation: g.elevation[idx],
          color,
          opacity,
          key: `${x},${z}`,
        });
      }
    }

    return result;
  }, [collisionGridData, showCollision]);

  if (!showCollision || !collisionGridData) return null;

  return (
    <group>
      {/* Invisible click plane covering the full grid */}
      <mesh
        position={[
          (collisionGridData.width * collisionGridData.cell_size) / 2 - collisionGridData.cell_size / 2,
          0,
          (collisionGridData.height * collisionGridData.cell_size) / 2 - collisionGridData.cell_size / 2,
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={handleClick}
      >
        <planeGeometry args={[
          collisionGridData.width * collisionGridData.cell_size,
          collisionGridData.height * collisionGridData.cell_size,
        ]} />
        <meshBasicMaterial visible={false} />
      </mesh>

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
