import React, { useCallback, useEffect, useState } from 'react';
import { Viewport } from './viewport/Viewport.js';
import { MenuBar } from './panels/MenuBar.js';
import { ToolBar } from './panels/ToolBar.js';
import { Inspector } from './panels/Inspector.js';
import { ImportDialog } from './panels/ImportDialog.js';
import { useSceneStore } from './store/useSceneStore.js';
import type { ToolType } from './store/types.js';

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  body: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  viewport: {
    flex: 1,
    position: 'relative',
  },
};

const toolKeys: Record<string, ToolType> = {
  v: 'place',
  b: 'paint',
  e: 'erase',
  g: 'fill',
  x: 'extrude',
  i: 'eyedropper',
  s: 'select',
};

export function App() {
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      const store = useSceneStore.getState();
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }
      if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        store.redo();
        return;
      }

      const tool = toolKeys[e.key.toLowerCase()];
      if (tool) {
        store.setTool(tool);
        return;
      }

      if (e.key === '[') {
        store.setBrushSize(store.brushSize - 1);
      } else if (e.key === ']') {
        store.setBrushSize(store.brushSize + 1);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div style={styles.root}>
      <MenuBar onImport={() => setShowImport(true)} />
      <div style={styles.body}>
        <ToolBar />
        <div style={styles.viewport}>
          <Viewport />
        </div>
        <Inspector />
      </div>
      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
    </div>
  );
}
