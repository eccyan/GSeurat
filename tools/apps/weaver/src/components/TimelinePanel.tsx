import React from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { Ruler } from './Ruler.js';
import { StemLane } from './StemLane.js';

export function TimelinePanel() {
  const stems = useWeaverStore((s) => s.stems);
  const addStem = useWeaverStore((s) => s.addStem);

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
    <div className="weaver-timeline">
      <Ruler />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {stems.map((_, i) => (
          <StemLane key={i} index={i} />
        ))}
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{
            minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px dashed #333', borderRadius: 6, margin: 8,
            color: '#555', fontSize: 12, userSelect: 'none',
          }}
        >
          Drop .wav / .ogg files here
        </div>
      </div>
    </div>
  );
}
