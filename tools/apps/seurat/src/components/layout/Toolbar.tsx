import React from 'react';
import type { Section } from '../../store/types.js';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { getClipDuration } from '../../lib/frame-utils.js';

const SECTION_TITLES: Record<Section, string> = {
  dashboard: 'Dashboard',
  concept: 'Concept Art',
  generate: 'AI Generation',
  review: 'Frame Review',
  animate: 'Animation Preview',
  atlas: 'Atlas Assembly',
  manifest: 'Manifest Editor',
};

export function Toolbar() {
  const activeSection = useSeuratStore((s) => s.activeSection);
  const selectedCharacterId = useSeuratStore((s) => s.selectedCharacterId);

  return (
    <div style={styles.toolbar}>
      <span style={styles.appTitle}>SEURAT</span>
      <span style={styles.divider} />
      <span style={styles.sectionTitle}>{SECTION_TITLES[activeSection]}</span>
      {selectedCharacterId && (
        <>
          <span style={styles.divider} />
          <span style={styles.charLabel}>{selectedCharacterId}</span>
        </>
      )}
      <div style={{ flex: 1 }} />
      {activeSection === 'animate' && <PlaybackControls />}
    </div>
  );
}

function PlaybackControls() {
  const playbackState = useSeuratStore((s) => s.playbackState);
  const currentTime = useSeuratStore((s) => s.currentTime);
  const manifest = useSeuratStore((s) => s.manifest);
  const selectedClipName = useSeuratStore((s) => s.selectedClipName);
  const { setPlaybackState, setCurrentTime } = useSeuratStore();

  const clip = manifest?.animations.find((a) => a.name === selectedClipName);
  const duration = clip ? getClipDuration(clip) : 0;

  const handlePlay = () => {
    if (playbackState === 'playing') {
      setPlaybackState('paused');
    } else {
      if (currentTime >= duration && !clip?.loop) setCurrentTime(0);
      setPlaybackState('playing');
    }
  };

  const handleStop = () => {
    setPlaybackState('stopped');
    setCurrentTime(0);
  };

  return (
    <>
      <button onClick={handleStop} style={styles.tbBtn} title="Stop">
        &#9632;
      </button>
      <button
        onClick={handlePlay}
        style={{
          ...styles.tbBtn,
          background: playbackState === 'playing' ? '#2a3a5a' : '#1e1e30',
          color: playbackState === 'playing' ? '#90b8f8' : '#aaa',
        }}
        title={playbackState === 'playing' ? 'Pause' : 'Play'}
      >
        {playbackState === 'playing' ? '\u23F8' : '\u25B6'}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.001}
        value={Math.min(currentTime, duration || 1)}
        onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
        style={{ width: 160, accentColor: '#f0c040', height: 4 }}
      />
      <span style={styles.timeLabel}>
        {currentTime.toFixed(3)}s / {duration.toFixed(3)}s
      </span>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    height: 36,
    background: '#1a1a2a',
    borderBottom: '1px solid #2a2a3a',
    flexShrink: 0,
  },
  appTitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#4a6a9a',
    fontWeight: 700,
    letterSpacing: '0.08em',
  },
  divider: {
    width: 1,
    height: 20,
    background: '#333',
    flexShrink: 0,
  },
  sectionTitle: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#aaa',
    fontWeight: 600,
  },
  charLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    background: '#1e1e30',
    padding: '2px 8px',
    borderRadius: 3,
    border: '1px solid #333',
  },
  tbBtn: {
    background: '#1e1e30',
    border: '1px solid #333',
    borderRadius: 3,
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  timeLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#888',
    minWidth: 100,
  },
};
