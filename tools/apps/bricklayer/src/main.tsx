import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { registerTestStore } from '@gseurat/test-harness/register';
import { useSceneStore } from './store/useSceneStore.js';

if (import.meta.env.DEV) {
  registerTestStore(useSceneStore);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
