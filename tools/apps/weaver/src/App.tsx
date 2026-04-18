import React from 'react';
import './App.css';
import { Toolbar } from './components/Toolbar.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { Sidebar } from './components/Sidebar.js';
import { useAudioPlayer } from './hooks/useAudioPlayer.js';

export function App() {
  useAudioPlayer();
  return (
    <div className="weaver">
      <Toolbar />
      <main className="weaver-body">
        <TimelinePanel />
        <Sidebar />
      </main>
    </div>
  );
}
