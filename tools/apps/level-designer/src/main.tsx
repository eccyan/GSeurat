import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { registerTestStore } from '@vulkan-game-tools/test-harness/register';
import { useEditorStore } from './store/useEditorStore.js';

if (import.meta.env.DEV) {
  registerTestStore(useEditorStore);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
