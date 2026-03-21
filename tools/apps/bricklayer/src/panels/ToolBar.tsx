import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import type { ToolType } from '../store/types.js';

const tools: { id: ToolType; label: string; key: string }[] = [
  { id: 'place', label: 'Place', key: 'V' },
  { id: 'paint', label: 'Paint', key: 'B' },
  { id: 'erase', label: 'Erase', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'extrude', label: 'Extrude', key: 'X' },
  { id: 'eyedropper', label: 'Eyedrop', key: 'I' },
  { id: 'select', label: 'Select', key: 'S' },
];

const presetColors: [number, number, number, number][] = [
  [34, 139, 34, 255],
  [139, 90, 43, 255],
  [100, 100, 100, 255],
  [200, 200, 200, 255],
  [60, 60, 180, 255],
  [180, 60, 60, 255],
  [180, 180, 60, 255],
  [60, 180, 180, 255],
  [220, 160, 80, 255],
  [80, 40, 20, 255],
  [160, 80, 160, 255],
  [20, 20, 20, 255],
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 200,
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
  const activeTool = useSceneStore((s) => s.activeTool);
  const activeColor = useSceneStore((s) => s.activeColor);
  const brushSize = useSceneStore((s) => s.brushSize);
  const yLevelLock = useSceneStore((s) => s.yLevelLock);
  const setTool = useSceneStore((s) => s.setTool);
  const setActiveColor = useSceneStore((s) => s.setActiveColor);
  const setBrushSize = useSceneStore((s) => s.setBrushSize);
  const setYLevelLock = useSceneStore((s) => s.setYLevelLock);
  const showGrid = useSceneStore((s) => s.showGrid);
  const showCollision = useSceneStore((s) => s.showCollision);
  const showGizmos = useSceneStore((s) => s.showGizmos);
  const setShowGrid = useSceneStore((s) => s.setShowGrid);
  const setShowCollision = useSceneStore((s) => s.setShowCollision);
  const setShowGizmos = useSceneStore((s) => s.setShowGizmos);

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
          <span style={{ fontSize: 13 }}>{brushSize}</span>
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Y Level Lock</span>
        <div style={styles.row}>
          <input
            type="checkbox"
            checked={yLevelLock !== null}
            onChange={(e) => setYLevelLock(e.target.checked ? 0 : null)}
          />
          {yLevelLock !== null && (
            <input
              type="number"
              value={yLevelLock}
              onChange={(e) => setYLevelLock(Number(e.target.value))}
              style={styles.input}
            />
          )}
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>View</span>
        <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Grid
        </label>
        <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={showCollision} onChange={(e) => setShowCollision(e.target.checked)} />
          Collision
        </label>
        <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={showGizmos} onChange={(e) => setShowGizmos(e.target.checked)} />
          Gizmos
        </label>
      </div>
    </div>
  );
}
