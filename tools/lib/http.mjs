/** Shared HTTP helper: browser-ish UA, retries with backoff, JSON convenience. */
const UA = 'XIVQuestTree/1.0 (quest-tree data builder; contact: local build script)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url, { headers = {}, attempts = 5, json = false, label = url } = {}) {
  let lastErr;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*', ...headers },
      });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      return json ? await res.json() : await res.text();
    } catch (e) {
      lastErr = e;
      if (a < attempts) await sleep(400 * a * a);
    }
  }
  throw new Error(`[${label}] ${lastErr.message}`);
}

/** Simple bounded-concurrency map. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
      }
    }),
  );
  return results;
}
