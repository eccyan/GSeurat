import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { registerTestStore } from '@gseurat/test-harness/register';
import { useSfxStore } from './store/useSfxStore.js';

if (import.meta.env.DEV) {
  registerTestStore(useSfxStore);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
