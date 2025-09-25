// vite.config.js
import { defineConfig } from 'vite';
export default defineConfig({
  root: 'docs',          // dev server serves from docs/
  server: { open: true },
  build: { outDir: 'dist', emptyOutDir: true }
});