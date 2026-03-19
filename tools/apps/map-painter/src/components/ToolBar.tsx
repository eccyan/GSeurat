import React from 'react';
import { useMapStore, type Tool, type Layer } from '../store/useMapStore.js';

const TOOLS: { id: Tool; label: string; shortcut: string }[] = [
  { id: 'pencil', label: 'Pencil', shortcut: 'B' },
  { id: 'fill', label: 'Fill', shortcut: 'G' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'rectangle', label: 'Rect', shortcut: 'R' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'height', label: 'Height', shortcut: 'H' },
  { id: 'select', label: 'Collision', shortcut: 'C' },
];

const LAYERS: { id: Layer; label: string; color: string }[] = [
  { id: 'ground', label: 'Ground', color: '#4a7' },
  { id: 'walls', label: 'Walls', color: '#888' },
  { id: 'decorations', label: 'Deco', color: '#da5' },
];

const PRESETS: { label: string; color: [number, number, number, number] }[] = [
  { label: 'Grass', color: [76, 153, 76, 255] },
  { label: 'Stone', color: [128, 128, 128, 255] },
  { label: 'Water', color: [64, 128, 200, 255] },
  { label: 'Dirt', color: [139, 90, 43, 255] },
  { label: 'Sand', color: [210, 190, 130, 255] },
  { label: 'Wood', color: [120, 80, 40, 255] },
  { label: 'Snow', color: [230, 235, 240, 255] },
  { label: 'Lava', color: [220, 60, 20, 255] },
  { label: 'Dark', color: [30, 30, 40, 255] },
  { label: 'Brick', color: [160, 70, 50, 255] },
];

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
    padding: '12px',
    background: '#16213e',
    borderRight: '1px solid #333',
    width: '200px',
    overflowY: 'auto' as const,
  },
  section: { marginBottom: '4px' },
  sectionTitle: { fontSize: '11px', color: '#888', textTransform: 'uppercase' as const, marginBottom: '6px', letterSpacing: '0.5px' },
  toolGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' },
  toolBtn: (active: boolean) => ({
    padding: '6px 8px',
    fontSize: '11px',
    border: active ? '1px solid #4a9eff' : '1px solid #444',
    background: active ? '#2a4a7a' : '#1a1a2e',
    color: '#e0e0e0',
    borderRadius: '4px',
    cursor: 'pointer',
  }),
  layerBtn: (active: boolean, color: string) => ({
    padding: '6px 8px',
    fontSize: '11px',
    border: active ? `2px solid ${color}` : '1px solid #444',
    background: active ? '#2a3a5a' : '#1a1a2e',
    color: '#e0e0e0',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  }),
  colorDot: (color: string) => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: color,
  }),
  presetGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' },
  presetBtn: (color: [number, number, number, number], active: boolean) => ({
    width: '28px',
    height: '28px',
    background: `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})`,
    border: active ? '2px solid #fff' : '1px solid #555',
    borderRadius: '4px',
    cursor: 'pointer',
  }),
  colorInput: {
    width: '100%',
    height: '32px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  slider: { width: '100%' },
  label: { fontSize: '11px', color: '#aaa', display: 'flex', justifyContent: 'space-between' },
};

export const ToolBar: React.FC = () => {
  const activeTool = useMapStore(s => s.activeTool);
  const activeLayer = useMapStore(s => s.activeLayer);
  const activeColor = useMapStore(s => s.activeColor);
  const heightBrushValue = useMapStore(s => s.heightBrushValue);
  const brushSize = useMapStore(s => s.brushSize);
  const showCollision = useMapStore(s => s.showCollision);
  const showHeight = useMapStore(s => s.showHeight);

  const setTool = useMapStore(s => s.setTool);
  const setActiveLayer = useMapStore(s => s.setActiveLayer);
  const setColor = useMapStore(s => s.setColor);
  const setHeightBrushValue = useMapStore(s => s.setHeightBrushValue);
  const setBrushSize = useMapStore(s => s.setBrushSize);
  const setShowCollision = useMapStore(s => s.setShowCollision);
  const setShowHeight = useMapStore(s => s.setShowHeight);

  const colorHex = `#${activeColor.slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('')}`;

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Tools</div>
        <div style={styles.toolGrid}>
          {TOOLS.map(t => (
            <button
              key={t.id}
              style={styles.toolBtn(activeTool === t.id)}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.shortcut})`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTool !== 'fill' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Brush Size</div>
          <div style={styles.label}>
            <span>Size</span>
            <span>{brushSize}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={32}
            step={1}
            value={brushSize}
            onChange={e => setBrushSize(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Layers</div>
        {LAYERS.map(l => (
          <button
            key={l.id}
            style={styles.layerBtn(activeLayer === l.id, l.color)}
            onClick={() => setActiveLayer(l.id)}
          >
            <span style={styles.colorDot(l.color)} />
            {l.label}
          </button>
        ))}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Color</div>
        <input
          type="color"
          value={colorHex}
          onChange={e => {
            const hex = e.target.value;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            setColor([r, g, b, 255]);
          }}
          style={styles.colorInput}
        />
        <div style={styles.sectionTitle}>Presets</div>
        <div style={styles.presetGrid}>
          {PRESETS.map(p => (
            <button
              key={p.label}
              style={styles.presetBtn(p.color, colorHex === `#${p.color.slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('')}`)}
              onClick={() => setColor(p.color)}
              title={p.label}
            />
          ))}
        </div>
      </div>

      {activeTool === 'height' && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Height Brush</div>
          <div style={styles.label}>
            <span>Value</span>
            <span>{heightBrushValue}</span>
          </div>
          <input
            type="range"
            min={0}
            max={256}
            step={1}
            value={heightBrushValue}
            onChange={e => setHeightBrushValue(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Overlay</div>
        <label style={{ fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={showCollision}
            onChange={e => setShowCollision(e.target.checked)}
          />
          Show Collision
        </label>
        <label style={{ fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={showHeight}
            onChange={e => setShowHeight(e.target.checked)}
          />
          Show Height
        </label>
      </div>
    </div>
  );
};
