import React from 'react';
import { useCharacterStore } from '../../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
};

export function DisplaySettings() {
  const showGrid = useCharacterStore((s) => s.showGrid);
  const showGizmos = useCharacterStore((s) => s.showGizmos);
  const setShowGrid = useCharacterStore((s) => s.setShowGrid);
  const setShowGizmos = useCharacterStore((s) => s.setShowGizmos);
  const colorByPart = useCharacterStore((s) => s.colorByPart);
  const setColorByPart = useCharacterStore((s) => s.setColorByPart);
  const xrayMode = useCharacterStore((s) => s.xrayMode);
  const setXrayMode = useCharacterStore((s) => s.setXrayMode);

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
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={xrayMode} onChange={(e) => setXrayMode(e.target.checked)} />
        X-Ray Mode (T)
      </label>
    </div>
  );
}
