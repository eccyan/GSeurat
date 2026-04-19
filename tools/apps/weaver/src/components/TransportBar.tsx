import React from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { framesToSeconds } from '../lib/frameUtils.js';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function TransportBar() {
  const isPlaying = useWeaverStore((s) => s.isPlaying);
  const setIsPlaying = useWeaverStore((s) => s.setIsPlaying);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const playheadFrame = useWeaverStore((s) => s.playheadFrame);
  const loopEnabled = useWeaverStore((s) => s.loopEnabled);
  const setLoopEnabled = useWeaverStore((s) => s.setLoopEnabled);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const maxFrames = useWeaverStore((s) => s.maxFrames);
  const bpm = useWeaverStore((s) => s.bpm);
  const masterVolume = useWeaverStore((s) => s.masterVolume);
  const setMasterVolume = useWeaverStore((s) => s.setMasterVolume);

  const currentSec = framesToSeconds(playheadFrame, sampleRate);
  const totalSec = framesToSeconds(maxFrames(), sampleRate);

  // Bar:beat display
  const beatsPerSec = bpm / 60;
  const totalBeats = currentSec * beatsPerSec;
  const bar = Math.floor(totalBeats / 4) + 1;
  const beat = Math.floor(totalBeats % 4) + 1;

  const handleRewind = () => {
    const state = useWeaverStore.getState();
    if (state.isPlaying) {
      setIsPlaying(false);
      setPlayheadFrame(0);
      queueMicrotask(() => setIsPlaying(true));
    } else {
      setPlayheadFrame(0);
    }
  };

  const btnStyle: React.CSSProperties = {
    background: '#2a2a4a', border: '1px solid #555', color: '#e0e0e0',
    padding: '4px 10px', cursor: 'pointer', fontSize: 14, borderRadius: 3,
    minWidth: 32, textAlign: 'center',
  };

  return (
    <div className="weaver-transport">
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button style={btnStyle} onClick={handleRewind} title="Rewind">
          {'\u23EE'}
        </button>
        <button
          style={{ ...btnStyle, background: isPlaying ? '#335533' : '#2a2a4a' }}
          onClick={() => setIsPlaying(!isPlaying)}
          title={isPlaying ? 'Stop' : 'Play'}
        >
          {isPlaying ? '\u23F9' : '\u25B6'}
        </button>
        <button
          style={{ ...btnStyle, opacity: loopEnabled ? 1 : 0.5 }}
          onClick={() => setLoopEnabled(!loopEnabled)}
          title="Toggle Loop"
        >
          {'\uD83D\uDD01'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginLeft: 16 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 14, color: '#77aaff', minWidth: 100 }}>
          {formatTime(currentSec)} <span style={{ color: '#555' }}>/</span> {formatTime(totalSec)}
        </div>
        <div style={{ fontSize: 11, color: '#888' }}>
          Bar {bar} : Beat {beat}
        </div>
        <div style={{ fontSize: 11, color: '#666' }}>
          Frame {playheadFrame}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
        <span style={{ fontSize: 10, color: '#888' }}>Master</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => setMasterVolume(Number(e.target.value))}
          style={{ width: 80 }}
        />
        <span style={{ fontSize: 10, color: '#888', minWidth: 30 }}>
          {Math.round(masterVolume * 100)}%
        </span>
      </div>
    </div>
  );
}
