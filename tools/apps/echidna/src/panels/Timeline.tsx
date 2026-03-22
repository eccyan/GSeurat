import React, { useRef, useCallback } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';

const TIMELINE_HEIGHT = 80;
const TRACK_Y = 40;
const DOT_R = 5;

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: TIMELINE_HEIGHT,
    background: '#16162a',
    borderTop: '1px solid #333',
    display: 'flex',
    flexDirection: 'column',
    userSelect: 'none',
  },
  controls: {
    height: 28,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    borderBottom: '1px solid #2a2a4a',
  },
  btn: {
    padding: '2px 8px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 14,
  },
  timeDisplay: {
    fontSize: 11,
    color: '#888',
    minWidth: 60,
  },
  speedLabel: {
    fontSize: 11,
    color: '#666',
    marginLeft: 'auto',
  },
  track: {
    flex: 1,
    position: 'relative',
    cursor: 'pointer',
  },
};

export function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null);

  const selectedAnimation = useCharacterStore((s) => s.selectedAnimation);
  const animations = useCharacterStore((s) => s.animations);
  const playbackTime = useCharacterStore((s) => s.playbackTime);
  const isPlaying = useCharacterStore((s) => s.isPlaying);
  const playbackSpeed = useCharacterStore((s) => s.playbackSpeed);
  const setPlaybackTime = useCharacterStore((s) => s.setPlaybackTime);
  const togglePlayback = useCharacterStore((s) => s.togglePlayback);
  const setPlaybackSpeed = useCharacterStore((s) => s.setPlaybackSpeed);

  const clip = selectedAnimation ? animations[selectedAnimation] : null;
  const duration = clip?.duration ?? 1;

  const timeToX = useCallback((time: number) => {
    if (!trackRef.current) return 0;
    const w = trackRef.current.clientWidth;
    return (time / duration) * (w - 24) + 12;
  }, [duration]);

  const xToTime = useCallback((clientX: number) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = rect.width;
    const t = ((x - 12) / (w - 24)) * duration;
    return Math.max(0, Math.min(duration, t));
  }, [duration]);

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    setPlaybackTime(xToTime(e.clientX));
  }, [xToTime, setPlaybackTime]);

  const handleScrub = useCallback((e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      setPlaybackTime(xToTime(ev.clientX));
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    setPlaybackTime(xToTime(e.clientX));
  }, [xToTime, setPlaybackTime]);

  const handleStop = useCallback(() => {
    if (isPlaying) togglePlayback();
    setPlaybackTime(0);
  }, [isPlaying, togglePlayback, setPlaybackTime]);

  if (!selectedAnimation || !clip) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.controls, color: '#666', fontSize: 12 }}>
          Select an animation to use the timeline
        </div>
      </div>
    );
  }

  const scrubX = timeToX(playbackTime);

  return (
    <div style={styles.container}>
      <div style={styles.controls}>
        <button style={styles.btn} onClick={togglePlayback}>
          {isPlaying ? '\u23F8' : '\u25B6'}
        </button>
        <button style={styles.btn} onClick={handleStop}>
          {'\u25A0'}
        </button>
        <span style={styles.timeDisplay}>
          {playbackTime.toFixed(2)}s / {duration.toFixed(2)}s
        </span>
        <span style={styles.speedLabel}>Speed:</span>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.1}
          value={playbackSpeed}
          onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          style={{ width: 80 }}
        />
        <span style={{ fontSize: 11, color: '#aaa' }}>{playbackSpeed.toFixed(1)}x</span>
      </div>

      <div
        ref={trackRef}
        style={styles.track}
        onClick={handleTrackClick}
        onPointerDown={handleScrub}
      >
        {/* Time axis marks */}
        <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
          {/* Axis line */}
          <line x1="12" y1={TRACK_Y - 12} x2="calc(100% - 12)" y2={TRACK_Y - 12} stroke="#333" strokeWidth={1} />

          {/* Keyframe dots */}
          {clip.keyframes.map((kf, i) => {
            const x = (kf.time / duration) * 100;
            return (
              <circle
                key={i}
                cx={`${Math.max(2, Math.min(98, x))}%`}
                cy={TRACK_Y - 12}
                r={DOT_R}
                fill={Math.abs(kf.time - playbackTime) < 0.01 ? '#ffcc00' : '#77f'}
                stroke="#fff"
                strokeWidth={1}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setPlaybackTime(kf.time);
                }}
              />
            );
          })}

          {/* Scrubber line */}
          <line
            x1={`${(playbackTime / duration) * 100}%`}
            y1="0"
            x2={`${(playbackTime / duration) * 100}%`}
            y2="100%"
            stroke="#ffcc00"
            strokeWidth={1.5}
          />
        </svg>
      </div>
    </div>
  );
}
