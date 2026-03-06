import React, { useEffect } from 'react';
import { useSeuratStore } from './store/useSeuratStore.js';
import { usePlaybackEngine } from './hooks/usePlaybackEngine.js';
import { useRemoteControl } from './hooks/useRemoteControl.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { Toolbar } from './components/layout/Toolbar.js';
import { StatusBar } from './components/layout/StatusBar.js';
import { DashboardView } from './components/dashboard/DashboardView.js';
import { ConceptView } from './components/concept/ConceptView.js';
import { GenerateView } from './components/generate/GenerateView.js';
import { ReviewView } from './components/review/ReviewView.js';
import { AnimateView } from './components/animate/AnimateView.js';
import { AtlasView } from './components/atlas/AtlasView.js';
import { ManifestView } from './components/manifest/ManifestView.js';

function SectionContent() {
  const section = useSeuratStore((s) => s.activeSection);
  switch (section) {
    case 'dashboard': return <DashboardView />;
    case 'concept': return <ConceptView />;
    case 'generate': return <GenerateView />;
    case 'review': return <ReviewView />;
    case 'animate': return <AnimateView />;
    case 'atlas': return <AtlasView />;
    case 'manifest': return <ManifestView />;
  }
}

export function App() {
  usePlaybackEngine();
  useRemoteControl('ws://localhost:9100');

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      // Space = play/pause in animate mode
      if (e.code === 'Space') {
        const store = useSeuratStore.getState();
        if (store.activeSection === 'animate') {
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
        <Sidebar />
        <div style={styles.content}>
          <SectionContent />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    background: '#0e0e1a',
    overflow: 'hidden',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
};
