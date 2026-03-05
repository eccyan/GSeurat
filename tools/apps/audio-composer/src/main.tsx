import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { registerTestStore } from '@vulkan-game-tools/test-harness/register';
import { useComposerStore } from './store/useComposerStore.js';

if (import.meta.env.DEV) {
  registerTestStore(useComposerStore);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
