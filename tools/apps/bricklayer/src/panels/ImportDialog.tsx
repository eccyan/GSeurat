import React, { useRef, useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  dialog: {
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 8,
    padding: 24,
    width: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  title: { fontSize: 16, fontWeight: 600 },
  row: { display: 'flex', alignItems: 'center', gap: 12 },
  label: { fontSize: 13, color: '#aaa', minWidth: 80 },
  input: {
    flex: 1,
    padding: '6px 8px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontSize: 13,
  },
  select: {
    flex: 1,
    padding: '6px 8px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontSize: 13,
  },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  btn: {
    padding: '6px 16px',
    border: '1px solid #555',
    borderRadius: 4,
    background: '#3a3a6a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 13,
  },
  btnPrimary: {
    padding: '6px 16px',
    border: '1px solid #77f',
    borderRadius: 4,
    background: '#4a4a8a',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  },
};

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'flat' | 'luminance'>('flat');
  const [maxHeight, setMaxHeight] = useState(16);
  const [file, setFile] = useState<File | null>(null);

  const handleImport = () => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const store = useSceneStore.getState();
      store.pushUndo();
      store.importImage(imageData, mode, maxHeight);
      onClose();
    };
    img.src = URL.createObjectURL(file);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <span style={styles.title}>Import Image</span>

        <div style={styles.row}>
          <span style={styles.label}>File</span>
          <button style={styles.btn} onClick={() => fileRef.current?.click()}>
            {file ? file.name : 'Choose...'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Mode</span>
          <select
            style={styles.select}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'flat' | 'luminance')}
          >
            <option value="flat">Flat (1 voxel per pixel)</option>
            <option value="luminance">Luminance (height from brightness)</option>
          </select>
        </div>

        {mode === 'luminance' && (
          <div style={styles.row}>
            <span style={styles.label}>Max Height</span>
            <input
              type="range"
              min={1}
              max={64}
              value={maxHeight}
              onChange={(e) => setMaxHeight(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 13 }}>{maxHeight}</span>
          </div>
        )}

        <div style={styles.actions}>
          <button style={styles.btn} onClick={onClose}>Cancel</button>
          <button style={styles.btnPrimary} onClick={handleImport} disabled={!file}>Import</button>
        </div>
      </div>
    </div>
  );
}
