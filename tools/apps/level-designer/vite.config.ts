import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { testHarnessPlugin } from '@gseurat/test-harness/plugin';

export default defineConfig({
  plugins: [react(), testHarnessPlugin({ port: 6173 })],
  envDir: '../../',
  resolve: {
    conditions: ['source'],
  },
  server: {
    port: 5173,
  },
});
