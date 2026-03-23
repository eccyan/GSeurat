import React, { useState } from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CollisionLayer } from '../store/types.js';

const collisionLayers: { id: CollisionLayer; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'nav_zone', label: 'NavZone' },
];

const styles: Record<string, React.CSSProperties> = {
  container: { flex: 1, overflowY: 'auto', padding: 12 },
  section: { marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8, display: 'block' },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  btn: {
    padding: '6px 12px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 12, width: '100%',
  },
  btnActive: { background: '#4a4a8a', borderColor: '#77f', color: '#fff' },
  btnSmall: {
    padding: '4px 10px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 11,
  },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  info: { fontSize: 11, color: '#888', marginBottom: 4 },
  divider: { borderTop: '1px solid #333', margin: '12px 0' },
};

export function CollisionLeftPanel() {
  const collisionGridData = useSceneStore((s) => s.collisionGridData);
  const collisionLayer = useSceneStore((s) => s.collisionLayer);
  const collisionHeight = useSceneStore((s) => s.collisionHeight);
  const activeNavZone = useSceneStore((s) => s.activeNavZone);
  const navZoneNames = useSceneStore((s) => s.navZoneNames);
  const collisionBoxFill = useSceneStore((s) => s.collisionBoxFill);
  const showCollision = useSceneStore((s) => s.showCollision);
  const initCollisionGrid = useSceneStore((s) => s.initCollisionGrid);
  const setCollisionLayer = useSceneStore((s) => s.setCollisionLayer);
  const setCollisionHeight = useSceneStore((s) => s.setCollisionHeight);
  const setActiveNavZone = useSceneStore((s) => s.setActiveNavZone);
  const setCollisionBoxFill = useSceneStore((s) => s.setCollisionBoxFill);
  const addNavZoneName = useSceneStore((s) => s.addNavZoneName);
  const autoGenerateCollision = useSceneStore((s) => s.autoGenerateCollision);

  const [gridW, setGridW] = useState(32);
  const [gridH, setGridH] = useState(32);
  const [cellSize, setCellSize] = useState(1);
  const [slopeThreshold, setSlopeThreshold] = useState(5.0);
  const [newZoneName, setNewZoneName] = useState('');

  // Auto-show overlay
  if (!showCollision) {
    useSceneStore.getState().setShowCollision(true);
  }

  if (!collisionGridData) {
    return (
      <div style={styles.container}>
        <span style={styles.label}>Create Collision Grid</span>
        <div style={styles.row}>
          <NumberInput label="W" value={gridW} min={1} onChange={setGridW} style={{ maxWidth: 60 }} />
          <NumberInput label="H" value={gridH} min={1} onChange={setGridH} style={{ maxWidth: 60 }} />
        </div>
        <div style={styles.row}>
          <NumberInput label="Cell" value={cellSize} step={0.5} min={0.1} onChange={setCellSize} style={{ maxWidth: 60 }} />
        </div>
        <button style={styles.btn} onClick={() => initCollisionGrid(gridW, gridH, cellSize)}>
          Init Grid
        </button>

        <div style={styles.divider} />

        <span style={styles.label}>Auto-generate</span>
        <p style={styles.info}>Generate collision grid from voxel terrain data</p>
        <div style={styles.row}>
          <NumberInput label="Slope" value={slopeThreshold} step={0.5} min={0.5} max={20} onChange={setSlopeThreshold} style={{ maxWidth: 60 }} />
        </div>
        <button style={styles.btn} onClick={() => autoGenerateCollision(slopeThreshold)}>
          Auto-generate from Terrain
        </button>
      </div>
    );
  }

  const totalCells = collisionGridData.width * collisionGridData.height;
  const solidCount = collisionGridData.solid.filter(Boolean).length;

  return (
    <div style={styles.container}>
      {/* Grid info */}
      <div style={styles.section}>
        <span style={styles.label}>Collision Grid</span>
        <div style={styles.info}>{collisionGridData.width}×{collisionGridData.height} (cell {collisionGridData.cell_size})</div>
        <div style={styles.info}>{solidCount} solid / {totalCells - solidCount} walkable</div>
      </div>

      {/* Layer selector */}
      <div style={styles.section}>
        <span style={styles.label}>Edit Layer</span>
        <div style={styles.row}>
          {collisionLayers.map((cl) => (
            <button
              key={cl.id}
              style={{
                ...styles.btnSmall,
                flex: 1,
                ...(collisionLayer === cl.id ? styles.btnActive : {}),
              }}
              onClick={() => setCollisionLayer(cl.id)}
            >
              {cl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layer-specific tools */}
      <div style={styles.section}>
        <span style={styles.label}>Tools</span>

        {/* Box fill toggle */}
        <label style={{ ...styles.row, cursor: 'pointer', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={collisionBoxFill}
            onChange={(e) => setCollisionBoxFill(e.target.checked)}
          />
          Box Fill (click two corners)
        </label>

        {collisionLayer === 'elevation' && (
          <div style={styles.row}>
            <NumberInput label="Height" step={0.5} value={collisionHeight} onChange={setCollisionHeight} style={styles.input} />
          </div>
        )}

        {collisionLayer === 'nav_zone' && (
          <>
            <div style={styles.row}>
              <select
                style={styles.input}
                value={activeNavZone}
                onChange={(e) => setActiveNavZone(Number(e.target.value))}
              >
                <option value={0}>0: default</option>
                {navZoneNames.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}: {name}</option>
                ))}
              </select>
            </div>
            <div style={styles.row}>
              <input
                type="text"
                value={newZoneName}
                placeholder="zone name"
                onChange={(e) => setNewZoneName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newZoneName.trim()) {
                    addNavZoneName(newZoneName.trim());
                    setNewZoneName('');
                  }
                }}
                style={styles.input}
              />
              <button
                style={styles.btnSmall}
                onClick={() => {
                  if (newZoneName.trim()) {
                    addNavZoneName(newZoneName.trim());
                    setNewZoneName('');
                  }
                }}
              >
                +
              </button>
            </div>
          </>
        )}
      </div>

      <div style={styles.divider} />

      {/* Auto-generate */}
      <div style={styles.section}>
        <span style={styles.label}>Auto-generate</span>
        <div style={styles.row}>
          <NumberInput label="Slope" value={slopeThreshold} step={0.5} min={0.5} max={20} onChange={setSlopeThreshold} style={{ maxWidth: 60 }} />
        </div>
        <button style={styles.btn} onClick={() => autoGenerateCollision(slopeThreshold)}>
          Regenerate from Terrain
        </button>
      </div>

      <div style={styles.divider} />

      <p style={styles.info}>Click cells in viewport to edit. Use Box Fill for rectangles.</p>
    </div>
  );
}
