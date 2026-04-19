import React, { useRef, useEffect, useState } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { pixelToFrame } from '../lib/frameUtils.js';
import { Ruler } from './Ruler.js';
import { StemLane } from './StemLane.js';

const LABEL_WIDTH = 120;

export function TimelinePanel() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stems = useWeaverStore((s) => s.stems);
  const addStem = useWeaverStore((s) => s.addStem);
  const moveStem = useWeaverStore((s) => s.moveStem);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Zoom (Ctrl/Cmd+scroll) and pan (plain scroll) — covers ruler + stem lanes
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const store = useWeaverStore.getState();
      const vs = store.viewStartFrame;
      const ve = store.viewEndFrame;
      const ww = el.getBoundingClientRect().width - LABEL_WIDTH;
      const cursorPx = e.clientX - el.getBoundingClientRect().left - LABEL_WIDTH;
      const mf = store.maxFrames();

      if (e.ctrlKey || e.metaKey) {
        // Zoom around cursor
        const cursorFrame = pixelToFrame(cursorPx, vs, ve, ww);
        const range = ve - vs;
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const newRange = Math.max(100, Math.min(mf > 0 ? mf : range, range * factor));
        if (Math.round(newRange) === Math.round(range)) return;
        const ratio = cursorPx / ww;
        const newStart = Math.max(0, cursorFrame - newRange * ratio);
        store.setView(Math.round(newStart), Math.round(newStart + newRange));
      } else {
        // Horizontal pan
        const range = ve - vs;
        const shift = (e.deltaX || e.deltaY) * (range / ww) * 0.5;
        let ns = vs + shift;
        let ne = ve + shift;
        if (ns < 0) { ne -= ns; ns = 0; }
        if (mf > 0 && ne > mf) { ns -= ne - mf; ne = mf; }
        const rnds = Math.round(Math.max(0, ns));
        const rnde = Math.round(ne);
        if (rnds === Math.round(vs) && rnde === Math.round(ve)) return;
        store.setView(rnds, rnde);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(wav|ogg|mp3|flac)$/i.test(f.name),
    );
    for (const file of files) {
      await addStem(file);
    }
  };

  return (
    <div className="weaver-timeline" ref={timelineRef}>
      <Ruler />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {stems.map((_, i) => (
          <div
            key={i}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIndex(i); }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => {
              e.preventDefault();
              const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
              if (!isNaN(from) && from !== i) moveStem(from, i);
              setDragOverIndex(null);
            }}
            onDragEnd={() => setDragOverIndex(null)}
            style={{ borderTop: dragOverIndex === i ? '2px solid #77aaff' : '2px solid transparent' }}
          >
            <StemLane key={i} index={i} />
          </div>
        ))}
        <input
          ref={fileRef}
          type="file"
          accept=".wav,.ogg,.mp3,.flac"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = e.target.files;
            if (!files) return;
            for (const file of Array.from(files)) {
              await addStem(file);
            }
            e.target.value = '';
          }}
        />
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px dashed #333', borderRadius: 6, margin: 8,
            color: '#5588cc', fontSize: 12, userSelect: 'none', cursor: 'pointer',
          }}
        >
          Drop .wav / .ogg files here or click to browse
        </div>
      </div>
    </div>
  );
}
