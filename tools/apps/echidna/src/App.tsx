import React, { useEffect, useState, useCallback, useRef } from 'react';
import { CharacterViewport } from './viewport/CharacterViewport.js';
import { MenuBar } from './panels/MenuBar.js';
import { ToolBar } from './panels/ToolBar.js';
import { BuildPanel } from './panels/BuildPanel.js';
import { AnimateLeftPanel } from './panels/AnimateLeftPanel.js';
import { AnimateRightPanel } from './panels/AnimateRightPanel.js';
import { Timeline } from './panels/Timeline.js';
import { useCharacterStore } from './store/useCharacterStore.js';
import type { ToolType } from './store/types.js';
import { restoreProjectRoot } from '@gseurat/project-root';

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#1a1a2e',
    color: '#ddd',
  },
  body: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  viewport: {
    flex: 1,
    position: 'relative',
  },
  inspector: {
    flexShrink: 0,
    background: '#1e1e3a',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  inspectorSection: {
    borderBottom: '1px solid #333',
  },
};

const buildToolKeys: Record<string, ToolType> = {
  v: 'place',
  b: 'paint',
  e: 'erase',
  i: 'eyedropper',
  g: 'fill',
  x: 'extrude',
  l: 'lasso_select',
  s: 'box_select',
};

const animateToolKeys: Record<string, ToolType> = {
  a: 'assign_part',
  s: 'box_select',
};

const RESIZE_HANDLE_STYLE: React.CSSProperties = {
  width: 5,
  cursor: 'col-resize',
  background: 'transparent',
  flexShrink: 0,
  zIndex: 10,
};

function ResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      onDrag(ev.clientX - startX);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }, [onDrag]);

  return (
    <div
      style={RESIZE_HANDLE_STYLE}
      onPointerDown={handlePointerDown}
      onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = '#555'; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    />
  );
}

export function App() {
  const mode = useCharacterStore((s) => s.mode);
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(320);
  const leftRef = useRef(leftWidth);
  const rightRef = useRef(rightWidth);

  // Keep refs in sync for drag callbacks
  leftRef.current = leftWidth;
  rightRef.current = rightWidth;

  // Bootstrap: restore project root handle from IDB on startup
  useEffect(() => {
    (async () => {
      try {
        const handle = await restoreProjectRoot('echidna');
        if (handle && !useCharacterStore.getState().projectRootHandle) {
          useCharacterStore.getState().setProjectRootHandle(handle);
          console.info(`[echidna] Restored project root: ${handle.name}`);
        }
      } catch (e) {
        // Silently ignore — user can pick the root again via File → Set Project Root…
        console.info('[echidna] No project root to restore');
      }
    })();
  }, []);

  const handleLeftDrag = useCallback((delta: number) => {
    setLeftWidth(Math.max(150, Math.min(400, leftRef.current + delta)));
  }, []);

  const handleRightDrag = useCallback((delta: number) => {
    setRightWidth(Math.max(200, Math.min(500, rightRef.current - delta)));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      const store = useCharacterStore.getState();
      const meta = e.metaKey || e.ctrlKey;

      // File shortcuts
      if (meta && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        if (confirm('Create new character? Unsaved changes will be lost.')) {
          store.newCharacter();
        }
        return;
      }
      if (meta && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        // Trigger save via store
        const data = store.saveProject();
        const json = JSON.stringify(data, null, 2);
        const name = store.currentFilename ?? `${data.characterName.replace(/\s+/g, '_').toLowerCase() || 'character'}.echidna`;
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
        if (!store.currentFilename) store.setCurrentFilename(name);
        return;
      }
      if (meta && e.key === 'o') {
        e.preventDefault();
        // Load would need a file input; keyboard shortcut is handled by MenuBar
        return;
      }

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
      if (meta && e.key === 'c') {
        if (store.boxSelection || store.lassoSelection) {
          e.preventDefault();
          store.copySelection();
        }
        return;
      }

      // Space toggles playback in animate mode
      if (e.key === ' ' && store.mode === 'animate') {
        e.preventDefault();
        store.togglePlayback();
        return;
      }

      // T toggles x-ray mode
      if (e.key === 't' || e.key === 'T') {
        store.setXrayMode(!store.xrayMode);
        return;
      }

      // Escape clears box/lasso selection
      if (e.key === 'Escape') {
        store.setBoxSelection(null);
        store.setLassoSelection(null);
        return;
      }

      // Delete/Backspace deletes selection
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (store.boxSelection || store.lassoSelection) {
          store.pushUndo();
          store.deleteSelection();
        }
        return;
      }

      const toolMap = store.mode === 'build' ? buildToolKeys : { ...buildToolKeys, ...animateToolKeys };
      const tool = toolMap[e.key.toLowerCase()];
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

  // URL param loading and postMessage API are handled inside CharacterViewport's
  // ExternalLoadBridge component (within R3F Canvas) to ensure proper re-rendering.

  return (
    <div style={styles.root}>
      <MenuBar />
      <div style={styles.body}>
        {/* Left panel */}
        <div style={{ width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', background: '#1e1e3a', borderRight: '1px solid #333' }}>
          <ModeTabs />
          {mode === 'build' ? <ToolBar /> : <AnimateLeftPanel />}
        </div>
        <ResizeHandle onDrag={handleLeftDrag} />

        {/* Center panel */}
        <div style={{ flex: 1, position: 'relative' as const, overflow: 'hidden' }}>
          <CharacterViewport />
          {mode === 'animate' && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 }}>
              <Timeline />
            </div>
          )}
        </div>
        <ResizeHandle onDrag={handleRightDrag} />

        {/* Right panel */}
        <div style={{ ...styles.inspector, width: rightWidth }}>
          {mode === 'build' ? <BuildPanel /> : <AnimateRightPanel />}
        </div>
      </div>
    </div>
  );
}

const modeTabStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    borderBottom: '1px solid #333',
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: '8px 0',
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid' as const,
    borderBottomColor: 'transparent',
    background: 'transparent',
    color: '#888',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'center',
    letterSpacing: 1,
  },
  tabActive: {
    color: '#fff',
    background: '#2a2a4a',
    borderBottomColor: '#77f',
  },
};

function ModeTabs() {
  const mode = useCharacterStore((s) => s.mode);
  const setMode = useCharacterStore((s) => s.setMode);

  return (
    <div style={modeTabStyles.container}>
      <button
        style={{ ...modeTabStyles.tab, ...(mode === 'build' ? modeTabStyles.tabActive : {}) }}
        onClick={() => setMode('build')}
      >
        BUILD
      </button>
      <button
        style={{ ...modeTabStyles.tab, ...(mode === 'animate' ? modeTabStyles.tabActive : {}) }}
        onClick={() => setMode('animate')}
      >
        ANIMATE
      </button>
    </div>
  );
}

