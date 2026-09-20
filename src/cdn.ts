/**
 * jsDelivr mirror of this repository.
 *
 * The site's audience is Chinese (国服 data tables, Chinese-first UI), and on that network
 * `raw.githubusercontent.com` is unreachable while `cdn.jsdelivr.net` answers in about a
 * second — so the large payloads (the 2.5 MB dataset, the marker icons) are fetched from
 * the CDN first and fall back to this deployment's own copy whenever it is unavailable.
 *
 * The ref is the commit the bundle was built from, which is what makes the mirror safe:
 * the URL is immutable, so jsDelivr caches it forever and it can never drift away from
 * the code that asks for it. A build from an unpublished commit simply 404s once and the
 * caller moves on to the local copy.
 */
export const CDN_REPO = '996xiaozhe/xiv-quest-tree';
export const CDN_BASE = 'https://cdn.jsdelivr.net/gh';

const BUILD_REF: string = typeof __BUILD_REF__ === 'string' ? __BUILD_REF__ : '';
/** `vite dev` serves the working copy, which is by definition ahead of the last commit. */
const IS_DEV = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;

/** CDN URL for a path inside the repository, or null when there is no build ref. */
export function cdnUrlFor(ref: string, repoPath: string): string | null {
  const clean = repoPath.replace(/^\/+/, '');
  if (!ref || !clean) return null;
  return `${CDN_BASE}/${CDN_REPO}@${ref}/${clean}`;
}

/**
 * CDN URL for the commit this bundle was built from, or null — which is the case in
 * `vite dev` (the dev server must serve the files being edited, not the committed ones)
 * and in any build where git was unavailable.
 */
export const cdnUrl = (repoPath: string): string | null => (IS_DEV ? null : cdnUrlFor(BUILD_REF, repoPath));
