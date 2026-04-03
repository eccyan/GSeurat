import React, { useState, useMemo } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { parseKey } from '../lib/voxelUtils.js';

const PRESETS = [32, 64, 128, 256];

const styles: Record<string, React.CSSProperties> = {
  select: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13,
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 8,
    padding: 24,
    width: 400,
    color: '#ddd',
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 16 },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 16 },
  label: { fontSize: 12, color: '#aaa' },
  btn: {
    padding: '6px 16px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 13,
  },
  btnPrimary: {
    padding: '6px 16px', border: '1px solid #77f', borderRadius: 4,
    background: '#4a4a8a', color: '#fff', cursor: 'pointer', fontSize: 13,
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  warning: {
    fontSize: 12, color: '#ff8844', padding: '6px 8px', background: '#3a2a1a',
    borderRadius: 4, border: '1px solid #664422',
  },
  input: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13, width: 80,
  },
};

export function ResizeGridDialog({ onClose }: { onClose: () => void }) {
  const currentSize = useCharacterStore((s) => s.gridWidth);
  const voxels = useCharacterStore((s) => s.voxels);

  const initialPreset = PRESETS.includes(currentSize) ? String(currentSize) : 'custom';
  const [preset, setPreset] = useState<string>(initialPreset);
  const [customSize, setCustomSize] = useState<number>(currentSize);

  const newSize = preset === 'custom' ? customSize : Number(preset);

  const removedCount = useMemo(() => {
    if (newSize >= currentSize) return 0;
    let count = 0;
    for (const key of voxels.keys()) {
      const [x, , z] = parseKey(key);
      if (x >= newSize || z >= newSize) count++;
    }
    return count;
  }, [voxels, newSize, currentSize]);

  const handleResize = () => {
    if (removedCount > 0) {
      const confirmed = confirm(
        `${removedCount} voxel(s) will be removed because they are outside the new bounds. Continue?`
      );
      if (!confirmed) return;
    }
    useCharacterStore.getState().resizeGrid(newSize);
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Resize Grid</div>

        <div style={styles.section}>
          <span style={styles.label}>Current size: {currentSize}</span>
          <select
            style={styles.select}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {PRESETS.map((p) => (
              <option key={p} value={String(p)}>{p}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
          {preset === 'custom' && (
            <input
              type="number"
              style={styles.input}
              min={8}
              max={1024}
              value={customSize}
              onChange={(e) => setCustomSize(Math.max(8, Math.min(1024, Number(e.target.value))))}
            />
          )}
        </div>

        {removedCount > 0 && (
          <div style={styles.warning}>
            {'\u26A0'} {removedCount} voxel(s) will be removed (outside new bounds)
          </div>
        )}

        <div style={styles.footer}>
          <button style={styles.btn} onClick={onClose}>Cancel</button>
          <button style={styles.btnPrimary} onClick={handleResize}>Resize</button>
        </div>
      </div>
    </div>
  );
}
