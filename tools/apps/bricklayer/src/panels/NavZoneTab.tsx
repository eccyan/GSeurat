import React, { useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: { flex: 1, padding: '3px 5px', fontSize: 12 },
  btn: {
    padding: '4px 10px', background: '#3a3a6a', border: '1px solid #555',
    borderRadius: 4, color: '#ddd', fontSize: 12, cursor: 'pointer',
  },
  info: { fontSize: 11, color: '#aaa', lineHeight: 1.5 },
};

export function NavZoneTab() {
  const navZoneNames = useSceneStore((s) => s.navZoneNames);
  const addNavZoneName = useSceneStore((s) => s.addNavZoneName);
  const removeNavZoneName = useSceneStore((s) => s.removeNavZoneName);
  const collisionGridData = useSceneStore((s) => s.collisionGridData);

  const [newName, setNewName] = useState('');

  if (!collisionGridData) {
    return (
      <div style={styles.section}>
        <span style={styles.info}>
          Initialize a collision grid in the GS tab first to manage navigation zones.
        </span>
      </div>
    );
  }

  // Count cells per zone
  const zoneCounts: Record<number, number> = {};
  for (const z of collisionGridData.nav_zone) {
    zoneCounts[z] = (zoneCounts[z] ?? 0) + 1;
  }

  return (
    <div>
      <div style={styles.section}>
        <span style={styles.label}>Zone Names</span>
        <div style={styles.row}>
          <span style={{ fontSize: 12, color: '#aaa' }}>#0: default ({zoneCounts[0] ?? 0} cells)</span>
        </div>
        {navZoneNames.map((name, i) => (
          <div key={i} style={styles.row}>
            <span style={{ fontSize: 12, flex: 1 }}>
              #{i + 1}: {name} ({zoneCounts[i + 1] ?? 0} cells)
            </span>
            <button style={{ ...styles.btn, padding: '2px 6px' }}
              onClick={() => removeNavZoneName(i)}>x</button>
          </div>
        ))}
        <div style={styles.row}>
          <input type="text" value={newName} placeholder="new zone name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                addNavZoneName(newName.trim());
                setNewName('');
              }
            }}
            style={styles.input} />
          <button style={styles.btn}
            onClick={() => { if (newName.trim()) { addNavZoneName(newName.trim()); setNewName(''); } }}>
            Add
          </button>
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Instructions</span>
        <span style={styles.info}>
          Click cells in the viewport while the Collision overlay is visible to paint zones.
          Use the GS tab to set the active zone before painting.
        </span>
      </div>
    </div>
  );
}
