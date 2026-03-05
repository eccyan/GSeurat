import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Timeline } from './components/Timeline.js';
import { SpritePreview } from './components/SpritePreview.js';
import { StateMachineGraph } from './components/StateMachineGraph.js';
import { ClipProperties } from './components/ClipProperties.js';
import { ClipList } from './components/ClipList.js';
import { AIAssistPanel } from './components/AIAssistPanel.js';
import { useAnimatorStore, getClipDuration } from './store/useAnimatorStore.js';

// ---------------------------------------------------------------------------
// Tab type for center-bottom area
// ---------------------------------------------------------------------------

type CenterTab = 'timeline' | 'state_machine';

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({ centerTab, onCenterTab }: {
  centerTab: CenterTab;
  onCenterTab: (tab: CenterTab) => void;
}) {
  const playbackState = useAnimatorStore((s) => s.playbackState);
  const currentTime = useAnimatorStore((s) => s.currentTime);
  const clips = useAnimatorStore((s) => s.clips);
  const selectedClipId = useAnimatorStore((s) => s.selectedClipId);
  const { setPlaybackState, setCurrentTime } = useAnimatorStore();

  const clip = clips.find((c) => c.id === selectedClipId) ?? null;
  const duration = clip ? getClipDuration(clip) : 0;

  const handlePlay = useCallback(() => {
    if (playbackState === 'playing') {
      setPlaybackState('paused');
    } else {
      if (currentTime >= duration && !clip?.loop) {
        setCurrentTime(0);
      }
      setPlaybackState('playing');
    }
  }, [playbackState, currentTime, duration, clip, setPlaybackState, setCurrentTime]);

  const handleStop = useCallback(() => {
    setPlaybackState('stopped');
    setCurrentTime(0);
  }, [setPlaybackState, setCurrentTime]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setCurrentTime(parseFloat(e.target.value));
    },
    [setCurrentTime],
  );

  const isPlaying = playbackState === 'playing';
  const isPaused = playbackState === 'paused';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        height: 36,
        background: '#1a1a2a',
        borderBottom: '1px solid #2a2a3a',
        flexShrink: 0,
      }}
    >
      {/* App title */}
      <span
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#4a6a9a',
          fontWeight: 600,
          letterSpacing: '0.04em',
          marginRight: 8,
        }}
      >
        KEYFRAME ANIMATOR
      </span>

      {/* Playback controls */}
      <button onClick={handleStop} style={tbBtnStyle} title="Stop">
        ■
      </button>
      <button
        onClick={handlePlay}
        style={{
          ...tbBtnStyle,
          background: isPlaying ? '#2a3a5a' : '#1e1e30',
          borderColor: isPlaying ? '#4a6aaa' : '#333',
          color: isPlaying ? '#90b8f8' : '#aaa',
        }}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Scrub bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 320 }}>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.001}
          value={Math.min(currentTime, duration || 1)}
          onChange={handleScrub}
          style={{ flex: 1, accentColor: '#f0c040', height: 4 }}
        />
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: '#888',
            width: 64,
            textAlign: 'right',
          }}
        >
          {currentTime.toFixed(3)}s
        </span>
        {duration > 0 && (
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#445' }}>
            / {duration.toFixed(3)}s
          </span>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Center panel tabs */}
      <TabButton
        label="Timeline"
        active={centerTab === 'timeline'}
        onClick={() => onCenterTab('timeline')}
      />
      <TabButton
        label="State Machine"
        active={centerTab === 'state_machine'}
        onClick={() => onCenterTab('state_machine')}
      />
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#1e2a42' : 'transparent',
        border: active ? '1px solid #3a5a8a' : '1px solid #2a2a3a',
        borderRadius: 3,
        color: active ? '#90b8f8' : '#666',
        fontFamily: 'monospace',
        fontSize: 10,
        padding: '3px 10px',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Playback engine — runs RAF loop when playing
// ---------------------------------------------------------------------------

function usePlaybackEngine() {
  const playbackState = useAnimatorStore((s) => s.playbackState);
  const clips = useAnimatorStore((s) => s.clips);
  const selectedClipId = useAnimatorStore((s) => s.selectedClipId);
  const { setCurrentTime, setPlaybackState, currentTime } = useAnimatorStore();

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (playbackState !== 'playing') {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        lastTimeRef.current = null;
      }
      return;
    }

    const clip = clips.find((c) => c.id === selectedClipId);
    const duration = clip ? clip.frames.reduce((s, f) => s + f.duration, 0) : 0;

    const tick = (now: number) => {
      if (lastTimeRef.current === null) lastTimeRef.current = now;
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      const store = useAnimatorStore.getState();
      let t = store.currentTime + dt;

      if (clip?.loop) {
        if (duration > 0) t = t % duration;
      } else {
        if (t >= duration) {
          t = duration;
          setPlaybackState('stopped');
          setCurrentTime(t);
          return;
        }
      }

      setCurrentTime(t);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTimeRef.current = null;
    };
  }, [playbackState, selectedClipId, clips, setCurrentTime, setPlaybackState]);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const [centerTab, setCenterTab] = useState<CenterTab>('timeline');
  const [rightTab, setRightTab] = useState<'properties' | 'ai'>('properties');

  // Start playback engine
  usePlaybackEngine();

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space = play/pause
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        const store = useAnimatorStore.getState();
        if (store.playbackState === 'playing') {
          store.setPlaybackState('paused');
        } else {
          store.setPlaybackState('playing');
        }
      }
      // Escape = stop
      if (e.code === 'Escape') {
        const store = useAnimatorStore.getState();
        store.setPlaybackState('stopped');
        store.setCurrentTime(0);
      }
      // [ / ] = prev/next frame
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        const store = useAnimatorStore.getState();
        const clip = store.clips.find((c) => c.id === store.selectedClipId);
        if (!clip || clip.frames.length === 0) return;
        const fi = store.selectedFrameIndex ?? 0;
        const next = e.code === 'BracketRight'
          ? Math.min(fi + 1, clip.frames.length - 1)
          : Math.max(fi - 1, 0);
        store.selectFrame(next);
        // Advance time to that frame
        let t = 0;
        for (let i = 0; i < next; i++) t += clip.frames[i].duration;
        store.setCurrentTime(t);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={styles.root}>
      {/* Toolbar */}
      <Toolbar centerTab={centerTab} onCenterTab={setCenterTab} />

      {/* Body */}
      <div style={styles.body}>
        {/* Left: clip list */}
        <div style={{ width: 160, flexShrink: 0 }}>
          <ClipList />
        </div>

        {/* Center column */}
        <div style={styles.centerCol}>
          {/* Center top: sprite preview */}
          <div style={{ flex: '0 0 260px', borderBottom: '1px solid #2a2a3a', overflow: 'hidden' }}>
            <SpritePreview />
          </div>
          {/* Center bottom: timeline or state machine */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {centerTab === 'timeline' ? <Timeline /> : <StateMachineGraph />}
          </div>
        </div>

        {/* Right: properties + AI toggle */}
        <div style={styles.rightCol}>
          {/* Right tab bar */}
          <div
            style={{
              display: 'flex',
              background: '#1a1a28',
              borderBottom: '1px solid #2a2a3a',
              flexShrink: 0,
            }}
          >
            <RightTab
              label="Properties"
              active={rightTab === 'properties'}
              onClick={() => setRightTab('properties')}
            />
            <RightTab
              label="AI Assist"
              active={rightTab === 'ai'}
              onClick={() => setRightTab('ai')}
            />
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {rightTab === 'properties' ? <ClipProperties /> : <AIAssistPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}

function RightTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? '#131320' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #4a6aaa' : '2px solid transparent',
        borderRight: '1px solid #2a2a3a',
        color: active ? '#90b8f8' : '#555',
        fontFamily: 'monospace',
        fontSize: 10,
        padding: '5px 0',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    background: '#0e0e1a',
    overflow: 'hidden',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  centerCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderLeft: '1px solid #2a2a3a',
    borderRight: '1px solid #2a2a3a',
  },
  rightCol: {
    width: 280,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
};

const tbBtnStyle: React.CSSProperties = {
  background: '#1e1e30',
  border: '1px solid #333',
  borderRadius: 3,
  color: '#aaa',
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '2px 8px',
  cursor: 'pointer',
};
