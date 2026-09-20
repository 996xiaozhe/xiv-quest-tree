import { execFileSync } from 'node:child_process';
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

/**
 * Commit the bundle is built from, baked in so the CDN mirror URLs are immutable (see
 * `src/cdn.ts`). Empty when git is unavailable or the checkout has no commits yet, which
 * simply makes the app serve the data from its own deployment.
 */
export function buildRef(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __QUEST_DATA_BYTES__: JSON.stringify(dataByteSize()),
    __BUILD_REF__: JSON.stringify(buildRef()),
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
