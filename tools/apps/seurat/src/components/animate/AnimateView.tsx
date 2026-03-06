import React from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { AnimationPreviewCanvas } from './AnimationPreviewCanvas.js';
import { ClipTimeline } from './ClipTimeline.js';

export function AnimateView() {
  const manifest = useSeuratStore((s) => s.manifest);
  const selectedClipName = useSeuratStore((s) => s.selectedClipName);
  const selectClip = useSeuratStore((s) => s.selectClip);
  const spriteSheetUrl = useSeuratStore((s) => s.spriteSheetUrl);
  const loadSpriteSheet = useSeuratStore((s) => s.loadSpriteSheet);
  const playbackState = useSeuratStore((s) => s.playbackState);
  const currentTime = useSeuratStore((s) => s.currentTime);

  if (!manifest) {
    return (
      <div style={{ padding: 24, color: '#555', fontFamily: 'monospace', fontSize: 12 }}>
        Select a character from the Dashboard.
      </div>
    );
  }

  const clip = manifest.animations.find((a) => a.name === selectedClipName) ?? null;

  return (
    <div style={styles.container}>
      {/* Left: clip list */}
      <div style={styles.clipList}>
        <div style={styles.clipListHeader}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#666' }}>CLIPS</span>
          {!spriteSheetUrl && (
            <button onClick={loadSpriteSheet} style={styles.loadBtn} title="Load sprite sheet">
              Load Sheet
            </button>
          )}
        </div>
        {manifest.animations.map((anim) => (
          <button
            key={anim.name}
            onClick={() => selectClip(anim.name)}
            style={{
              ...styles.clipBtn,
              background: anim.name === selectedClipName ? '#1e2a42' : 'transparent',
              borderColor: anim.name === selectedClipName ? '#4a8af8' : 'transparent',
              color: anim.name === selectedClipName ? '#90b8f8' : '#888',
            }}
          >
            <span style={{ fontSize: 10 }}>{anim.name}</span>
            <span style={{ fontSize: 8, color: '#555' }}>
              {anim.frames.length}f | {anim.loop ? 'loop' : 'once'}
            </span>
          </button>
        ))}
      </div>

      {/* Center: preview + timeline */}
      <div style={styles.center}>
        <div style={styles.preview}>
          <AnimationPreviewCanvas
            spriteSheetUrl={spriteSheetUrl}
            spritesheet={manifest.spritesheet}
            clip={clip}
            currentTime={currentTime}
            playbackState={playbackState}
            selectedFrameIndex={0}
          />
        </div>
        <div style={styles.timelineArea}>
          {clip ? (
            <ClipTimeline clip={clip} />
          ) : (
            <div style={{ padding: 12, fontFamily: 'monospace', fontSize: 11, color: '#555' }}>
              Select a clip to edit its timeline
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100%',
    overflow: 'hidden',
  },
  clipList: {
    width: 160,
    flexShrink: 0,
    borderRight: '1px solid #2a2a3a',
    overflowY: 'auto',
    background: '#111120',
    display: 'flex',
    flexDirection: 'column',
  },
  clipListHeader: {
    padding: '8px 8px 4px',
    borderBottom: '1px solid #2a2a3a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  loadBtn: {
    background: '#222236',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '2px 6px',
    cursor: 'pointer',
  },
  clipBtn: {
    display: 'flex',
    flexDirection: 'column',
    padding: '6px 8px',
    border: '1px solid',
    borderRadius: 0,
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'monospace',
    textAlign: 'left',
    gap: 1,
  },
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  preview: {
    flex: '1 1 60%',
    borderBottom: '1px solid #2a2a3a',
    overflow: 'hidden',
    display: 'flex',
  },
  timelineArea: {
    flex: '0 0 120px',
    overflow: 'hidden',
  },
};
