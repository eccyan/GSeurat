import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { registerTestStore } from '@gseurat/test-harness/register';
import { useParticleStore } from './store/useParticleStore.js';

if (import.meta.env.DEV) {
  registerTestStore(useParticleStore);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
