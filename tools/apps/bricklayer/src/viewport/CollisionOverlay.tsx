import React, { useCallback, useMemo, useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

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
  const collisionBoxFill = useSceneStore((s) => s.collisionBoxFill);
  const collisionBoxStart = useSceneStore((s) => s.collisionBoxStart);
  const [hoverCell, setHoverCell] = useState<[number, number] | null>(null);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const store = useSceneStore.getState();
    const grid = store.collisionGridData;
    if (!grid || !store.collisionBoxFill || !store.collisionBoxStart) return;
    const point = e.point;
    const cellX = Math.round(point.x / grid.cell_size);
    const cellZ = Math.round(point.z / grid.cell_size);
    if (cellX < 0 || cellX >= grid.width || cellZ < 0 || cellZ >= grid.height) return;
    setHoverCell([cellX, cellZ]);
  }, []);

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

    // Box fill mode
    if (store.collisionBoxFill) {
      if (store.collisionBoxStart) {
        const [sx, sz] = store.collisionBoxStart;
        store.pushUndo();
        const minX = Math.min(sx, cellX);
        const maxX = Math.max(sx, cellX);
        const minZ = Math.min(sz, cellZ);
        const maxZ = Math.max(sz, cellZ);
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            switch (store.collisionLayer) {
              case 'solid':
                store.setCellSolid(x, z, true);
                break;
              case 'elevation':
                store.setCellElevation(x, z, store.collisionHeight);
                break;
              case 'nav_zone':
                store.setCellNavZone(x, z, store.activeNavZone);
                break;
            }
          }
        }
        store.setCollisionBoxStart(null);
        setHoverCell(null);
      } else {
        store.setCollisionBoxStart([cellX, cellZ]);
      }
      return;
    }

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

  // Box fill preview rectangle
  const boxPreview = useMemo(() => {
    if (!collisionBoxFill || !collisionBoxStart || !hoverCell || !collisionGridData) return null;
    const [sx, sz] = collisionBoxStart;
    const [hx, hz] = hoverCell;
    const cs = collisionGridData.cell_size;
    const minX = Math.min(sx, hx);
    const maxX = Math.max(sx, hx);
    const minZ = Math.min(sz, hz);
    const maxZ = Math.max(sz, hz);
    const w = (maxX - minX + 1) * cs;
    const d = (maxZ - minZ + 1) * cs;
    const cx = (minX + maxX) / 2 * cs;
    const cz = (minZ + maxZ) / 2 * cs;
    return { cx, cz, w, d };
  }, [collisionBoxFill, collisionBoxStart, hoverCell, collisionGridData]);

  // Start marker
  const startMarker = useMemo(() => {
    if (!collisionBoxFill || !collisionBoxStart || !collisionGridData) return null;
    const [sx, sz] = collisionBoxStart;
    const cs = collisionGridData.cell_size;
    return { x: sx * cs, z: sz * cs };
  }, [collisionBoxFill, collisionBoxStart, collisionGridData]);

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

      {/* Box fill start marker */}
      {startMarker && (
        <mesh position={[startMarker.x, 0.05, startMarker.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[collisionGridData.cell_size, collisionGridData.cell_size]} />
          <meshBasicMaterial color="#ffcc00" transparent opacity={0.6} depthWrite={false} />
        </mesh>
      )}

      {/* Box fill preview rectangle */}
      {boxPreview && (
        <mesh position={[boxPreview.cx, 0.03, boxPreview.cz]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[boxPreview.w, boxPreview.d]} />
          <meshBasicMaterial color="#ffcc00" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
