import React from 'react';
import type { CharacterAnimation } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { getClipDuration } from '../../lib/frame-utils.js';

interface Props {
  clip: CharacterAnimation;
}

export function ClipTimeline({ clip }: Props) {
  const updateFrameDuration = useSeuratStore((s) => s.updateFrameDuration);
  const currentTime = useSeuratStore((s) => s.currentTime);
  const playbackState = useSeuratStore((s) => s.playbackState);
  const { setPlaybackState, setCurrentTime } = useSeuratStore();

  const totalDuration = clip.frames.reduce((s, f) => s + f.duration, 0);
  const duration = getClipDuration(clip);
  const pxPerSecond = 400;

  const handlePlay = () => {
    if (playbackState === 'playing') {
      setPlaybackState('paused');
    } else {
      if (currentTime >= duration && !clip.loop) setCurrentTime(0);
      setPlaybackState('playing');
    }
  };

  const handleStop = () => {
    setPlaybackState('stopped');
    setCurrentTime(0);
  };

  let accum = 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.clipName}>{clip.name}</span>
        <span style={styles.info}>
          {clip.frames.length} frames | {totalDuration.toFixed(3)}s | {clip.loop ? 'loop' : 'once'}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleStop} style={styles.tbBtn} title="Stop">&#9632;</button>
        <button
          onClick={handlePlay}
          style={{ ...styles.tbBtn, background: playbackState === 'playing' ? '#2a3a5a' : '#1e1e30', color: playbackState === 'playing' ? '#90b8f8' : '#aaa' }}
          title={playbackState === 'playing' ? 'Pause' : 'Play'}
        >
          {playbackState === 'playing' ? '\u23F8' : '\u25B6'}
        </button>
        <input
          type="range" min={0} max={duration || 1} step={0.001}
          value={Math.min(currentTime, duration || 1)}
          onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
          style={{ width: 120, accentColor: '#f0c040', height: 4 }}
        />
        <span style={styles.timeLabel}>{currentTime.toFixed(3)}s / {duration.toFixed(3)}s</span>
      </div>

      <div style={styles.timeline}>
        {/* Playhead */}
        <div
          style={{
            ...styles.playhead,
            left: currentTime * pxPerSecond,
          }}
        />

        {/* Frame blocks */}
        {clip.frames.map((frame, i) => {
          const x = accum * pxPerSecond;
          const w = frame.duration * pxPerSecond;
          accum += frame.duration;

          return (
            <div
              key={i}
              style={{
                ...styles.frameBlock,
                left: x,
                width: Math.max(w - 1, 2),
              }}
            >
              <span style={styles.frameLabel}>f{frame.index}</span>
              <input
                type="number"
                value={frame.duration}
                step={0.01}
                min={0.01}
                onChange={(e) => {
                  const d = parseFloat(e.target.value);
                  if (d > 0) updateFrameDuration(clip.name, frame.index, d);
                }}
                style={styles.durationInput}
                title={`Duration: ${frame.duration}s`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#111120',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 12px',
    background: '#1a1a2a',
    borderBottom: '1px solid #2a2a3a',
    flexShrink: 0,
  },
  clipName: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#ccc',
    fontWeight: 600,
  },
  info: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#666',
  },
  timeline: {
    flex: 1,
    position: 'relative',
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: '12px 8px',
    minHeight: 60,
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    background: '#f0c040',
    zIndex: 10,
    pointerEvents: 'none',
  },
  frameBlock: {
    position: 'absolute',
    top: 8,
    height: 44,
    background: '#1e2a42',
    border: '1px solid #3a5a8a',
    borderRadius: 3,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  frameLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#90b8f8',
    fontWeight: 600,
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
  },
  durationInput: {
    width: 44,
    background: '#111',
    border: '1px solid #333',
    borderRadius: 2,
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 9,
    textAlign: 'center',
    padding: '1px 2px',
    outline: 'none',
  },
};
