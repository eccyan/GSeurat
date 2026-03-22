import React from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 280,
    background: '#1e1e3a',
    borderLeft: '1px solid #333',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  select: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
};

function YClipControl() {
  const yClip = useCharacterStore((s) => s.yClip);
  const setYClip = useCharacterStore((s) => s.setYClip);
  const voxels = useCharacterStore((s) => s.voxels);

  let maxY = 0;
  for (const [key] of voxels) {
    const parts = key.split(',');
    const y = Number(parts[1]);
    if (y > maxY) maxY = y;
  }

  const enabled = yClip !== null;

  return (
    <div style={styles.section}>
      <span style={styles.label}>Y-Clip</span>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setYClip(e.target.checked ? Math.floor(maxY / 2) : null)}
        />
        Enable
      </label>
      {enabled && (
        <div style={styles.row}>
          <input
            type="range"
            min={0}
            max={maxY}
            value={yClip}
            onChange={(e) => setYClip(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 13, color: '#ddd', minWidth: 24 }}>Y:{yClip}</span>
        </div>
      )}
    </div>
  );
}

function MirrorControl() {
  const mirrorAxis = useCharacterStore((s) => s.mirrorAxis);
  const setMirrorAxis = useCharacterStore((s) => s.setMirrorAxis);

  return (
    <div style={styles.section}>
      <span style={styles.label}>Mirror</span>
      <div style={styles.row}>
        <select
          style={styles.select}
          value={mirrorAxis ?? 'none'}
          onChange={(e) => {
            const v = e.target.value;
            setMirrorAxis(v === 'none' ? null : (v as 'x' | 'z'));
          }}
        >
          <option value="none">Off</option>
          <option value="x">Mirror X</option>
          <option value="z">Mirror Z</option>
        </select>
      </div>
    </div>
  );
}

function GridSettings() {
  const showGrid = useCharacterStore((s) => s.showGrid);
  const showGizmos = useCharacterStore((s) => s.showGizmos);
  const setShowGrid = useCharacterStore((s) => s.setShowGrid);
  const setShowGizmos = useCharacterStore((s) => s.setShowGizmos);
  const colorByPart = useCharacterStore((s) => s.colorByPart);
  const setColorByPart = useCharacterStore((s) => s.setColorByPart);

  return (
    <div style={styles.section}>
      <span style={styles.label}>Display</span>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
        Grid
      </label>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={showGizmos} onChange={(e) => setShowGizmos(e.target.checked)} />
        Gizmos
      </label>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={colorByPart} onChange={(e) => setColorByPart(e.target.checked)} />
        Color by Part
      </label>
    </div>
  );
}

export function BuildPanel() {
  return (
    <div style={styles.container}>
      <YClipControl />
      <MirrorControl />
      <GridSettings />
    </div>
  );
}
