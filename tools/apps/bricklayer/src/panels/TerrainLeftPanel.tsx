import React, { useState } from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { ToolType, CollisionLayer } from '../store/types.js';

const drawTools: { id: ToolType; label: string; key: string }[] = [
  { id: 'place', label: 'Place', key: 'V' },
  { id: 'paint', label: 'Paint', key: 'B' },
  { id: 'erase', label: 'Erase', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'extrude', label: 'Extrude', key: 'X' },
];

const utilTools: { id: ToolType; label: string; key: string }[] = [
  { id: 'eyedropper', label: 'Eyedrop', key: 'I' },
  { id: 'select', label: 'Select', key: 'S' },
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
    padding: '5px 8px',
    border: '1px solid #444',
    borderRadius: 4,
    background: '#2a2a4a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 12,
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
    gridTemplateColumns: 'repeat(8, 1fr)',
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
  select: {
    flex: 1,
    padding: '4px 6px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontSize: 12,
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
  const collisionBoxFill = useSceneStore((s) => s.collisionBoxFill);
  const setCollisionBoxFill = useSceneStore((s) => s.setCollisionBoxFill);
  const autoGenerateCollision = useSceneStore((s) => s.autoGenerateCollision);
  const colorPalettes = useSceneStore((s) => s.colorPalettes);
  const activePaletteIndex = useSceneStore((s) => s.activePaletteIndex);
  const setActivePalette = useSceneStore((s) => s.setActivePalette);
  const addPalette = useSceneStore((s) => s.addPalette);
  const addColorToPalette = useSceneStore((s) => s.addColorToPalette);

  const [gridW, setGridW] = useState(32);
  const [gridH, setGridH] = useState(32);
  const [cellSize, setCellSize] = useState(1.0);
  const [newZoneName, setNewZoneName] = useState('');
  const [slopeThreshold, setSlopeThreshold] = useState(2.0);

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
            {t.label}
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

      {/* Collision section — always visible in TERRAIN mode */}
      <div style={styles.section}>
        <span style={styles.label}>Collision Grid</span>
        {!showCollision && (
          <button
            style={{ ...styles.btn, marginBottom: 8 }}
            onClick={() => useSceneStore.getState().setShowCollision(true)}
          >
            Show Overlay
          </button>
        )}
        {!collisionGridData ? (
            <>
              <div style={styles.row}>
                <NumberInput
                  label="W"
                  value={gridW}
                  min={1}
                  onChange={(v) => setGridW(v)}
                  style={{ ...styles.inputFlex, maxWidth: 60 }}
                />
                <NumberInput
                  label="H"
                  value={gridH}
                  min={1}
                  onChange={(v) => setGridH(v)}
                  style={{ ...styles.inputFlex, maxWidth: 60 }}
                />
              </div>
              <div style={styles.row}>
                <NumberInput
                  label="Cell"
                  value={cellSize}
                  step={0.1}
                  min={0.1}
                  onChange={(v) => setCellSize(v)}
                  style={{ ...styles.inputFlex, maxWidth: 60 }}
                />
              </div>
              <button style={styles.btn} onClick={() => initCollisionGrid(gridW, gridH, cellSize)}>
                Init Grid
              </button>
            </>
          ) : (
            <>
              {/* Layer selector */}
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

              {/* Box fill toggle */}
              <label style={{ ...styles.row, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={collisionBoxFill}
                  onChange={(e) => setCollisionBoxFill(e.target.checked)}
                />
                Box Fill
              </label>

              {/* Auto-generate */}
              <div style={styles.row}>
                <NumberInput
                  label="Slope"
                  step={0.5}
                  min={0}
                  value={slopeThreshold}
                  onChange={(v) => setSlopeThreshold(v)}
                  style={{ ...styles.inputFlex, maxWidth: 60 }}
                />
                <button style={styles.btn} onClick={() => {
                  useSceneStore.getState().pushUndo();
                  autoGenerateCollision(slopeThreshold);
                }}>
                  Auto
                </button>
              </div>

              {collisionLayer === 'elevation' && (
                <div style={styles.row}>
                  <span style={{ fontSize: 12, minWidth: 50 }}>Height</span>
                  <NumberInput
                    step={0.5}
                    value={collisionHeight}
                    onChange={setCollisionHeight}
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
    </div>
  );
}
