/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/core',
  plugins: [nxViteTsPaths()],

  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: 'src/index.ts',
      name: 'settings-manager-core',
      fileName: 'index',
      // Change this to ['es', 'cjs'] if you need CommonJS support
      formats: ['es' as const],
    },
    rollupOptions: {
      // Externalize deps that shouldn't be bundled into your library
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
}));
