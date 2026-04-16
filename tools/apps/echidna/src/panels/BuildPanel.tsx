import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { YClipControl } from './controls/YClipControl.js';
import { YLevelLock } from './controls/YLevelLock.js';
import { DisplaySettings } from './controls/DisplaySettings.js';

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    background: '#1e1e3a',
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

export function BuildPanel() {
  useComponentRegistry('BuildPanel');
  return (
    <div style={styles.container}>
      <YClipControl />
      <YLevelLock />
      <MirrorControl />
      <DisplaySettings />
    </div>
  );
}
