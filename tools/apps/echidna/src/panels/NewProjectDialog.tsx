import React, { useState } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';

const PRESET_SIZES = [32, 64, 128, 256];

const styles: Record<string, React.CSSProperties> = {
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
    width: 360,
    color: '#ddd',
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 16 },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 16 },
  label: { fontSize: 12, color: '#aaa' },
  select: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13,
  },
  input: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13, width: '100%',
    boxSizing: 'border-box' as const,
  },
  btn: {
    padding: '6px 16px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 13,
  },
  btnPrimary: {
    padding: '6px 16px', border: '1px solid #77f', borderRadius: 4,
    background: '#4a4a8a', color: '#fff', cursor: 'pointer', fontSize: 13,
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
};

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [sizeOption, setSizeOption] = useState<string>('64');
  const [customSize, setCustomSize] = useState<number>(64);

  const isCustom = sizeOption === 'custom';
  const resolvedSize = isCustom
    ? Math.max(8, Math.min(1024, customSize))
    : Number(sizeOption);

  const handleCreate = () => {
    useCharacterStore.getState().newCharacter(resolvedSize);
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>New Project</div>

        <div style={styles.section}>
          <span style={styles.label}>Grid Size</span>
          <select
            style={styles.select}
            value={sizeOption}
            onChange={(e) => setSizeOption(e.target.value)}
          >
            {PRESET_SIZES.map((s) => (
              <option key={s} value={String(s)}>{s} × {s} × {s}</option>
            ))}
            <option value="custom">Custom...</option>
          </select>

          {isCustom && (
            <input
              type="number"
              style={styles.input}
              min={8}
              max={1024}
              value={customSize}
              onChange={(e) => setCustomSize(Number(e.target.value))}
            />
          )}
        </div>

        <div style={styles.footer}>
          <button style={styles.btn} onClick={onClose}>Cancel</button>
          <button style={styles.btnPrimary} onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}
