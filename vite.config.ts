import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const buildVersion = process.env.VITE_BUILD_VERSION || `${Date.now()}`;

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    {
      name: 'emit-build-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify(
            {
              version: buildVersion,
              generatedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        });
      },
    },
  ],
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'app.html'),
      },
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
