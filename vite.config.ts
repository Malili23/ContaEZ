import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()], base: './', clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/site/dist/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rollupOptions: { input: { main: resolve('index.html'), addin: resolve('addin/index.html') } } },
});
