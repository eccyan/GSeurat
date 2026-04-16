import React from 'react';
import { NumberInput } from '@gseurat/ui-kit';
import { useCharacterStore } from '../../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
};

export function YLevelLock() {
  const yLevelLock = useCharacterStore((s) => s.yLevelLock);
  const setYLevelLock = useCharacterStore((s) => s.setYLevelLock);

  return (
    <div style={styles.section}>
      <span style={styles.label}>Y-Level Lock</span>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={yLevelLock !== null}
          onChange={(e) => setYLevelLock(e.target.checked ? 0 : null)}
        />
        Enable
      </label>
      {yLevelLock !== null && (
        <NumberInput value={yLevelLock} onChange={setYLevelLock} min={0} step={1} label="Y" />
      )}
    </div>
  );
}
