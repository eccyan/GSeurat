import React, { useMemo } from 'react';
import { useCharacterStore } from '../../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
};

export function YClipControl() {
  const yClip = useCharacterStore((s) => s.yClip);
  const setYClip = useCharacterStore((s) => s.setYClip);
  const voxels = useCharacterStore((s) => s.asset?.voxels ?? new Map());

  const maxY = useMemo(() => {
    let max = 0;
    for (const [key] of voxels) {
      const parts = key.split(',');
      const y = Number(parts[1]);
      if (y > max) max = y;
    }
    return max;
  }, [voxels]);

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
