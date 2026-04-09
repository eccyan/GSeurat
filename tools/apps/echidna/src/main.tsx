import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary, componentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from './store/useCharacterStore.js';
import type { EchidnaFile } from './store/types.js';
import manifest from './expected-components.json';

componentRegistry.setManifest(manifest);

// Sync mode with registry when store changes
useCharacterStore.subscribe((state) => {
  componentRegistry.setMode(state.mode);
});
componentRegistry.setMode(useCharacterStore.getState().mode);

// Pre-load character from URL param before React mounts
const params = new URLSearchParams(window.location.search);
const loadFile = params.get('load');

function mount() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

if (loadFile) {
  console.log('[echidna] Loading from URL param:', loadFile);
  fetch(`/${loadFile}`)
    .then((r) => r.json())
    .then((data: EchidnaFile) => {
      useCharacterStore.getState().loadProject(data);
      useCharacterStore.getState().setCurrentFilename(loadFile!);
      mount();
      // Kick-start R3F render loop — Canvas needs a resize event to begin rendering
      setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    })
    .catch((err) => {
      console.error('[echidna] Failed to load file from URL param:', err);
      mount();
    });
} else {
  mount();
}

// Support window.postMessage API for programmatic loading
window.addEventListener('message', (e) => {
  if (e.data?.type === 'echidna:load' && e.data?.data) {
    useCharacterStore.getState().loadProject(e.data.data as EchidnaFile);
    if (e.data.filename) {
      useCharacterStore.getState().setCurrentFilename(e.data.filename);
    }
  }
});
