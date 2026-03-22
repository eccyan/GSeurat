import React, { useEffect } from 'react';
import { CharacterViewport } from './viewport/CharacterViewport.js';
import { MenuBar } from './panels/MenuBar.js';
import { ToolBar } from './panels/ToolBar.js';
import { BuildPanel } from './panels/BuildPanel.js';
import { AnimateLeftPanel } from './panels/AnimateLeftPanel.js';
import { AnimateRightPanel } from './panels/AnimateRightPanel.js';
import { Timeline } from './panels/Timeline.js';
import { useCharacterStore } from './store/useCharacterStore.js';
import type { ToolType } from './store/types.js';

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
    width: 320,
    background: '#1e1e3a',
    borderLeft: '1px solid #333',
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
};

const animateToolKeys: Record<string, ToolType> = {
  a: 'assign_part',
  s: 'box_select',
};

export function App() {
  const mode = useCharacterStore((s) => s.mode);

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

      // Space toggles playback in animate mode
      if (e.key === ' ' && store.mode === 'animate') {
        e.preventDefault();
        store.togglePlayback();
        return;
      }

      // Escape clears box selection
      if (e.key === 'Escape') {
        store.setBoxSelection(null);
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

  return (
    <div style={styles.root}>
      <MenuBar />
      <div style={styles.body}>
        {mode === 'build' ? <BuildModeLayout /> : <AnimateModeLayout />}
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
    border: 'none',
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
    borderBottom: '2px solid #77f',
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

function BuildModeLayout() {
  return (
    <>
      <ToolBar />
      <div style={styles.viewport}>
        <CharacterViewport />
      </div>
      <div style={styles.inspector}>
        <ModeTabs />
        <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
          <BuildPanel />
        </div>
      </div>
    </>
  );
}

function AnimateModeLayout() {
  return (
    <>
      <AnimateLeftPanel />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }}>
        <div style={styles.viewport}>
          <CharacterViewport />
        </div>
        <Timeline />
      </div>
      <div style={styles.inspector}>
        <ModeTabs />
        <AnimateRightPanel />
      </div>
    </>
  );
}
