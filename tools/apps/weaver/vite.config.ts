import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  resolve: { conditions: ['source'] },
  server: { port: 5182 },
  test: {
    resolve: {
      conditions: ['source'],
    },
  },
} as any);
