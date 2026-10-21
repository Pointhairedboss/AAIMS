import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';

const keepAliveAgent = new http.Agent({ keepAlive: true });

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        agent: keepAliveAgent,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        agent: keepAliveAgent,
      },
    },
  },
});
