import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  server: { port: 5191, strictPort: true },
  preview: { port: 5192, strictPort: true },
});
