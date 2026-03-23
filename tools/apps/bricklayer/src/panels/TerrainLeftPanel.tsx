import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import { extractColorsFromFile } from '../lib/colorExtract.js';
import type { ToolType } from '../store/types.js';

const drawTools: { id: ToolType; label: string; key: string; icon: string }[] = [
  { id: 'place', label: 'Place', key: 'V', icon: '\u25A3' },   // ▣
  { id: 'paint', label: 'Paint', key: 'B', icon: '\u270E' },   // ✎
  { id: 'erase', label: 'Erase', key: 'E', icon: '\u25AB' },   // ▫
  { id: 'fill', label: 'Fill', key: 'G', icon: '\u25A7' },     // ▧
  { id: 'extrude', label: 'Extrude', key: 'X', icon: '\u2B06' }, // ⬆
];

const utilTools: { id: ToolType; label: string; key: string; icon: string }[] = [
  { id: 'eyedropper', label: 'Eyedrop', key: 'I', icon: '\u25C9' }, // ◉
  { id: 'select', label: 'Select', key: 'S', icon: '\u25AF' },     // ▯
];

const styles: Record<string, React.CSSProperties> = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 2,
  },
  toolBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 8px',
    border: '1px solid #444',
    borderRadius: 4,
    background: '#2a2a4a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 12,
  },
  toolIcon: {
    fontSize: 14,
    width: 18,
    textAlign: 'center' as const,
    opacity: 0.8,
    flexShrink: 0,
  },
  toolLabel: {
    flex: 1,
  },
  toolBtnActive: {
    background: '#4a4a8a',
    borderColor: '#77f',
  },
  shortcut: {
    fontSize: 10,
    color: '#777',
  },
  colorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(16, 1fr)',
    gap: 2,
  },
  colorSwatch: {
    width: '100%',
    aspectRatio: '1',
    border: '2px solid transparent',
    borderRadius: 3,
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
  btn: {
    padding: '4px 10px',
    border: '1px solid #555',
    borderRadius: 4,
    background: '#3a3a6a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 12,
  },
  select: {
    flex: 1,
    minWidth: 0,
    padding: '4px 6px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};

export function TerrainLeftPanel() {
  const activeTool = useSceneStore((s) => s.activeTool);
  const activeColor = useSceneStore((s) => s.activeColor);
  const brushSize = useSceneStore((s) => s.brushSize);
  const yLevelLock = useSceneStore((s) => s.yLevelLock);
  const setTool = useSceneStore((s) => s.setTool);
  const setActiveColor = useSceneStore((s) => s.setActiveColor);
  const setBrushSize = useSceneStore((s) => s.setBrushSize);
  const setYLevelLock = useSceneStore((s) => s.setYLevelLock);
  const colorPalettes = useSceneStore((s) => s.colorPalettes);
  const activePaletteIndex = useSceneStore((s) => s.activePaletteIndex);
  const setActivePalette = useSceneStore((s) => s.setActivePalette);
  const addPalette = useSceneStore((s) => s.addPalette);
  const addColorToPalette = useSceneStore((s) => s.addColorToPalette);

  const hexColor = `#${activeColor.slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const activePalette = colorPalettes[activePaletteIndex] ?? colorPalettes[0];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
      {/* Draw Tools */}
      <div style={styles.section}>
        <span style={styles.label}>Draw</span>
        {drawTools.map((t) => (
          <button
            key={t.id}
            style={{
              ...styles.toolBtn,
              ...(activeTool === t.id ? styles.toolBtnActive : {}),
            }}
            onClick={() => setTool(t.id)}
          >
            <span style={styles.toolIcon}>{t.icon}</span>
            <span style={styles.toolLabel}>{t.label}</span>
            <span style={styles.shortcut}>{t.key}</span>
          </button>
        ))}
      </div>

      {/* Utility Tools */}
      <div style={styles.section}>
        <span style={styles.label}>Utility</span>
        {utilTools.map((t) => (
          <button
            key={t.id}
            style={{
              ...styles.toolBtn,
              ...(activeTool === t.id ? styles.toolBtnActive : {}),
            }}
            onClick={() => setTool(t.id)}
          >
            <span style={styles.toolIcon}>{t.icon}</span>
            <span style={styles.toolLabel}>{t.label}</span>
            <span style={styles.shortcut}>{t.key}</span>
          </button>
        ))}
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
              width: 24,
              height: 24,
              borderRadius: 3,
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

        {/* Palette selector */}
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
                const colors = await extractColorsFromFile(file, 128);
                if (colors.length > 0) {
                  const palettes = [...useSceneStore.getState().colorPalettes, { name: file.name, colors }];
                  useSceneStore.setState({ colorPalettes: palettes, activePaletteIndex: palettes.length - 1 });
                }
              };
              input.click();
            }}
          >
            From Image
          </button>
        </div>

        {/* 8-column color grid */}
        <div style={styles.colorGrid}>
          {(activePalette?.colors ?? []).map((c, i) => (
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

      {/* Brush Size */}
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
          <span style={{ fontSize: 13 }}>{brushSize}</span>
        </div>
      </div>

      {/* Y Level Lock */}
      <div style={styles.section}>
        <span style={styles.label}>Y Level Lock</span>
        <div style={styles.row}>
          <input
            type="checkbox"
            checked={yLevelLock !== null}
            onChange={(e) => setYLevelLock(e.target.checked ? 0 : null)}
          />
          {yLevelLock !== null && (
            <NumberInput
              value={yLevelLock}
              onChange={setYLevelLock}
              style={styles.input}
            />
          )}
        </div>
      </div>

    </div>
  );
}
