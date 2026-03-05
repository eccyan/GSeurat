import React, { useEffect, useState } from 'react';
import { MenuBar } from './components/MenuBar.js';
import { TilePalettePanel } from './components/TilePalettePanel.js';
import { TileCanvas } from './components/TileCanvas.js';
import { PropertiesPanel } from './components/PropertiesPanel.js';
import { AIPanel } from './components/AIPanel.js';
import { useEngine } from './hooks/useEngine.js';
import { useEditorStore } from './store/useEditorStore.js';

export function App() {
  const engine = useEngine();
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const [showAI, setShowAI] = useState(false);

  useEffect(() => {
    engine.connect();
    return () => engine.disconnect();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useEditorStore.getState();
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          store.undo();
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          store.redo();
        }
      }
      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key) {
          case 'b': store.setActiveTool('paint'); break;
          case 'e': store.setActiveTool('erase'); break;
          case 'g': store.setActiveTool('fill'); break;
          case 'v': store.setActiveTool('select'); break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={styles.container}>
      <MenuBar onToggleAI={() => setShowAI(!showAI)} />
      <div style={styles.body}>
        <TilePalettePanel />
        <div style={styles.canvasArea}>
          <TileCanvas onPaintTile={(col, row, tileId, solid) => {
            useEditorStore.getState().setTile(col, row, tileId, solid);
            engine.setTile(col, row, tileId, solid);
          }} />
        </div>
        <div style={styles.rightPanel}>
          <PropertiesPanel />
          {showAI && <AIPanel />}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  canvasArea: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    background: '#111122',
  },
  rightPanel: {
    width: 280,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
};
