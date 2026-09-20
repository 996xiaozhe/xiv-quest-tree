/// <reference types="vite/client" />

/**
 * Uncompressed byte size of `public/data/quests.json`, injected by `vite.config.ts`.
 * Used as the denominator for the boot screen's download progress bar. `typeof` is
 * safe on an identifier that was never defined, so a build without the define simply
 * reports 0 and the boot screen falls back to an indeterminate sweep.
 */
declare const __QUEST_DATA_BYTES__: number;

/**
 * Commit this bundle was built from, injected by `vite.config.ts` and used to address the
 * immutable jsDelivr mirror (see `src/cdn.ts`). Empty string when git was unavailable.
 */
declare const __BUILD_REF__: string;
