import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dataByteSize } from '../vite.config.ts';

/**
 * Builds the app as a single classic (IIFE) script so the DOM test can execute it
 * inside jsdom, which does not support `<script type="module">`.
 */
export default defineConfig({
  publicDir: false,
  plugins: [react()],
  define: {
    __QUEST_DATA_BYTES__: JSON.stringify(dataByteSize()),
  },
  build: {
    outDir: 'dist-test',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    minify: false,
    rollupOptions: {
      input: path.resolve('src/main.tsx'),
      output: {
        format: 'iife',
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
        inlineDynamicImports: true,
      },
    },
  },
});
