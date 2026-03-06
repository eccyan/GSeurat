import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { testHarnessPlugin } from '@vulkan-game-tools/test-harness/plugin';

export default defineConfig({
  plugins: [react(), testHarnessPlugin({ port: 6179 })],
  envDir: '../../',
  resolve: {
    conditions: ['source'],
  },
  server: {
    port: 5179,
  },
});
