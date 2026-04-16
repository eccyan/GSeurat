import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType } from '../store/types.js';

const drawTools: { id: ToolType; label: string; key: string; icon: string }[] = [
  { id: 'place', label: 'Place', key: 'V', icon: '\u25A3' },    // ▣
  { id: 'paint', label: 'Paint', key: 'B', icon: '\u270E' },    // ✎
  { id: 'erase', label: 'Erase', key: 'E', icon: '\u25AB' },    // ▫
  { id: 'fill', label: 'Fill', key: 'G', icon: '\u25A7' },      // ▧
  { id: 'extrude', label: 'Extrude', key: 'X', icon: '\u2B06' },// ⬆
];

const utilTools: { id: ToolType; label: string; key: string; icon: string }[] = [
  { id: 'orbit', label: 'Orbit', key: 'Q', icon: '\u27F2' },        // ⟲
  { id: 'eyedropper', label: 'Eyedrop', key: 'I', icon: '\u25C9' }, // ◉
  { id: 'box_select', label: 'Box Select', key: 'S', icon: '\u25AF' }, // ▯
  { id: 'lasso_select', label: 'Lasso', key: 'L', icon: '\u2312' },   // ⌒
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
  section: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 2 },
  toolGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  toolBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32,
    border: '1px solid #444', borderRadius: 4,
    background: '#2a2a4a', color: '#ddd',
    cursor: 'pointer', fontSize: 16, padding: 0,
  },
  toolBtnActive: { background: '#4a4a8a', borderColor: '#77f' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  colorGrid: { display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 2 },
  colorSwatch: {
    width: '100%', aspectRatio: '1',
    border: '2px solid transparent', borderRadius: 3,
    cursor: 'pointer',
  },
  btn: {
    padding: '4px 10px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  select: {
    flex: 1, minWidth: 0,
    padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 12,
    overflow: 'hidden', textOverflow: 'ellipsis',
  },
};

export function ToolBar() {
  useComponentRegistry('ToolBar');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const activeColor = useCharacterStore((s) => s.activeColor);
  const brushSize = useCharacterStore((s) => s.brushSize);
  const setTool = useCharacterStore((s) => s.setTool);
  const setActiveColor = useCharacterStore((s) => s.setActiveColor);
  const setBrushSize = useCharacterStore((s) => s.setBrushSize);

  const colorPalettes = useCharacterStore((s) => s.asset?.colorPalettes ?? []);
  const activePaletteIndex = useCharacterStore((s) => s.activePaletteIndex);
  const setActivePalette = useCharacterStore((s) => s.setActivePalette);
  const addPalette = useCharacterStore((s) => s.addPalette);
  const addColorToPalette = useCharacterStore((s) => s.addColorToPalette);
  const addPaletteFromFile = useCharacterStore((s) => s.addPaletteFromFile);

  const hexColor = `#${activeColor.slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const activePalette = colorPalettes[activePaletteIndex] ?? colorPalettes[0];

  return (
    <div style={styles.container}>
      {/* Draw */}
      <div style={styles.section}>
        <span style={styles.label}>Draw</span>
        <div style={styles.toolGrid}>
          {drawTools.map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.key})`}
              style={{ ...styles.toolBtn, ...(activeTool === t.id ? styles.toolBtnActive : {}) }}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div style={{ ...styles.row, marginTop: 4 }}>
          <input
            type="range"
            min={1}
            max={8}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 11, color: '#888', minWidth: 14 }}>{brushSize}</span>
        </div>
      </div>

      {/* Utility */}
      <div style={styles.section}>
        <span style={styles.label}>Utility</span>
        <div style={styles.toolGrid}>
          {utilTools.map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.key})`}
              style={{ ...styles.toolBtn, ...(activeTool === t.id ? styles.toolBtnActive : {}) }}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Color */}
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
            style={{ width: 30, height: 24, border: 'none', cursor: 'pointer' }}
          />
          <div
            style={{
              width: 24, height: 24, borderRadius: 3,
              background: `rgba(${activeColor.join(',')})`,
              border: '1px solid #666',
            }}
          />
          <button
            style={{ ...styles.btn, fontSize: 11, padding: '2px 6px' }}
            onClick={() => addColorToPalette(activePaletteIndex, [...activeColor] as [number, number, number, number])}
          >
            + Palette
          </button>
        </div>

        <div style={styles.row}>
          <select
            value={activePaletteIndex}
            onChange={(e) => setActivePalette(Number(e.target.value))}
            style={styles.select}
          >
            {colorPalettes.map((p, i) => (
              <option key={i} value={i}>{p.name}</option>
            ))}
          </select>
          <button
            style={{ ...styles.btn, fontSize: 11, padding: '2px 6px' }}
            onClick={() => addPalette(`Palette ${colorPalettes.length + 1}`)}
          >
            New
          </button>
          <button
            style={{ ...styles.btn, fontSize: 11, padding: '2px 6px' }}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                await addPaletteFromFile(file);
              };
              input.click();
            }}
          >
            From Image
          </button>
        </div>

        <div style={styles.colorGrid}>
          {(activePalette?.colors ?? []).map((c, i) => {
            const isEmpty = c[3] === 0;
            const isSelected = !isEmpty &&
              c[0] === activeColor[0] && c[1] === activeColor[1] && c[2] === activeColor[2];
            return (
              <div
                key={i}
                style={{
                  ...styles.colorSwatch,
                  background: isEmpty ? '#1a1a2e' : `rgba(${c.join(',')})`,
                  borderColor: isSelected ? '#fff' : 'transparent',
                }}
                onClick={() => { if (!isEmpty) setActiveColor(c); }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
