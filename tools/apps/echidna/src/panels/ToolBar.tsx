import React from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType } from '../store/types.js';

const tools: { id: ToolType; label: string; key: string }[] = [
  { id: 'place', label: 'Place', key: 'V' },
  { id: 'paint', label: 'Paint', key: 'B' },
  { id: 'erase', label: 'Erase', key: 'E' },
  { id: 'eyedropper', label: 'Eyedrop', key: 'I' },
  { id: 'assign_part', label: 'Assign Part', key: 'A' },
  { id: 'box_select', label: 'Box Select', key: 'S' },
];

const presetColors: [number, number, number, number][] = [
  [180, 130, 90, 255],   // skin
  [80, 50, 30, 255],     // dark brown
  [220, 180, 140, 255],  // light skin
  [200, 200, 200, 255],  // light gray
  [100, 100, 100, 255],  // gray
  [20, 20, 20, 255],     // near black
  [60, 60, 180, 255],    // blue
  [180, 60, 60, 255],    // red
  [34, 139, 34, 255],    // green
  [180, 180, 60, 255],   // yellow
  [160, 80, 160, 255],   // purple
  [220, 160, 80, 255],   // orange
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 180,
    background: '#1e1e3a',
    borderRight: '1px solid #333',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  toolBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    border: '1px solid #444',
    borderRadius: 4,
    background: '#2a2a4a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 13,
  },
  toolBtnActive: {
    background: '#4a4a8a',
    borderColor: '#77f',
  },
  shortcut: {
    fontSize: 11,
    color: '#777',
  },
  colorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 4,
  },
  colorSwatch: {
    width: '100%',
    aspectRatio: '1',
    border: '2px solid transparent',
    borderRadius: 4,
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    width: 60,
    padding: '4px 6px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontSize: 13,
  },
};

export function ToolBar() {
  const activeTool = useCharacterStore((s) => s.activeTool);
  const activeColor = useCharacterStore((s) => s.activeColor);
  const brushSize = useCharacterStore((s) => s.brushSize);
  const setTool = useCharacterStore((s) => s.setTool);
  const setActiveColor = useCharacterStore((s) => s.setActiveColor);
  const setBrushSize = useCharacterStore((s) => s.setBrushSize);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const characterParts = useCharacterStore((s) => s.characterParts);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);

  const hexColor = `#${activeColor.slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('')}`;

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <span style={styles.label}>Tools</span>
        {tools.map((t) => (
          <button
            key={t.id}
            style={{
              ...styles.toolBtn,
              ...(activeTool === t.id ? styles.toolBtnActive : {}),
            }}
            onClick={() => setTool(t.id)}
          >
            {t.label}
            <span style={styles.shortcut}>{t.key}</span>
          </button>
        ))}
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Color</span>
        <div style={styles.row}>
          <input
            type="color"
            value={hexColor}
            onChange={(e) => {
              const hex = e.target.value;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              setActiveColor([r, g, b, activeColor[3]]);
            }}
            style={{ width: 40, height: 30, border: 'none', cursor: 'pointer' }}
          />
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 4,
              background: `rgba(${activeColor.join(',')})`,
              border: '1px solid #666',
            }}
          />
        </div>
        <div style={styles.colorGrid}>
          {presetColors.map((c, i) => (
            <div
              key={i}
              style={{
                ...styles.colorSwatch,
                background: `rgba(${c.join(',')})`,
                borderColor:
                  c[0] === activeColor[0] && c[1] === activeColor[1] && c[2] === activeColor[2]
                    ? '#fff'
                    : 'transparent',
              }}
              onClick={() => setActiveColor(c)}
            />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Brush Size</span>
        <div style={styles.row}>
          <input
            type="range"
            min={1}
            max={8}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 13, color: '#ddd' }}>{brushSize}</span>
        </div>
      </div>

      {activeTool === 'assign_part' && (
        <div style={styles.section}>
          <span style={styles.label}>Active Part</span>
          <select
            style={{ ...styles.input, width: '100%' }}
            value={selectedPart ?? ''}
            onChange={(e) => setSelectedPart(e.target.value || null)}
          >
            <option value="">(none)</option>
            {characterParts.map((p) => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
