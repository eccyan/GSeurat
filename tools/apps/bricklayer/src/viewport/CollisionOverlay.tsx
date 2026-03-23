import React, { useCallback, useMemo, useState } from 'react';
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

// Preview rectangle for box fill
function BoxPreview({ startX, startZ, endX, endZ, cellSize }: {
  startX: number; startZ: number; endX: number; endZ: number; cellSize: number;
}) {
  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const minZ = Math.min(startZ, endZ);
  const maxZ = Math.max(startZ, endZ);
  const width = (maxX - minX + 1) * cellSize;
  const depth = (maxZ - minZ + 1) * cellSize;

  return (
    <mesh
      position={[(minX + maxX) / 2 * cellSize, 0.02, (minZ + maxZ) / 2 * cellSize]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial color="#77f" transparent opacity={0.2} depthWrite={false} />
    </mesh>
  );
}

export function CollisionOverlay() {
  const collisionGridData = useSceneStore((s) => s.collisionGridData);
  const showCollision = useSceneStore((s) => s.showCollision);
  const collisionBoxFill = useSceneStore((s) => s.collisionBoxFill);
  const collisionBoxStart = useSceneStore((s) => s.collisionBoxStart);
  const [hoverCell, setHoverCell] = useState<[number, number] | null>(null);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const store = useSceneStore.getState();
    // Only handle clicks in collision editing mode
    if (store.activeNode?.kind !== 'collision') return;
    const grid = store.collisionGridData;
    if (!grid) return;

    // Raycast hit point on the click plane
    const point = e.point;
    const cellX = Math.round(point.x / grid.cell_size);
    const cellZ = Math.round(point.z / grid.cell_size);

    if (cellX < 0 || cellX >= grid.width || cellZ < 0 || cellZ >= grid.height) return;

    // Box fill mode
    if (store.collisionBoxFill) {
      if (!store.collisionBoxStart) {
        store.setCollisionBoxStart([cellX, cellZ]);
        return;
      }
      // Second click: fill rectangle
      const [sx, sz] = store.collisionBoxStart;
      const minX = Math.min(sx, cellX);
      const maxX = Math.max(sx, cellX);
      const minZ = Math.min(sz, cellZ);
      const maxZ = Math.max(sz, cellZ);

      store.pushUndo();
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          switch (store.collisionLayer) {
            case 'solid': store.setCellSolid(x, z, true); break;
            case 'elevation': store.setCellElevation(x, z, store.collisionHeight); break;
            case 'nav_zone': store.setCellNavZone(x, z, store.activeNavZone); break;
          }
        }
      }
      store.setCollisionBoxStart(null);
      return;
    }

    store.pushUndo();

    // Flood fill mode (solid layer only — elevation/nav_zone don't have contiguous regions)
    if (store.collisionFloodFillMode && store.collisionLayer === 'solid') {
      const currentState = grid.solid[cellZ * grid.width + cellX];
      store.collisionFloodFill(cellX, cellZ, !currentState);
      return;
    }

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

  const handlePointerMove = useCallback((e: ThreeEvent<MouseEvent>) => {
    const store = useSceneStore.getState();
    const grid = store.collisionGridData;
    if (!grid || !store.collisionBoxFill || !store.collisionBoxStart) return;
    const point = e.point;
    const cellX = Math.round(point.x / grid.cell_size);
    const cellZ = Math.round(point.z / grid.cell_size);
    if (cellX >= 0 && cellX < grid.width && cellZ >= 0 && cellZ < grid.height) {
      setHoverCell([cellX, cellZ]);
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
        onPointerMove={handlePointerMove}
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

      {/* Box fill preview */}
      {collisionBoxFill && collisionBoxStart && hoverCell && (
        <BoxPreview
          startX={collisionBoxStart[0]}
          startZ={collisionBoxStart[1]}
          endX={hoverCell[0]}
          endZ={hoverCell[1]}
          cellSize={collisionGridData.cell_size}
        />
      )}
    </group>
  );
}
