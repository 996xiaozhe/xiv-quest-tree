import type { Filters, Lang, Quest, QuestData, Trio } from './types.ts';
import { LANG_INDEX } from './types.ts';

const BASE_URL: string =
  (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

export const DATA_URL = `${BASE_URL}data/quests.json`;

let cache: Promise<QuestData> | null = null;

/**
 * Loads the dataset, reporting download progress when the server sends a length.
 *
 * The payload is ~2.4 MB uncompressed, so a bare spinner gives no sense of how long
 * is left. Streaming the body lets the boot screen show a real percentage; if the
 * response is not streamable (or has no Content-Length) it falls back to the plain
 * `res.json()` path and the caller keeps an indeterminate animation.
 */
export function loadQuestData(onProgress?: (ratio: number) => void): Promise<QuestData> {
  if (!cache) {
    cache = (async () => {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // The uncompressed size is baked in at build time: Content-Length describes the
      // compressed body, but the stream below yields decompressed bytes, so using it
      // as the denominator would make the bar jump straight to 100% behind brotli.
      const baked = typeof __QUEST_DATA_BYTES__ === 'number' ? __QUEST_DATA_BYTES__ : 0;
      const wire = Number(res.headers?.get?.('content-length') ?? 0);
      const encoded = !!res.headers?.get?.('content-encoding');
      const total = baked || (encoded ? 0 : wire);
      const body = res.body;
      if (!body || !total || typeof body.getReader !== 'function') {
        return (await res.json()) as QuestData;
      }

      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress?.(Math.min(1, received / total));
      }
      const merged = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(new TextDecoder().decode(merged)) as QuestData;
    })();
  }
  return cache;
}

export const nameOf = (q: Quest, lang: Lang): string =>
  (lang === 'cn' ? q.cn : lang === 'en' ? q.en : q.ja) || q.en || q.cn || q.ja || `#${q.id}`;

export const dictName = (trio: Trio | undefined, lang: Lang): string =>
  trio ? trio[LANG_INDEX[lang]] || trio[1] || trio[0] : '';

export interface TaxoEntry {
  id: number;
  name: string;
  count: number;
  /** parent id, when the entry belongs to a hierarchy */
  parent?: number;
}

export interface Taxonomy {
  ex: TaxoEntry[];
  js: TaxoEntry[];
  jcat: TaxoEntry[];
  jgen: TaxoEntry[];
}

export function buildTaxonomy(data: QuestData, lang: Lang): Taxonomy {
  const count = <K extends keyof Quest>(key: K) => {
    const m = new Map<number, number>();
    for (const q of data.quests) {
      const v = q[key] as unknown as number;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };

  const exCounts = count('ex');
  const jsCounts = count('js');
  const jcatCounts = count('jcat');
  const jgenCounts = count('jgen');

  const ex: TaxoEntry[] = Object.entries(data.dicts.ex)
    .map(([id, trio]) => ({ id: Number(id), name: dictName(trio, lang) || `#${id}`, count: exCounts.get(Number(id)) ?? 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => a.id - b.id);

  const js: TaxoEntry[] = Object.entries(data.dicts.js)
    .map(([id, trio]) => ({ id: Number(id), name: dictName(trio, lang) || `#${id}`, count: jsCounts.get(Number(id)) ?? 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => a.id - b.id);

  // JournalCategory rows carry their section through JournalGenre; derive it from the data.
  const catSection = new Map<number, number>();
  for (const q of data.quests) if (!catSection.has(q.jcat)) catSection.set(q.jcat, q.js);

  const jcat: TaxoEntry[] = Object.entries(data.dicts.jcat)
    .map(([id, trio]) => ({
      id: Number(id),
      name: dictName(trio, lang) || `#${id}`,
      count: jcatCounts.get(Number(id)) ?? 0,
      parent: catSection.get(Number(id)) ?? 0,
    }))
    .filter((e) => e.count > 0)
    .sort((a, b) => (a.parent! - b.parent!) || a.id - b.id);

  const genreCat = new Map<number, number>();
  for (const q of data.quests) if (!genreCat.has(q.jgen)) genreCat.set(q.jgen, q.jcat);

  const jgen: TaxoEntry[] = Object.entries(data.dicts.jgen)
    .map(([id, trio]) => ({
      id: Number(id),
      name: dictName(trio, lang) || `#${id}`,
      count: jgenCounts.get(Number(id)) ?? 0,
      parent: genreCat.get(Number(id)) ?? 0,
    }))
    .filter((e) => e.count > 0)
    .sort((a, b) => (a.parent! - b.parent!) || a.id - b.id);

  return { ex, js, jcat, jgen };
}

export function applyFilters(quests: Quest[], f: Filters): Quest[] {
  const hasEx = f.ex.size > 0;
  const hasJs = f.js.size > 0;
  const hasCat = f.jcat.size > 0;
  const hasGen = f.jgen.size > 0;
  return quests.filter((q) => {
    if (hasEx && !f.ex.has(q.ex)) return false;
    if (hasJs && !f.js.has(q.js)) return false;
    if (hasCat && !f.jcat.has(q.jcat)) return false;
    if (hasGen && !f.jgen.has(q.jgen)) return false;
    return true;
  });
}

/** Case/diacritic-insensitive-ish matching across all three names. */
export function searchQuests(quests: Quest[], query: string, lang: Lang, limit = 60): Quest[] {
  const t = query.trim().toLowerCase();
  if (!t) return [];
  const scored: { q: Quest; score: number }[] = [];
  for (const q of quests) {
    const cn = q.cn.toLowerCase();
    const en = q.en.toLowerCase();
    const ja = q.ja.toLowerCase();
    let score = -1;
    const pref = (s: string) => (s.startsWith(t) ? 0 : s.includes(t) ? 1 : -1);
    const p = [pref(en), pref(cn), pref(ja)];
    const best = Math.min(...p.filter((v) => v >= 0));
    if (Number.isFinite(best)) score = best;
    else {
      // also allow substring matches ignoring spaces/punctuation
      const flat = (s: string) => s.replace(/[\s'’·:：\-–—,，.。!！?？"“”()（）[\]【】]/g, '');
      const ft = flat(t);
      if (ft && (flat(cn).includes(ft) || flat(en).includes(ft) || flat(ja).includes(ft))) score = 2;
    }
    if (score >= 0) {
      const primary = lang === 'cn' ? cn : lang === 'en' ? en : ja;
      const bonus = primary.startsWith(t) ? -0.5 : 0;
      scored.push({ q, score: score + bonus });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.q.id - b.q.id);
  return scored.slice(0, limit).map((s) => s.q);
}

/** Collects every prerequisite / follow-up reachable from a quest (used for highlighting). */
export function relatedSet(id: number, index: Map<number, Quest>, upDepth = 4, downDepth = 4): Set<number> {
  const out = new Set<number>([id]);
  let frontier = [id];
  for (let d = 0; d < upDepth && frontier.length; d++) {
    const next: number[] = [];
    for (const n of frontier) {
      const q = index.get(n);
      if (!q) continue;
      for (const p of [...q.prev, ...q.lock]) {
        if (out.has(p)) continue;
        out.add(p);
        next.push(p);
      }
    }
    frontier = next;
  }
  frontier = [id];
  for (let d = 0; d < downDepth && frontier.length; d++) {
    const next: number[] = [];
    for (const n of frontier) {
      const q = index.get(n);
      if (!q) continue;
      for (const c of q.next) {
        if (out.has(c)) continue;
        out.add(c);
        next.push(c);
      }
    }
    frontier = next;
  }
  return out;
}

export type DependencyDir = 'prev' | 'next';

export interface DependencyView {
  root: number;
  dir: DependencyDir;
}

/**
 * The prerequisites of a quest, transitively — this is what selecting a node
 * highlights. Follow-ups are deliberately excluded (the emphasis is "what leads
 * here"), and so are QuestLock links, which are a separate "additional requirement"
 * concept and stay dashed in the graph rather than becoming part of the chain.
 */
export function prerequisiteSet(id: number, index: Map<number, Quest>, depth = 5): Set<number> {
  const out = new Set<number>([id]);
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: number[] = [];
    for (const n of frontier) {
      const q = index.get(n);
      if (!q) continue;
      for (const p of q.prev) {
        if (out.has(p)) continue;
        out.add(p);
        next.push(p);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Every quest reachable from `root` by following prerequisite links (or follow-up
 * links), including the root itself. Powers the right-click dependency view, which
 * narrows the graph down to a single quest's ancestry.
 */
export function dependencyClosure(
  index: Map<number, Quest>,
  root: number,
  dir: DependencyDir,
  includeLocks = false,
): Quest[] {
  const start = index.get(root);
  if (!start) return [];
  const seen = new Set<number>([root]);
  const out: Quest[] = [start];
  const stack = [root];
  while (stack.length) {
    const q = index.get(stack.pop()!);
    if (!q) continue;
    const neighbours = dir === 'prev' ? (includeLocks ? [...q.prev, ...q.lock] : q.prev) : q.next;
    for (const n of neighbours) {
      if (seen.has(n)) continue;
      const nq = index.get(n);
      if (!nq) continue;
      seen.add(n);
      out.push(nq);
      stack.push(n);
    }
  }
  return out;
}
