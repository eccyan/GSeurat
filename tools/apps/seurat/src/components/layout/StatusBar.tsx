import React from 'react';
import { useSeuratStore, getManifestStats } from '../../store/useSeuratStore.js';

export function StatusBar() {
  const selectedCharacterId = useSeuratStore((s) => s.selectedCharacterId);
  const manifest = useSeuratStore((s) => s.manifest);
  const activeSection = useSeuratStore((s) => s.activeSection);

  const stats = manifest ? getManifestStats(manifest) : null;

  return (
    <div style={styles.bar}>
      {selectedCharacterId ? (
        <>
          <span style={styles.item}>
            Character: <strong>{manifest?.display_name ?? selectedCharacterId}</strong>
          </span>
          <span style={styles.sep}>|</span>
          {stats && (
            <>
              <span style={styles.item}>
                Frames: {stats.total}
              </span>
              <span style={styles.sep}>|</span>
              <span style={{ ...styles.item, color: '#44aa44' }}>
                {stats.approved} approved
              </span>
              <span style={styles.sep}>|</span>
              <span style={{ ...styles.item, color: '#aa8800' }}>
                {stats.pending + stats.generated} pending
              </span>
              {stats.rejected > 0 && (
                <>
                  <span style={styles.sep}>|</span>
                  <span style={{ ...styles.item, color: '#aa4444' }}>
                    {stats.rejected} rejected
                  </span>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <span style={styles.item}>No character selected</span>
      )}
      <div style={{ flex: 1 }} />
      <span style={styles.item}>Seurat v0.1.0</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 12px',
    background: '#16162a',
    borderTop: '1px solid #2a2a3a',
    flexShrink: 0,
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#777',
  },
  item: { flexShrink: 0 },
  sep: { color: '#333', flexShrink: 0 },
};
