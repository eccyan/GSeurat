import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { frameToPixel, pixelToFrame, frameToBarBeat } from '../lib/frameUtils.js';

const LABEL_WIDTH = 120;
const RULER_HEIGHT = 32;
const HANDLE_SIZE = 10;
const MIN_LOOP_FRAMES = 4410; // Must match useAudioPlayer

export function Ruler() {
  const rulerRef = useRef<HTMLDivElement>(null);

  const viewStart = useWeaverStore((s) => s.viewStartFrame);
  const viewEnd = useWeaverStore((s) => s.viewEndFrame);
  const setView = useWeaverStore((s) => s.setView);
  const loopStart = useWeaverStore((s) => s.loopStart);
  const loopEnd = useWeaverStore((s) => s.loopEnd);
  const setLoopStart = useWeaverStore((s) => s.setLoopStart);
  const setLoopEnd = useWeaverStore((s) => s.setLoopEnd);
  const resetLoop = useWeaverStore((s) => s.resetLoop);
  const markers = useWeaverStore((s) => s.markers);
  const addMarker = useWeaverStore((s) => s.addMarker);
  const moveMarker = useWeaverStore((s) => s.moveMarker);
  const playheadFrame = useWeaverStore((s) => s.playheadFrame);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const bpm = useWeaverStore((s) => s.bpm);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const maxFrames = useWeaverStore((s) => s.maxFrames);
  const loopEnabled = useWeaverStore((s) => s.loopEnabled);

  const getWaveWidth = useCallback(() => {
    if (!rulerRef.current) return 600;
    return rulerRef.current.getBoundingClientRect().width - LABEL_WIDTH;
  }, []);

  const pxToFrame = useCallback(
    (clientX: number) => {
      if (!rulerRef.current) return 0;
      const rect = rulerRef.current.getBoundingClientRect();
      const px = clientX - rect.left - LABEL_WIDTH;
      return pixelToFrame(px, viewStart, viewEnd, getWaveWidth());
    },
    [viewStart, viewEnd, getWaveWidth],
  );

  // Click ruler to seek, Shift+click to add marker
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).dataset.handle) return;
      const frame = pxToFrame(e.clientX);
      if (e.shiftKey) {
        addMarker(Math.max(0, frame));
      } else {
        setPlayheadFrame(Math.max(0, frame));
      }
    },
    [pxToFrame, addMarker, setPlayheadFrame],
  );

  // Drag helper using pointer capture on window
  const startDrag = useCallback(
    (onMove: (clientX: number) => void) => {
      const handleMove = (e: PointerEvent) => onMove(e.clientX);
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [],
  );

  // Loop handle drags
  const onLoopStartDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      startDrag((cx) => {
        const f = Math.max(0, pxToFrame(cx));
        setLoopStart(Math.min(f, loopEnd > 0 ? loopEnd - 1 : maxFrames()));
      });
    },
    [startDrag, pxToFrame, setLoopStart, loopEnd, maxFrames],
  );

  const onLoopEndDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      startDrag((cx) => {
        const f = Math.max(loopStart + 1, pxToFrame(cx));
        setLoopEnd(f);
      });
    },
    [startDrag, pxToFrame, setLoopEnd, loopStart],
  );

  // Marker drag
  const onMarkerDown = useCallback(
    (e: React.PointerEvent, idx: number) => {
      e.stopPropagation();
      startDrag((cx) => {
        moveMarker(idx, Math.max(0, pxToFrame(cx)));
      });
    },
    [startDrag, pxToFrame, moveMarker],
  );

  // Note: Zoom/pan wheel handling is in TimelinePanel (covers ruler + stem lanes)

  // Compute beat ticks (memoized for pan/zoom performance)
  const waveWidth = getWaveWidth();
  const ticks = useMemo(() => {
    const beatsPerSecond = bpm / 60;
    const framesPerBeat = sampleRate / beatsPerSecond;
    const result: { px: number; label: string; major: boolean }[] = [];
    if (viewEnd > viewStart && framesPerBeat > 0) {
      const firstBeat = Math.floor(viewStart / framesPerBeat);
      const lastBeat = Math.ceil(viewEnd / framesPerBeat);
      for (let b = firstBeat; b <= lastBeat; b++) {
        const frame = b * framesPerBeat;
        const px = LABEL_WIDTH + frameToPixel(frame, viewStart, viewEnd, waveWidth);
        if (px < LABEL_WIDTH || px > LABEL_WIDTH + waveWidth) continue;
        const { bar, beat } = frameToBarBeat(frame, sampleRate, bpm);
        const major = beat === 1;
        result.push({ px, label: major ? `${bar}` : '', major });
      }
    }
    return result;
  }, [viewStart, viewEnd, bpm, sampleRate, waveWidth]);

  const loopStartPx = LABEL_WIDTH + frameToPixel(loopStart, viewStart, viewEnd, waveWidth);
  const loopEndPx = LABEL_WIDTH + frameToPixel(loopEnd, viewStart, viewEnd, waveWidth);
  const playheadPx = LABEL_WIDTH + frameToPixel(playheadFrame, viewStart, viewEnd, waveWidth);
  const loopTooSmall = loopEnd > loopStart && (loopEnd - loopStart) < MIN_LOOP_FRAMES;

  return (
    <div
      ref={rulerRef}
      className="weaver-ruler"
      onPointerDown={handlePointerDown}
      style={{
        position: 'relative', height: RULER_HEIGHT, background: '#16213e',
        borderBottom: '1px solid #333', overflow: 'hidden', flexShrink: 0,
      }}
    >
      {/* Label area */}
      <div style={{
        position: 'absolute', left: 0, top: 0, width: LABEL_WIDTH, height: '100%',
        borderRight: '1px solid #333', display: 'flex', alignItems: 'center',
        paddingLeft: 8, fontSize: 10, color: '#888',
      }}>
        Ruler
      </div>

      {/* Beat ticks */}
      {ticks.map((t, i) => (
        <div key={i} style={{
          position: 'absolute', left: t.px, bottom: 0,
          width: 1, height: t.major ? 16 : 8,
          background: t.major ? '#666' : '#444',
        }}>
          {t.label && (
            <span style={{
              position: 'absolute', bottom: '100%', left: 2,
              fontSize: 9, color: '#888', whiteSpace: 'nowrap',
            }}>
              {t.label}
            </span>
          )}
        </div>
      ))}

      {/* Loop region highlight — red when too small, double-click to reset */}
      {loopEnd > loopStart && (
        <div
          onDoubleClick={(e) => { e.stopPropagation(); resetLoop(); }}
          title="Double-click to reset loop region"
          style={{
            position: 'absolute', left: loopStartPx, top: 0,
            width: loopEndPx - loopStartPx, height: '100%',
            background: loopTooSmall
              ? 'rgba(255, 68, 68, 0.2)'
              : loopEnabled ? 'rgba(68, 204, 102, 0.15)' : 'rgba(68, 204, 102, 0.05)',
            pointerEvents: 'auto', cursor: 'pointer',
          }}
        />
      )}

      {/* Loop start handle (green triangle) */}
      <div
        data-handle="loop-start"
        onPointerDown={onLoopStartDown}
        style={{
          position: 'absolute', left: loopStartPx - HANDLE_SIZE / 2, top: 0,
          width: 0, height: 0, cursor: 'ew-resize',
          borderLeft: `${HANDLE_SIZE / 2}px solid transparent`,
          borderRight: `${HANDLE_SIZE / 2}px solid transparent`,
          borderTop: `${HANDLE_SIZE}px solid ${loopEnabled ? '#44cc66' : '#44cc6644'}`,
        }}
      />

      {/* Loop end handle (red triangle) */}
      <div
        data-handle="loop-end"
        onPointerDown={onLoopEndDown}
        style={{
          position: 'absolute', left: loopEndPx - HANDLE_SIZE / 2, top: 0,
          width: 0, height: 0, cursor: 'ew-resize',
          borderLeft: `${HANDLE_SIZE / 2}px solid transparent`,
          borderRight: `${HANDLE_SIZE / 2}px solid transparent`,
          borderTop: `${HANDLE_SIZE}px solid ${loopEnabled ? '#ff6644' : '#ff664444'}`,
        }}
      />

      {/* Markers (diamonds) */}
      {markers.map((m, i) => {
        const mx = LABEL_WIDTH + frameToPixel(m.frame, viewStart, viewEnd, waveWidth);
        if (mx < LABEL_WIDTH || mx > LABEL_WIDTH + waveWidth) return null;
        return (
          <div
            key={i}
            data-handle="marker"
            onPointerDown={(e) => onMarkerDown(e, i)}
            title={m.name}
            style={{
              position: 'absolute', left: mx - 5, top: RULER_HEIGHT / 2 - 5,
              width: 10, height: 10, cursor: 'ew-resize',
              background: '#ffaa00', transform: 'rotate(45deg)',
            }}
          />
        );
      })}

      {/* Playhead line */}
      <div style={{
        position: 'absolute', left: playheadPx, top: 0,
        width: 1, height: '100%', background: '#ffffff',
        pointerEvents: 'none',
      }} />

      {/* Hint text */}
      <div style={{
        position: 'absolute', right: 8, bottom: 2,
        fontSize: 9, color: '#555', pointerEvents: 'none',
      }}>
        Click=seek &middot; Shift+click=marker &middot; Scroll=pan &middot; {'\u2318'}+scroll=zoom
      </div>
    </div>
  );
}
