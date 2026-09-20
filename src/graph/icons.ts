import type { Quest } from '../types.ts';
import { cdnUrl } from '../cdn.ts';

/**
 * Official FFXIV quest-marker icons, taken from the game's own icon atlas.
 *
 * These are only ever rendered as plain `<img>` elements — in the legend and in the
 * canvas hover card. The graph itself draws every quest as a flat diamond at every zoom
 * and every view size, so no bitmap is stacked on a node.
 *
 * The marker for a quest kind sits directly beside that kind's text sprite:
 * `EventIconType.NpcIconAvailable` is 71200 / 71220 / 71340 (the woven "AVAILABLE …
 * QUEST" lettering) and the matching pictorial marker is the next icon up.
 *
 * Which marker a quest gets is decided by its journal group, so that the icon always
 * agrees with the node colour. EventIconType was used to cross-check that choice:
 * all 1050 main-scenario quests carry the main-scenario marker value.
 */
export const ICON_MAIN = 71201;
export const ICON_SIDE = 71221;
export const ICON_JOB = 71341;

/** JournalSection ids: 0/1 = main scenario, 6 = class & job quests. */
export function markerIconForQuest(q: Pick<Quest, 'js'>): number {
  if (q.js === 0 || q.js === 1) return ICON_MAIN;
  if (q.js === 6) return ICON_JOB;
  return ICON_SIDE;
}

const BASE_URL: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

/** The copy that ships with this deployment. */
export const markerIconLocalUrl = (id: number): string => `${BASE_URL}icons/${id}.png`;

/**
 * URL of a marker icon, for use in plain <img> tags (legend, hover card, detail panel).
 * Prefers the CDN mirror; `<MarkerIcon>` falls back to the local copy if it fails.
 */
export const markerIconUrl = (id: number): string => cdnUrl(`public/icons/${id}.png`) ?? markerIconLocalUrl(id);
