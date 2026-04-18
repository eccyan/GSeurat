import React, { useRef, useEffect } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { frameToPixel } from '../lib/frameUtils.js';

const LABEL_WIDTH = 120;
const LANE_HEIGHT = 80;

interface StemLaneProps {
  index: number;
}

export function StemLane({ index }: StemLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stem = useWeaverStore((s) => s.stems[index]);
  const viewStart = useWeaverStore((s) => s.viewStartFrame);
  const viewEnd = useWeaverStore((s) => s.viewEndFrame);
  const loopStart = useWeaverStore((s) => s.loopStart);
  const loopEnd = useWeaverStore((s) => s.loopEnd);
  const playheadFrame = useWeaverStore((s) => s.playheadFrame);
  const setStemVolume = useWeaverStore((s) => s.setStemVolume);
  const removeStem = useWeaverStore((s) => s.removeStem);
  const toggleMute = useWeaverStore((s) => s.toggleMute);
  const toggleSolo = useWeaverStore((s) => s.toggleSolo);
  const loopEnabled = useWeaverStore((s) => s.loopEnabled);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stem) return;

    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = LANE_HEIGHT;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const waveWidth = w - LABEL_WIDTH;
    ctx.clearRect(0, 0, w, h);

    // Label area background
    ctx.fillStyle = '#16213e';
    ctx.fillRect(0, 0, LABEL_WIDTH, h);

    // Waveform area background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(LABEL_WIDTH, 0, waveWidth, h);

    // Loop region overlay
    if (loopEnd > loopStart) {
      const lsX = LABEL_WIDTH + frameToPixel(loopStart, viewStart, viewEnd, waveWidth);
      const leX = LABEL_WIDTH + frameToPixel(loopEnd, viewStart, viewEnd, waveWidth);
      ctx.fillStyle = loopEnabled ? 'rgba(68, 204, 102, 0.1)' : 'rgba(68, 204, 102, 0.03)';
      ctx.fillRect(
        Math.max(LABEL_WIDTH, lsX), 0,
        Math.min(w, leX) - Math.max(LABEL_WIDTH, lsX), h,
      );
    }

    // Draw waveform
    const peaks = stem.waveformPeaks;
    if (peaks && peaks.length > 0) {
      const totalFrames = stem.audioBuffer?.length ?? 0;
      const midY = h / 2;
      ctx.beginPath();
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 1;

      for (let px = 0; px < waveWidth; px++) {
        const frameStart = viewStart + (px / waveWidth) * (viewEnd - viewStart);
        const frameEnd = viewStart + ((px + 1) / waveWidth) * (viewEnd - viewStart);
        // Map frame range to peak bucket
        const bucketStart = Math.floor((frameStart / totalFrames) * peaks.length);
        const bucketEnd = Math.ceil((frameEnd / totalFrames) * peaks.length);
        let maxPeak = 0;
        for (let b = Math.max(0, bucketStart); b < Math.min(peaks.length, bucketEnd); b++) {
          maxPeak = Math.max(maxPeak, Math.abs(peaks[b]));
        }
        const amp = maxPeak * (h / 2 - 2);
        const x = LABEL_WIDTH + px;
        ctx.moveTo(x, midY - amp);
        ctx.lineTo(x, midY + amp);
      }
      ctx.stroke();
    }

    // Playhead line
    const phX = LABEL_WIDTH + frameToPixel(playheadFrame, viewStart, viewEnd, waveWidth);
    if (phX >= LABEL_WIDTH && phX <= w) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, h);
      ctx.stroke();
    }

    // Separator line at bottom
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();
  }, [stem, viewStart, viewEnd, loopStart, loopEnd, loopEnabled, playheadFrame]);

  if (!stem) return null;

  return (
    <div style={{ position: 'relative', height: LANE_HEIGHT, display: 'flex' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: LANE_HEIGHT }}
      />
      {/* Label overlay */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, width: LABEL_WIDTH, height: LANE_HEIGHT,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: '4px 8px', zIndex: 1, pointerEvents: 'auto',
        }}
      >
        <div style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {stem.fileName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={stem.initialVolume}
            onChange={(e) => setStemVolume(index, Number(e.target.value))}
            style={{ width: 60 }}
          />
          <span style={{ fontSize: 10, color: '#888' }}>{Math.round(stem.initialVolume * 100)}%</span>
        </div>
        <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
          <button
            onClick={() => toggleMute(index)}
            style={{
              padding: '0 4px', fontSize: 9, minWidth: 20,
              background: stem.muted ? '#ff4444' : '#333',
              color: stem.muted ? '#fff' : '#888',
              border: '1px solid #555', borderRadius: 2, cursor: 'pointer',
            }}
          >
            M
          </button>
          <button
            onClick={() => toggleSolo(index)}
            style={{
              padding: '0 4px', fontSize: 9, minWidth: 20,
              background: stem.soloed ? '#ffaa00' : '#333',
              color: stem.soloed ? '#000' : '#888',
              border: '1px solid #555', borderRadius: 2, cursor: 'pointer',
            }}
          >
            S
          </button>
        </div>
        <button
          onClick={() => removeStem(index)}
          style={{ position: 'absolute', top: 2, right: 2, padding: '0 4px', fontSize: 10 }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
