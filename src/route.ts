import type { Quest } from './types.ts';
import type { DependencyDir } from './data.ts';

/**
 * Shareable deep links:
 *
 *   /pre/<id>    → the dependency view showing that quest's prerequisites
 *   /post/<id>   → the same, for its follow-ups
 *
 * The copy button writes the quest **id**: it is short, it survives percent-encoding
 * untouched, and it is the same link in every language — a Chinese name in a URL is long
 * and meaningless to an English or Japanese reader. Names are still accepted in all three
 * languages (and the old `?id=` disambiguator is still honoured) so links shared before
 * the switch keep working.
 */
export type Route =
  | { view: 'home' }
  | { view: 'dependency'; dir: DependencyDir; name: string; id: number | null };

const BASE: string = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/').replace(/\/+$/, '');

export function parseLocation(pathname: string, search: string): Route {
  // tolerate a deployment sub-path by matching anywhere in the path
  const m = /(?:^|\/)(pre|post)\/(.+?)\/?$/.exec(pathname);
  if (!m) return { view: 'home' };
  let name: string;
  try {
    name = decodeURIComponent(m[2]);
  } catch {
    return { view: 'home' };
  }
  if (!name) return { view: 'home' };
  const raw = new URLSearchParams(search).get('id');
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return { view: 'dependency', dir: m[1] === 'pre' ? 'prev' : 'next', name, id };
}

/** The link the copy button produces for a quest: `/pre/69477`, `/post/69477`. */
export function dependencyPath(q: Quest, dir: DependencyDir): string {
  return `${BASE}/${dir === 'prev' ? 'pre' : 'post'}/${q.id}`;
}

export const homePath = (): string => (BASE || '') + '/';

/**
 * Index of every language's quest name → ids. Lookups are case- and
 * whitespace-insensitive so links survive hand-editing.
 */
export function buildNameIndex(quests: Quest[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const q of quests) {
    for (const name of [q.cn, q.en, q.ja]) {
      const key = name?.trim().toLowerCase();
      if (!key) continue;
      const hit = index.get(key);
      if (!hit) index.set(key, [q.id]);
      else if (!hit.includes(q.id)) hit.push(q.id);
    }
  }
  return index;
}

/** Anything that can answer "does this quest exist?" — a Map of quests or a Set of ids. */
export interface IdLookup {
  has(id: number): boolean;
}

/**
 * Resolves a route to a quest id: `?id=` first, then a bare numeric path (that is what
 * the copy button writes), then the name in any of the three languages.
 *
 * A number that no quest carries resolves to null rather than being handed to the graph,
 * so a stale link shows the "not found" notice instead of an empty stage.
 */
export function resolveRoute(
  route: Route,
  names: Map<string, number[]>,
  ids: IdLookup,
): number | null {
  if (route.view !== 'dependency') return null;
  const segment = route.name.trim();
  const numeric = route.id ?? (/^\d+$/.test(segment) ? Number(segment) : null);
  if (numeric != null) return ids.has(numeric) ? numeric : null;
  const hit = names.get(segment.toLowerCase());
  if (!hit || !hit.length) return null;
  // ambiguous name: fall back to the earliest quest with that name
  return Math.min(...hit);
}
