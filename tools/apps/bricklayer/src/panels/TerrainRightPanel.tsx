import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  info: { fontSize: 12, color: '#aaa' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
};

export function TerrainRightPanel() {
  const voxels = useSceneStore((s) => s.voxels);
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const showCollision = useSceneStore((s) => s.showCollision);
  const collisionGridData = useSceneStore((s) => s.collisionGridData);
  const collisionLayer = useSceneStore((s) => s.collisionLayer);

  return (
    <div>
      <div style={styles.section}>
        <span style={styles.label}>Terrain Info</span>
        <span style={styles.info}>
          Grid: {gridWidth} x {gridDepth}
        </span>
        <span style={styles.info}>
          Voxels: {voxels.size.toLocaleString()}
        </span>
      </div>

      {showCollision && collisionGridData && (
        <div style={styles.section}>
          <span style={styles.label}>Collision Grid</span>
          <span style={styles.info}>
            {collisionGridData.width} x {collisionGridData.height} (cell {collisionGridData.cell_size})
          </span>
          <span style={styles.info}>
            {collisionGridData.solid.filter(Boolean).length} solid / {collisionGridData.solid.length - collisionGridData.solid.filter(Boolean).length} walkable
          </span>
          <span style={styles.info}>
            Active layer: {collisionLayer}
          </span>
        </div>
      )}
    </div>
  );
}
