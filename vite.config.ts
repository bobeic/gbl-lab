import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  base: '/gbl-lab/',
  plugins: [preact()],
  build: { outDir: '../dist', emptyOutDir: true },
});
