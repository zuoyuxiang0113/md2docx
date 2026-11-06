import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), {
    name: 'local-api-docs',
    closeBundle() {
      mkdirSync('dist/docs-assets', { recursive: true });
      for (const file of ['swagger-ui-bundle.js', 'swagger-ui.css', 'favicon-32x32.png']) {
        copyFileSync(resolve('node_modules/swagger-ui-dist', file), resolve('dist/docs-assets', file));
      }
    },
  }],
  build: { outDir: 'dist', sourcemap: false },
  server: { proxy: Object.fromEntries(['/v1', '/healthz', '/readyz'].map(path => [path, 'http://127.0.0.1:8000'])) },
});
