import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary, componentRegistry } from '@gseurat/ui-kit';
import { registerTestStore } from '@gseurat/test-harness/register';
import { useSceneStore } from './store/useSceneStore.js';
import manifest from './expected-components.json';

if (import.meta.env.DEV) {
  registerTestStore(useSceneStore);
}

componentRegistry.setManifest(manifest);

// Sync mode with registry when store changes
useSceneStore.subscribe((state) => {
  componentRegistry.setMode(state.mode);
});
componentRegistry.setMode(useSceneStore.getState().mode);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
