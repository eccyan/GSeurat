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

const utilityTools: { id: ToolType; label: string; key: string }[] = [
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
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: 3,
  },
  colorSwatch: {
    width: 24,
    height: 24,
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
  separator: {
    height: 1,
    background: '#444',
    margin: '6px 0',
  },
};

function ToolGroup({ tools, activeTool, setTool, label }: {
  tools: { id: ToolType; label: string; key: string }[];
  activeTool: ToolType;
  setTool: (t: ToolType) => void;
  label: string;
}) {
  return (
    <>
      <span style={{ fontSize: 10, color: '#666', letterSpacing: 1, textTransform: 'uppercase' as const }}>{label}</span>
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
    </>
  );
}

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
  const addPalette = useSceneStore((s) => s.addPalette);
  const removePalette = useSceneStore((s) => s.removePalette);
  const setActivePalette = useSceneStore((s) => s.setActivePalette);
  const addColorToPalette = useSceneStore((s) => s.addColorToPalette);

  const [gridW, setGridW] = useState(32);
  const [gridH, setGridH] = useState(32);
  const [cellSize, setCellSize] = useState(1.0);
  const [newZoneName, setNewZoneName] = useState('');
  const [slopeThreshold, setSlopeThreshold] = useState(5.0);

  const hexColor = `#${activeColor.slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('')}`;

  // Active palette colors (preset if -1, or custom palette)
  const displayColors = activePaletteIndex < 0 ? presetColors : (colorPalettes[activePaletteIndex] ?? []);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
      {/* Tools — split into draw + utility */}
      <div style={styles.section}>
        <span style={styles.label}>Tools</span>
        <ToolGroup tools={drawTools} activeTool={activeTool} setTool={setTool} label="Draw" />
        <div style={styles.separator} />
        <ToolGroup tools={utilityTools} activeTool={activeTool} setTool={setTool} label="Utility" />
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
          {/* Add current color to active palette */}
          {activePaletteIndex >= 0 && (
            <button
              style={styles.btn}
              title="Add color to palette"
              onClick={() => addColorToPalette(activePaletteIndex, [...activeColor])}
            >
              +
            </button>
          )}
        </div>

        {/* Palette selector */}
        <div style={{ ...styles.row, marginTop: 4 }}>
          <select
            value={activePaletteIndex}
            onChange={(e) => setActivePalette(Number(e.target.value))}
            style={{ ...styles.inputFlex, fontSize: 12 }}
          >
            <option value={-1}>Default</option>
            {colorPalettes.map((_, i) => (
              <option key={i} value={i}>Palette {i + 1} ({colorPalettes[i].length})</option>
            ))}
          </select>
          <button style={styles.btn} onClick={addPalette} title="New Palette">New</button>
          {activePaletteIndex >= 0 && (
            <button style={styles.btn} onClick={() => removePalette(activePaletteIndex)} title="Delete Palette">Del</button>
          )}
        </div>

        <div style={styles.colorGrid}>
          {displayColors.map((c, i) => (
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

      {/* Collision section */}
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

              {/* Box Fill toggle */}
              <div style={styles.row}>
                <input
                  type="checkbox"
                  checked={collisionBoxFill}
                  onChange={(e) => setCollisionBoxFill(e.target.checked)}
                />
                <span style={{ fontSize: 12 }}>Box Fill</span>
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

              {/* Auto-generate from terrain */}
              <div style={styles.separator} />
              <div style={styles.row}>
                <span style={{ fontSize: 12, minWidth: 50 }}>Slope</span>
                <input
                  type="range"
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={slopeThreshold}
                  onChange={(e) => setSlopeThreshold(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 11, minWidth: 30 }}>{slopeThreshold}</span>
              </div>
              <button
                style={styles.btn}
                onClick={() => {
                  useSceneStore.getState().pushUndo();
                  autoGenerateCollision(slopeThreshold);
                }}
              >
                Auto-generate
              </button>
            </>
          )}
        </div>
    </div>
  );
}
