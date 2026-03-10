import React, { useEffect } from 'react';
import { useSeuratStore } from './store/useSeuratStore.js';
import { usePlaybackEngine } from './hooks/usePlaybackEngine.js';
import { useRemoteControl } from './hooks/useRemoteControl.js';
import { TreePane } from './components/layout/TreePane.js';
import { Toolbar } from './components/layout/Toolbar.js';
import { StatusBar } from './components/layout/StatusBar.js';
import { MainPane } from './components/layout/MainPane.js';
import { RightPane } from './components/layout/RightPane.js';
import { BottomPane } from './components/layout/BottomPane.js';

export function App() {
  usePlaybackEngine();
  useRemoteControl('ws://localhost:9100');

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      // Space = play/pause in animation mode
      if (e.code === 'Space') {
        const store = useSeuratStore.getState();
        if (store.treeSelection.kind === 'animation') {
          e.preventDefault();
          if (store.playbackState === 'playing') {
            store.setPlaybackState('paused');
          } else {
            store.setPlaybackState('playing');
          }
        }
      }

      // Escape = stop playback
      if (e.code === 'Escape') {
        const store = useSeuratStore.getState();
        store.setPlaybackState('stopped');
        store.setCurrentTime(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={styles.root}>
      <Toolbar />
      <div style={styles.body}>
        <TreePane />
        <div style={styles.center}>
          <div style={styles.main}>
            <MainPane />
          </div>
          <BottomPane />
        </div>
        <RightPane />
      </div>
      <StatusBar />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '100vw',
    height: '100vh',
    background: '#0e0e1a',
    overflow: 'hidden',
  },
  body: {
    display: 'flex',
    flex: '1 1 0',
    minHeight: 0,
    overflow: 'hidden',
  },
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
};
