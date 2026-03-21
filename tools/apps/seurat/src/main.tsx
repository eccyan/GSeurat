import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { registerTestStore } from '@gseurat/test-harness/register';
import { useSeuratStore } from './store/useSeuratStore.js';

if (import.meta.env.DEV) {
  registerTestStore(useSeuratStore);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
