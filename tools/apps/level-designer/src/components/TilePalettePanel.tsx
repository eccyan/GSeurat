import React from 'react';
import { useEditorStore } from '../store/useEditorStore.js';

// ---------------------------------------------------------------------------
// Tile definitions
// ---------------------------------------------------------------------------
interface TileInfo {
  id: number;
  name: string;
  color: string;
  defaultSolid: boolean;
}

const TILES: TileInfo[] = [
  { id: 0,      name: 'Floor',        color: '#C8B991', defaultSolid: false },
  { id: 1,      name: 'Wall',         color: '#463C37', defaultSolid: true  },
  { id: 2,      name: 'Water 1',      color: '#285AB4', defaultSolid: false },
  { id: 3,      name: 'Water 2',      color: '#376EC8', defaultSolid: false },
  { id: 4,      name: 'Water 3',      color: '#4682D2', defaultSolid: false },
  { id: 5,      name: 'Lava Red',     color: '#C83C14', defaultSolid: true  },
  { id: 6,      name: 'Lava Orange',  color: '#F06414', defaultSolid: true  },
  { id: 7,      name: 'Lava Yellow',  color: '#FFA028', defaultSolid: false },
  { id: 8,      name: 'Torch Dark',   color: '#3C322D', defaultSolid: true  },
  { id: 9,      name: 'Torch Glow',   color: '#504128', defaultSolid: false },
  { id: 0xFFFF, name: 'Transparent',  color: 'transparent', defaultSolid: false },
];

type Tool = 'paint' | 'erase' | 'fill' | 'select';

interface ToolButtonProps {
  label: string;
  icon: string;
  tool: Tool;
  active: boolean;
  onClick: () => void;
}

function ToolButton({ label, icon, active, onClick }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        width: 48,
        height: 44,
        background: active ? '#3a4a6a' : '#2a2a2a',
        border: active ? '1px solid #5878b8' : '1px solid #444',
        borderRadius: 4,
        color: active ? '#90b8ff' : '#aaa',
        cursor: 'pointer',
        fontFamily: 'monospace',
        fontSize: 10,
        transition: 'all 0.12s',
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// TilePalettePanel
// ---------------------------------------------------------------------------
export function TilePalettePanel() {
  const {
    selectedTileId,
    setSelectedTileId,
    selectedSolid,
    setSelectedSolid,
    activeTool,
    setActiveTool,
  } = useEditorStore();

  const selectedTile = TILES.find((t) => t.id === selectedTileId) ?? TILES[0];

  const toolDefs: { tool: Tool; icon: string; label: string }[] = [
    { tool: 'paint',  icon: '✏️',  label: 'Paint'  },
    { tool: 'erase',  icon: '🧹',  label: 'Erase'  },
    { tool: 'fill',   icon: '🪣',  label: 'Fill'   },
    { tool: 'select', icon: '↖️',  label: 'Select' },
  ];

  return (
    <div style={{
      width: 160,
      background: '#222',
      borderRight: '1px solid #333',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      userSelect: 'none',
    }}>
      {/* Section: Tools */}
      <div style={{
        padding: '8px 8px 4px',
        color: '#777',
        fontFamily: 'monospace',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        borderBottom: '1px solid #2e2e2e',
      }}>
        Tools
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        padding: '8px',
      }}>
        {toolDefs.map(({ tool, icon, label }) => (
          <ToolButton
            key={tool}
            tool={tool}
            icon={icon}
            label={label}
            active={activeTool === tool}
            onClick={() => setActiveTool(tool)}
          />
        ))}
      </div>

      {/* Section: Tile Palette */}
      <div style={{
        padding: '8px 8px 4px',
        color: '#777',
        fontFamily: 'monospace',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        borderTop: '1px solid #2e2e2e',
        borderBottom: '1px solid #2e2e2e',
      }}>
        Tiles
      </div>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {TILES.map((tile) => {
          const isSelected = selectedTileId === tile.id;
          return (
            <button
              key={tile.id}
              onClick={() => {
                setSelectedTileId(tile.id);
                setSelectedSolid(tile.defaultSolid);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 6px',
                background: isSelected ? '#2d3d5a' : 'transparent',
                border: isSelected ? '1px solid #5878b8' : '1px solid transparent',
                borderRadius: 4,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              {/* Color swatch */}
              <div style={{
                width: 22,
                height: 22,
                flexShrink: 0,
                borderRadius: 3,
                border: '1px solid rgba(255,255,255,0.15)',
                background: tile.id === 0xFFFF
                  ? 'repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 10px 10px'
                  : tile.color,
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: isSelected ? '#d0e0ff' : '#ccc',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {tile.name}
                </span>
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 9,
                  color: '#666',
                }}>
                  {tile.id === 0xFFFF ? '0xFFFF' : `#${tile.id}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Section: Selected tile properties */}
      <div style={{
        borderTop: '1px solid #2e2e2e',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <div style={{
          color: '#777',
          fontFamily: 'monospace',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 2,
        }}>
          Selected: {selectedTile.name}
        </div>

        {/* Solid toggle */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#bbb',
        }}>
          <input
            type="checkbox"
            checked={selectedSolid}
            onChange={(e) => setSelectedSolid(e.target.checked)}
            style={{ accentColor: '#5878b8', cursor: 'pointer' }}
          />
          Solid (collision)
        </label>

        {/* Keyboard hint */}
        <div style={{
          marginTop: 4,
          padding: '4px 6px',
          background: '#1a1a1a',
          borderRadius: 3,
          fontFamily: 'monospace',
          fontSize: 9,
          color: '#555',
          lineHeight: 1.6,
        }}>
          Scroll: zoom<br />
          Alt+drag: pan<br />
          Mid-drag: pan
        </div>
      </div>
    </div>
  );
}
