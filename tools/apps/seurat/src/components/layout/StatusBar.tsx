import React, { useState } from 'react';
import { useSeuratStore, getManifestStats } from '../../store/useSeuratStore.js';

export function StatusBar() {
  const selectedCharacterId = useSeuratStore((s) => s.selectedCharacterId);
  const manifest = useSeuratStore((s) => s.manifest);
  const stats = manifest ? getManifestStats(manifest) : null;
  const generationJobs = useSeuratStore((s) => s.generationJobs);
  const clearCompletedJobs = useSeuratStore((s) => s.clearCompletedJobs);

  const [showJobs, setShowJobs] = useState(false);

  const runningCount = generationJobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const totalCount = generationJobs.length;

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
              <span style={{ ...styles.item, color: '#aa8800' }}>
                {stats.generated} generated
              </span>
              <span style={styles.sep}>|</span>
              <span style={{ ...styles.item, color: '#666' }}>
                {stats.pending} pending
              </span>
            </>
          )}
        </>
      ) : (
        <span style={styles.item}>No character selected</span>
      )}
      <div style={{ flex: 1 }} />

      {/* Generation Jobs indicator */}
      {totalCount > 0 && (
        <span
          style={{
            ...styles.jobIndicator,
            color: runningCount > 0 ? '#8a4af8' : '#70d870',
            borderColor: runningCount > 0 ? '#6a3ac8' : '#44aa44',
            cursor: 'pointer',
          }}
          onClick={() => setShowJobs(!showJobs)}
        >
          {runningCount > 0 ? `Jobs: ${runningCount} running` : `Jobs: ${totalCount}`}
        </span>
      )}
      <span style={styles.sep}>|</span>
      <span style={styles.item}>Seurat v0.1.0</span>

      {/* Jobs panel popup */}
      {showJobs && totalCount > 0 && (
        <>
          <div style={styles.overlay} onClick={() => setShowJobs(false)} />
          <div style={styles.jobPanel}>
            <div style={styles.jobPanelHeader}>
              <span style={styles.jobPanelTitle}>Generation Jobs</span>
              <button onClick={clearCompletedJobs} style={styles.clearBtn}>Clear done</button>
              <button onClick={() => setShowJobs(false)} style={styles.closeBtn}>Close</button>
            </div>
            <div style={styles.jobList}>
              {generationJobs.slice().reverse().map((job) => (
                <div key={job.id} style={styles.jobRow}>
                  <span style={{
                    ...styles.jobStatus,
                    color: job.status === 'error' ? '#d88'
                      : job.status === 'done' ? '#8d8'
                      : job.status === 'running' ? '#8a4af8'
                      : '#aa8',
                  }}>
                    [{job.status}]
                  </span>
                  <span style={styles.jobSource}>{job.source}</span>
                  <span style={styles.jobLabel}>{job.label}</span>
                  {job.seed != null && <span style={styles.jobMeta}>seed:{job.seed}</span>}
                  {job.error && <span style={styles.jobError}>{job.error}</span>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
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
    position: 'relative',
  },
  item: { flexShrink: 0 },
  sep: { color: '#333', flexShrink: 0 },
  jobIndicator: {
    padding: '1px 8px',
    border: '1px solid',
    borderRadius: 3,
    fontWeight: 600,
    fontSize: 9,
    flexShrink: 0,
  },
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 998,
  },
  jobPanel: {
    position: 'absolute' as const,
    bottom: '100%',
    right: 8,
    width: 420,
    maxHeight: 320,
    background: '#111120',
    border: '1px solid #3a3a5a',
    borderRadius: 6,
    zIndex: 999,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxShadow: '0 -4px 16px rgba(0,0,0,0.5)',
  },
  jobPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderBottom: '1px solid #2a2a3a',
    background: '#161628',
  },
  jobPanelTitle: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 600,
    color: '#aaa',
    flex: 1,
  },
  clearBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  closeBtn: {
    background: '#2a1a1a',
    border: '1px solid #553333',
    borderRadius: 3,
    color: '#d88',
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  jobList: {
    overflowY: 'auto' as const,
    padding: 6,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  jobRow: {
    display: 'flex',
    gap: 6,
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#aaa',
    padding: '3px 4px',
    borderRadius: 3,
    background: '#0e0e1a',
    flexWrap: 'wrap' as const,
  },
  jobStatus: {
    fontWeight: 600,
    flexShrink: 0,
  },
  jobSource: {
    color: '#666',
    flexShrink: 0,
  },
  jobLabel: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  jobMeta: {
    color: '#555',
    fontSize: 8,
    flexShrink: 0,
  },
  jobError: {
    color: '#d88',
    fontSize: 8,
    width: '100%',
  },
};
