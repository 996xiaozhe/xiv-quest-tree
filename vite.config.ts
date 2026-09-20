import { statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Uncompressed size of the quest dataset, baked in at build time so the boot screen
 * can show a real percentage. The browser's Content-Length describes the *compressed*
 * body while `res.body` yields decompressed bytes, so it cannot be used as the
 * denominator whenever the server applies gzip/brotli.
 */
export function dataByteSize(): number {
  try {
    return statSync(path.resolve('public/data/quests.json')).size;
  } catch {
    return 0;
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __QUEST_DATA_BYTES__: JSON.stringify(dataByteSize()),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    watch: {
      // Editors that save atomically (write to `<name>.<pid>.<uuid>.tmpdir/` and then
      // rename) make the watcher throw EBUSY on the temp file, which takes the whole
      // dev server down. Ignore those staging directories and build output.
      ignored: ['**/*.tmpdir/**', '**/.*.tmpdir/**', '**/dist-test/**', '**/node_modules/**', '**/.npm-cache/**'],
    },
  },
});
