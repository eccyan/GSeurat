import React, { useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import type { ToolType, CollisionLayer } from '../store/types.js';

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

const collisionLayers: { id: CollisionLayer; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'nav_zone', label: 'NavZone' },
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
  inputFlex: {
    flex: 1,
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
  layerBtn: {
    flex: 1,
    padding: '4px 6px',
    border: '1px solid #444',
    borderRadius: 4,
    background: '#2a2a4a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 12,
    textAlign: 'center' as const,
  },
  layerBtnActive: {
    background: '#4a4a8a',
    borderColor: '#77f',
    color: '#fff',
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
  const showCollision = useSceneStore((s) => s.showCollision);
  const collisionGridData = useSceneStore((s) => s.collisionGridData);
  const collisionLayer = useSceneStore((s) => s.collisionLayer);
  const setCollisionLayer = useSceneStore((s) => s.setCollisionLayer);
  const collisionHeight = useSceneStore((s) => s.collisionHeight);
  const setCollisionHeight = useSceneStore((s) => s.setCollisionHeight);
  const activeNavZone = useSceneStore((s) => s.activeNavZone);
  const setActiveNavZone = useSceneStore((s) => s.setActiveNavZone);
  const navZoneNames = useSceneStore((s) => s.navZoneNames);
  const addNavZoneName = useSceneStore((s) => s.addNavZoneName);
  const initCollisionGrid = useSceneStore((s) => s.initCollisionGrid);

  const [gridW, setGridW] = useState(32);
  const [gridH, setGridH] = useState(32);
  const [cellSize, setCellSize] = useState(1.0);
  const [newZoneName, setNewZoneName] = useState('');

  const hexColor = `#${activeColor.slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('')}`;

  return (
    <div>
      {/* Tools */}
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
            <input
              type="number"
              value={yLevelLock}
              onChange={(e) => setYLevelLock(Number(e.target.value))}
              style={styles.input}
            />
          )}
        </div>
      </div>

      {/* Collision section — only shown when collision overlay is active */}
      {showCollision && (
        <div style={styles.section}>
          <span style={styles.label}>Collision</span>
          {!collisionGridData ? (
            <>
              <div style={styles.row}>
                <span style={{ fontSize: 12, minWidth: 40 }}>W</span>
                <input
                  type="number"
                  value={gridW}
                  min={1}
                  onChange={(e) => setGridW(Math.max(1, Number(e.target.value)))}
                  style={{ ...styles.inputFlex, maxWidth: 60 }}
                />
                <span style={{ fontSize: 12, minWidth: 20 }}>H</span>
                <input
                  type="number"
                  value={gridH}
                  min={1}
                  onChange={(e) => setGridH(Math.max(1, Number(e.target.value)))}
                  style={{ ...styles.inputFlex, maxWidth: 60 }}
                />
              </div>
              <div style={styles.row}>
                <span style={{ fontSize: 12, minWidth: 40 }}>Cell</span>
                <input
                  type="number"
                  value={cellSize}
                  step={0.1}
                  min={0.1}
                  onChange={(e) => setCellSize(Math.max(0.1, Number(e.target.value)))}
                  style={{ ...styles.inputFlex, maxWidth: 60 }}
                />
              </div>
              <button style={styles.btn} onClick={() => initCollisionGrid(gridW, gridH, cellSize)}>
                Init Grid
              </button>
            </>
          ) : (
            <>
              <div style={styles.row}>
                {collisionLayers.map((cl) => (
                  <button
                    key={cl.id}
                    style={{
                      ...styles.layerBtn,
                      ...(collisionLayer === cl.id ? styles.layerBtnActive : {}),
                    }}
                    onClick={() => setCollisionLayer(cl.id)}
                  >
                    {cl.label}
                  </button>
                ))}
              </div>

              {collisionLayer === 'elevation' && (
                <div style={styles.row}>
                  <span style={{ fontSize: 12, minWidth: 50 }}>Height</span>
                  <input
                    type="number"
                    step={0.5}
                    value={collisionHeight}
                    onChange={(e) => setCollisionHeight(Number(e.target.value))}
                    style={styles.inputFlex}
                  />
                </div>
              )}

              {collisionLayer === 'nav_zone' && (
                <>
                  <div style={styles.row}>
                    <span style={{ fontSize: 12, minWidth: 50 }}>Zone</span>
                    <select
                      value={activeNavZone}
                      onChange={(e) => setActiveNavZone(Number(e.target.value))}
                      style={styles.inputFlex}
                    >
                      <option value={0}>0: default</option>
                      {navZoneNames.map((name, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}: {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={styles.row}>
                    <input
                      type="text"
                      value={newZoneName}
                      placeholder="new zone name"
                      onChange={(e) => setNewZoneName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newZoneName.trim()) {
                          addNavZoneName(newZoneName.trim());
                          setNewZoneName('');
                        }
                      }}
                      style={styles.inputFlex}
                    />
                    <button
                      style={styles.btn}
                      onClick={() => {
                        if (newZoneName.trim()) {
                          addNavZoneName(newZoneName.trim());
                          setNewZoneName('');
                        }
                      }}
                    >
                      +
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
