import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '../store/useEditorStore.js';

type Layer = 'tiles' | 'lights' | 'npcs' | 'portals' | 'backgrounds' | 'environment';

// ---------------------------------------------------------------------------
// Dropdown menu
// ---------------------------------------------------------------------------
interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

interface DropdownMenuProps {
  items: MenuItem[];
  onClose: () => void;
}

function DropdownMenu({ items, onClose }: DropdownMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        minWidth: 180,
        background: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: 4,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return (
            <div
              key={i}
              style={{
                height: 1,
                background: '#3a3a3a',
                margin: '3px 0',
              }}
            />
          );
        }
        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled && item.onClick) {
                item.onClick();
              }
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '6px 12px',
              background: 'transparent',
              border: 'none',
              color: item.disabled ? '#555' : '#ccc',
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: item.disabled ? 'default' : 'pointer',
              textAlign: 'left',
              gap: 20,
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                (e.currentTarget as HTMLButtonElement).style.background = '#3a4a6a';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ color: '#666', fontSize: 10 }}>{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MenuButton
// ---------------------------------------------------------------------------
function MenuButton({
  label,
  items,
}: {
  label: string;
  items: MenuItem[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: open ? '#3a3a3a' : 'transparent',
          border: 'none',
          color: '#ccc',
          fontFamily: 'monospace',
          fontSize: 12,
          padding: '0 10px',
          height: '100%',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!open) (e.currentTarget as HTMLButtonElement).style.background = '#2e2e2e';
        }}
        onMouseLeave={(e) => {
          if (!open) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {label}
      </button>
      {open && (
        <DropdownMenu
          items={items}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer tab
// ---------------------------------------------------------------------------
const LAYER_TABS: { id: Layer; label: string; icon: string }[] = [
  { id: 'tiles',       label: 'Tiles',   icon: '▦' },
  { id: 'lights',      label: 'Lights',  icon: '◉' },
  { id: 'npcs',        label: 'NPCs',    icon: '⚑' },
  { id: 'portals',     label: 'Portals', icon: '⬡' },
  { id: 'backgrounds', label: 'BG',      icon: '⛰' },
  { id: 'environment', label: 'Weather', icon: '☁' },
];

// ---------------------------------------------------------------------------
// MenuBar
// ---------------------------------------------------------------------------
export function MenuBar() {
  const {
    connected,
    dirty,
    currentScenePath,
    undo, redo,
    undoStack, redoStack,
    activeLayer, setActiveLayer,
    setDirty,
  } = useEditorStore();

  // ---------------------------------------------------------------------------
  // File operations (save/load via IPC bridge)
  // ---------------------------------------------------------------------------
  const handleNew = useCallback(() => {
    // Reset the store to a clean 16×16 map
    const { setTiles, setCurrentScenePath, setDirty } = useEditorStore.getState();
    setTiles(
      Array.from({ length: 16 * 16 }, () => ({ id: 0, solid: false })),
      16,
      16,
    );
    setCurrentScenePath('assets/scenes/untitled.json');
    setDirty(false);
  }, []);

  const handleSave = useCallback(async () => {
    const state = useEditorStore.getState();
    const sceneJson = buildSceneJson(state);
    const blob = new Blob([JSON.stringify(sceneJson, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.currentScenePath.split('/').pop() ?? 'scene.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setDirty(false);
  }, [setDirty]);

  const handleOpen = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        applySceneJson(json, file.name);
      } catch (e) {
        console.error('Failed to open scene:', e);
        alert(`Failed to parse scene file: ${e}`);
      }
    };
    input.click();
  }, []);

  return (
    <div style={{
      height: 60,
      background: '#1e1e1e',
      borderBottom: '1px solid #333',
      display: 'flex',
      alignItems: 'stretch',
      userSelect: 'none',
      flexShrink: 0,
    }}>
      {/* App title */}
      <div style={{
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#7a9fd0',
        fontWeight: 600,
        borderRight: '1px solid #2a2a2a',
        whiteSpace: 'nowrap',
      }}>
        Level Designer
      </div>

      {/* File / Edit menus */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderRight: '1px solid #2a2a2a' }}>
        <MenuButton
          label="File"
          items={[
            { label: 'New', shortcut: 'Ctrl+N', onClick: handleNew },
            { label: 'Open…', shortcut: 'Ctrl+O', onClick: handleOpen },
            { separator: true },
            { label: 'Save', shortcut: 'Ctrl+S', onClick: handleSave },
            { label: 'Save As…', shortcut: 'Ctrl+Shift+S', onClick: handleSave },
          ]}
        />
        <MenuButton
          label="Edit"
          items={[
            {
              label: 'Undo',
              shortcut: 'Ctrl+Z',
              disabled: undoStack.length === 0,
              onClick: undo,
            },
            {
              label: 'Redo',
              shortcut: 'Ctrl+Y',
              disabled: redoStack.length === 0,
              onClick: redo,
            },
          ]}
        />
      </div>

      {/* Scene path */}
      <div style={{
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#666',
        borderRight: '1px solid #2a2a2a',
        maxWidth: 240,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {dirty && (
          <span style={{ color: '#e8a040', marginRight: 4 }} title="Unsaved changes">●</span>
        )}
        <span title={currentScenePath}>
          {currentScenePath.split('/').pop()}
        </span>
      </div>

      {/* Layer tabs */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        flex: 1,
        padding: '0 8px',
        gap: 2,
      }}>
        {LAYER_TABS.map(({ id, label, icon }) => {
          const active = activeLayer === id;
          return (
            <button
              key={id}
              onClick={() => setActiveLayer(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 12px',
                background: active ? '#2a3a5a' : 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid #5878c8' : '2px solid transparent',
                color: active ? '#90b0f0' : '#888',
                fontFamily: 'monospace',
                fontSize: 11,
                cursor: 'pointer',
                transition: 'all 0.1s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#bbb';
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#888';
              }}
            >
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Right side: connection status + save */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        borderLeft: '1px solid #2a2a2a',
        flexShrink: 0,
      }}>
        {/* Connection status dot */}
        <div
          title={connected ? 'Connected to game engine' : 'Engine not connected'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'monospace',
            fontSize: 10,
            color: connected ? '#60c060' : '#885050',
          }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: connected ? '#50e050' : '#c05050',
            boxShadow: connected ? '0 0 6px #50e050' : 'none',
          }} />
          {connected ? 'Live' : 'Offline'}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          style={{
            padding: '5px 14px',
            background: dirty ? '#2a4a8a' : '#2a2a2a',
            border: dirty ? '1px solid #4a7ad0' : '1px solid #444',
            borderRadius: 4,
            color: dirty ? '#90b8f8' : '#888',
            fontFamily: 'monospace',
            fontSize: 11,
            cursor: 'pointer',
            transition: 'all 0.1s',
          }}
        >
          {dirty ? 'Save *' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene JSON serialization helpers
// ---------------------------------------------------------------------------
function buildSceneJson(state: ReturnType<typeof useEditorStore.getState>) {
  const { width, height, tileSize, tiles, npcs, lights, portals, ambientColor } = state;

  const tileIds = tiles.map((t) => t.id);
  const solidTiles = tiles
    .map((t, i) => (t.solid ? i : -1))
    .filter((i) => i >= 0);

  return {
    tilemap: {
      width,
      height,
      tile_size: tileSize,
      tileset: {
        tile_width: 16,
        tile_height: 16,
        columns: 8,
        texture: 'assets/textures/tileset.png',
      },
      tiles: tileIds,
      solid_tiles: solidTiles,
    },
    ambient_color: ambientColor,
    lights: lights.map((l) => ({
      position: [l.position[0], 0, l.position[1]],
      radius: l.radius,
      color: l.color,
      intensity: l.intensity,
      height: l.height,
    })),
    npcs: npcs.map((n) => ({
      name: n.name,
      position: n.position,
      tint: n.tint,
      facing: n.facing,
      patrol_speed: n.patrol_speed,
      patrol_interval: n.patrol_interval,
      dialog: n.dialog,
      light_color: n.light_color,
      light_radius: n.light_radius,
      waypoints: n.waypoints,
    })),
    portals: portals.map((p) => ({
      position: [p.position[0], 0, p.position[1]],
      size: p.size,
      target_scene: p.target_scene,
      spawn_position: p.spawn_position,
      spawn_facing: p.spawn_facing,
    })),
  };
}

function applySceneJson(json: Record<string, unknown>, filename: string) {
  const { setTiles, setAmbientColor, setCurrentScenePath, setDirty } = useEditorStore.getState();

  try {
    const tm = json.tilemap as Record<string, unknown> | undefined;
    if (tm) {
      const w = (tm.width as number) ?? 16;
      const h = (tm.height as number) ?? 16;
      const tileIds = (tm.tiles as number[]) ?? [];
      const solidSet = new Set<number>((tm.solid_tiles as number[]) ?? []);
      const tileData = tileIds.map((id, i) => ({ id, solid: solidSet.has(i) }));
      setTiles(tileData, w, h);
    }

    const ambient = json.ambient_color as [number, number, number, number] | undefined;
    if (ambient) {
      setAmbientColor(ambient);
    }

    setCurrentScenePath(`assets/scenes/${filename}`);
    setDirty(false);
  } catch (e) {
    console.error('Failed to apply scene JSON:', e);
  }
}
